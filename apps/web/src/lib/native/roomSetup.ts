import {
  SETUP_RX,
  SETUP_SERVICE,
  SETUP_TX,
  SetupClient,
  type SetupHello,
  type SetupJoin,
  type SetupNetwork,
  type SetupResult,
} from '@lacs/contracts';
import { loadBleClient, negotiateMtu, type ScannedDevice } from './ble';

/**
 * Bluetooth link to a room unit in setup mode.
 *
 * Separate from the band session: it lives only while the setup wizard is
 * open. The requests, timeouts and failure rules are SetupClient's, in
 * @lacs/contracts; this file only moves bytes.
 */

/** Android's Pair prompt was cancelled, timed out, or pairing failed. */
export class SetupPairingFailed extends Error {}

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
  let client: SetupClient | null = null;

  await BleClient.connect(deviceId, () => {
    if (closing) return;
    // Fail whatever is in flight at once, then tell the page.
    client?.lost();
    onLost();
  });

  try {
    await negotiateMtu(deviceId);

    // The unit refuses unencrypted writes. Pairing encrypts the link; Android
    // shows one "Pair with Somnus-room-...?" prompt the first time.
    const wasBonded = await BleClient.isBonded(deviceId);
    if (!wasBonded) {
      try {
        await BleClient.createBond(deviceId);
      } catch (err) {
        throw new SetupPairingFailed((err as Error)?.message ?? String(err));
      }
    }

    const encoder = new TextEncoder();
    const connected = new SetupClient(async (line) => {
      const bytes = encoder.encode(line);
      await BleClient.write(deviceId, SETUP_SERVICE, SETUP_RX, new DataView(bytes.buffer));
    }, wasBonded);

    await BleClient.startNotifications(deviceId, SETUP_SERVICE, SETUP_TX, (value) => {
      connected.receive(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    });
    client = connected;
  } catch (err) {
    // Never leave a half-open link behind: its later drop would replace the
    // real error with "disconnected".
    closing = true;
    await BleClient.disconnect(deviceId).catch(() => {});
    throw err;
  }

  const ready = client;
  return {
    device,
    hello: () => ready.hello(),
    scan: (onNetwork) => ready.scan(onNetwork),
    join: (req, onStage) => ready.join(req, onStage),
    async close() {
      closing = true;
      await BleClient.stopNotifications(deviceId, SETUP_SERVICE, SETUP_TX).catch(() => {});
      await BleClient.disconnect(deviceId).catch(() => {});
    },
  };
}
