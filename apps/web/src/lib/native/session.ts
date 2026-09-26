import type { Frame } from '@lacs/contracts';
import type { BleStatus, Connection } from './ble';
import type { Bridge, SyncStats } from './sync';

/**
 * The one Bluetooth session for the whole app.
 *
 * It lives at module scope, not in a page component, so leaving the Connect
 * screen does not tear the link down. Only Disconnect, or the node going
 * away, ends it.
 */

export interface SessionState {
  status: BleStatus;
  stats: SyncStats | null;
  lastFrame: Frame | null;
}

let state: SessionState = { status: { state: 'idle' }, stats: null, lastFrame: null };
let connection: Connection | null = null;
let bridge: Bridge | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<SessionState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function getSession(): SessionState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetError(): void {
  if (state.status.state === 'error') set({ status: { state: 'idle' } });
}

export async function pair(typedToken: string): Promise<void> {
  if (connection) return;
  set({ status: { state: 'scanning' } });

  try {
    const ble = await import('./ble');
    const { Bridge, deviceToken, setDeviceToken } = await import('./sync');

    // The field is prefilled with the saved token, so what it holds now is
    // what the user means; a stale saved one would be rejected on upload.
    const token = typedToken.trim() || deviceToken();
    if (!token) {
      set({
        status: {
          state: 'error',
          message: 'Add the ingest token first. You get it when you add the node on the Device tab.',
        },
      });
      return;
    }
    setDeviceToken(token);

    await ble.initialize();
    if (!(await ble.isEnabled())) {
      set({ status: { state: 'error', message: 'Bluetooth is off. Turn it on and try again.' } });
      return;
    }

    const chosen = await ble.requestDevice();
    set({ status: { state: 'connecting', name: chosen.name } });

    const newBridge = new Bridge(
      token,
      async (line) => {
        await connection?.send(line);
      },
      (stats) => set({ stats }),
    );

    connection = await ble.connect(
      chosen.deviceId,
      (frame) => {
        set({ lastFrame: frame });
        void newBridge.ingestFrame(frame);
      },
      () => {
        // disconnect() clears the connection first; this is then our own
        // teardown, not the node going away.
        if (connection === null) return;
        newBridge.stop();
        connection = null;
        bridge = null;
        set({ status: { state: 'error', message: 'The node disconnected.' } });
      },
    );

    bridge = newBridge;
    bridge.start();
    set({ status: { state: 'connected', name: chosen.name, deviceId: chosen.deviceId } });
  } catch (err) {
    set({ status: { state: 'error', message: (err as Error).message } });
  }
}

export async function disconnect(): Promise<void> {
  bridge?.stop();
  bridge = null;
  const closing = connection;
  connection = null;
  await closing?.disconnect();
  set({ status: { state: 'idle' } });
}
