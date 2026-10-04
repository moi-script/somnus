import {
  SETUP_RX,
  SETUP_SERVICE,
  SETUP_TX,
  SetupLineParser,
  encodeSetupRequest,
  type SetupHello,
  type SetupJoin,
  type SetupNetwork,
  type SetupReply,
  type SetupRequest,
  type SetupResult,
} from '@lacs/contracts';
import { loadBleClient, negotiateMtu, type ScannedDevice } from './ble';

/**
 * Bluetooth link to a room unit in setup mode.
 *
 * Separate from the band session: it lives only while the setup wizard is
 * open, and speaks the setup messages from @lacs/contracts, not frames.
 */

const HELLO_MS = 5_000;
const SCAN_MS = 15_000;
/** 20 s for Wi-Fi plus up to 60 s for a sleeping server, plus slack. */
const JOIN_MS = 90_000;

export class SetupTimeout extends Error {}

export class SetupRefused extends Error {
  constructor(readonly reason: 'busy' | 'bad_message') {
    super(reason);
  }
}

export interface SetupLink {
  device: ScannedDevice;
  hello(): Promise<SetupHello>;
  scan(onNetwork: (network: SetupNetwork) => void): Promise<void>;
  join(req: Omit<SetupJoin, 'op'>, onStage: (stage: 'join' | 'server') => void): Promise<SetupResult>;
  close(): Promise<void>;
}

/** Android's picker, showing only units advertising the setup service. */
export async function findRoomUnit(): Promise<ScannedDevice> {
  const BleClient = await loadBleClient();
  const device = await BleClient.requestDevice({ services: [SETUP_SERVICE] });
  return { deviceId: device.deviceId, name: device.name ?? 'Room unit' };
}

export async function openSetup(device: ScannedDevice, onLost: () => void): Promise<SetupLink> {
  const BleClient = await loadBleClient();
  const { deviceId } = device;
  let closing = false;

  await BleClient.connect(deviceId, () => {
    if (!closing) onLost();
  });
  await negotiateMtu(deviceId);

  // The unit refuses unencrypted writes. Pairing encrypts the link; Android
  // shows one "Pair with Somnus-room-...?" prompt the first time.
  if (!(await BleClient.isBonded(deviceId))) await BleClient.createBond(deviceId);

  const parser = new SetupLineParser();
  const decoder = new TextDecoder();
  const listeners = new Set<(reply: SetupReply) => void>();

  await BleClient.startNotifications(deviceId, SETUP_SERVICE, SETUP_TX, (value) => {
    for (const reply of parser.push(decoder.decode(value))) {
      for (const listener of [...listeners]) listener(reply);
    }
  });

  const encoder = new TextEncoder();

  /**
   * Sends one request and resolves with the first reply `pick` accepts.
   * The listener goes in before the write, so a fast answer is never missed.
   */
  function ask<T>(
    req: SetupRequest,
    pick: (reply: SetupReply) => T | undefined,
    ms: number,
    onOther?: (reply: SetupReply) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        listeners.delete(listener);
      };
      const timer = setTimeout(() => {
        done();
        reject(new SetupTimeout());
      }, ms);
      const listener = (reply: SetupReply) => {
        if (reply.op === 'error') {
          done();
          reject(new SetupRefused(reply.reason));
          return;
        }
        onOther?.(reply);
        const value = pick(reply);
        if (value !== undefined) {
          done();
          resolve(value);
        }
      };
      listeners.add(listener);

      const bytes = encoder.encode(encodeSetupRequest(req));
      BleClient.write(deviceId, SETUP_SERVICE, SETUP_RX, new DataView(bytes.buffer)).catch((err) => {
        done();
        reject(err);
      });
    });
  }

  return {
    device,
    hello: () => ask({ op: 'hello' }, (r) => (r.op === 'hello' ? r : undefined), HELLO_MS),
    scan: async (onNetwork) => {
      await ask(
        { op: 'scan' },
        (r) => (r.op === 'scan_done' ? true : undefined),
        SCAN_MS,
        (r) => {
          if (r.op === 'net') onNetwork(r);
        },
      );
    },
    join: (req, onStage) =>
      ask(
        { op: 'join', ...req },
        (r) => (r.op === 'result' ? r : undefined),
        JOIN_MS,
        (r) => {
          if (r.op === 'joining') onStage('join');
          if (r.op === 'checking') onStage('server');
        },
      ),
    async close() {
      closing = true;
      await BleClient.stopNotifications(deviceId, SETUP_SERVICE, SETUP_TX).catch(() => {});
      await BleClient.disconnect(deviceId).catch(() => {});
    },
  };
}
