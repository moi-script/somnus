import type { Frame } from '@lacs/contracts';
import { FrameLineParser } from '@lacs/contracts';

/**
 * BLE link to the sensor node.
 *
 * Everything here is loaded dynamically: the plugin only exists inside the
 * Capacitor shell, and importing it at module scope would break the web build.
 */

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notify: node -> phone
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // write:  phone -> node

/** Frames are ~300 bytes; the 23-byte default would chunk every one of them. */
const DESIRED_MTU = 512;

export interface ScannedDevice {
  deviceId: string;
  name: string;
}

export type BleStatus =
  | { state: 'idle' }
  | { state: 'scanning' }
  | { state: 'connecting'; name: string }
  | { state: 'connected'; name: string; deviceId: string }
  | { state: 'error'; message: string };

type BleClientModule = typeof import('@capacitor-community/bluetooth-le');

async function ble(): Promise<BleClientModule['BleClient']> {
  const mod = await import('@capacitor-community/bluetooth-le');
  return mod.BleClient;
}

/**
 * Permission failures are the single most common way this breaks on Android
 * 12+: BLUETOOTH_SCAN needs a runtime grant, and without it scanning returns
 * an empty list rather than an error. Initialising up front turns that silent
 * emptiness into a message someone can act on.
 */
export async function initialize(): Promise<void> {
  const BleClient = await ble();
  await BleClient.initialize({ androidNeverForLocation: true });
}

export async function isEnabled(): Promise<boolean> {
  const BleClient = await ble();
  return BleClient.isEnabled();
}

/** Opens Android's own picker, filtered to nodes advertising our service. */
export async function requestDevice(): Promise<ScannedDevice> {
  const BleClient = await ble();
  const device = await BleClient.requestDevice({ services: [NUS_SERVICE] });
  return { deviceId: device.deviceId, name: device.name ?? 'Unnamed node' };
}

export interface Connection {
  deviceId: string;
  disconnect: () => Promise<void>;
  send: (line: string) => Promise<void>;
}

export async function connect(
  deviceId: string,
  onFrame: (frame: Frame) => void,
  onDisconnect: () => void,
): Promise<Connection> {
  const BleClient = await ble();

  await BleClient.connect(deviceId, () => onDisconnect());

  // Android leaves the MTU at 23 unless the central asks. Not every device
  // honours the request, which is why the parser below reassembles anyway.
  try {
    const withMtu = BleClient as unknown as {
      requestMtu?: (id: string, mtu: number) => Promise<number>;
    };
    await withMtu.requestMtu?.(deviceId, DESIRED_MTU);
  } catch {
    // Negotiation failed; chunked frames still arrive, just in more packets.
  }

  const decoder = new TextDecoder();
  const parser = new FrameLineParser();

  await BleClient.startNotifications(deviceId, NUS_SERVICE, NUS_TX, (value) => {
    // One notification is not one frame. The firmware splits at MTU-3 and the
    // line parser rejoins at the newline.
    for (const frame of parser.pushFrames(decoder.decode(value))) onFrame(frame);
  });

  const encoder = new TextEncoder();

  return {
    deviceId,
    async disconnect() {
      await BleClient.stopNotifications(deviceId, NUS_SERVICE, NUS_TX).catch(() => {});
      await BleClient.disconnect(deviceId).catch(() => {});
    },
    async send(line: string) {
      const bytes = encoder.encode(`${line}\n`);
      await BleClient.write(deviceId, NUS_SERVICE, NUS_RX, new DataView(bytes.buffer));
    },
  };
}
