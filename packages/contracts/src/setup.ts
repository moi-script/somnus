import { z } from 'zod';

/**
 * Wi-Fi setup over Bluetooth, between the app and the room unit.
 *
 * The room unit's ble_setup.cpp is the other half. Messages are one JSON
 * object per line, like frames, so a line split across notifications is
 * rejoined at the newline.
 */

export const SETUP_SERVICE = 'f2c2717f-fa64-4ba7-ba20-32fe2257d551';
/** App -> unit. Encrypted writes only, so the phone has to pair first. */
export const SETUP_RX = '62b01999-0497-4557-b649-fbd965a30353';
/** Unit -> app, notify. */
export const SETUP_TX = 'be53eb28-bb81-410f-99e6-4cbe6e0ff788';

/** More rows than this is noise on a phone screen. */
export const MAX_NETWORKS = 20;

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/** Wi-Fi limits names to 32 bytes, so an emoji name runs out after 8. */
export const setupSsidSchema = z
  .string()
  .min(1, 'Enter the network name.')
  .refine((s) => utf8Bytes(s) <= 32, 'Network names are at most 32 bytes.');

/** Empty means an open network; WPA2 passphrases are 8 to 63 characters. */
export const setupPasswordSchema = z
  .string()
  .refine(
    (p) => p.length === 0 || (p.length >= 8 && p.length <= 63),
    'Wi-Fi passwords are 8 to 63 characters.',
  );

const serverSchema = z
  .string()
  .regex(/^https?:\/\/\S+$/, 'The server address must start with http:// or https://.')
  .transform((s) => s.replace(/\/+$/, ''));

export const setupRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('hello') }),
  z.object({ op: z.literal('scan') }),
  z.object({
    op: z.literal('join'),
    ssid: setupSsidSchema,
    password: setupPasswordSchema,
    server: serverSchema,
    key: z.string().min(1),
  }),
]);
export type SetupRequest = z.input<typeof setupRequestSchema>;
export type SetupJoin = Extract<SetupRequest, { op: 'join' }>;

export const setupWifiResultSchema = z.enum(['ok', 'wrong_password', 'not_found', 'timeout']);
export const setupServerResultSchema = z.enum(['ok', 'unauthorized', 'unreachable']);

export const setupReplySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('hello'),
    id: z.string().regex(/^room-[0-9a-f]{6}$/),
    fw: z.string(),
    /** The network it is on now, or null when offline. */
    wifi: z.string().nullable(),
  }),
  z.object({ op: z.literal('net'), ssid: z.string(), rssi: z.number().int(), secure: z.boolean() }),
  z.object({ op: z.literal('scan_done') }),
  z.object({ op: z.literal('joining') }),
  /** Wi-Fi is up; the unit is now proving its key to the server. */
  z.object({ op: z.literal('checking') }),
  z.object({
    op: z.literal('result'),
    wifi: setupWifiResultSchema,
    /** null when Wi-Fi failed and no server check ran. */
    server: setupServerResultSchema.nullable(),
  }),
  z.object({ op: z.literal('error'), reason: z.enum(['busy', 'bad_message']) }),
]);
export type SetupReply = z.infer<typeof setupReplySchema>;
export type SetupHello = Extract<SetupReply, { op: 'hello' }>;
export type SetupResult = Extract<SetupReply, { op: 'result' }>;

export interface SetupNetwork {
  ssid: string;
  rssi: number;
  secure: boolean;
}

export interface SetupOutcome {
  ok: boolean;
  title: string;
  detail: string;
  /** Which wizard step the retry button goes back to; null when there is nothing to retry. */
  backTo: 'wifi' | 'password' | 'retry' | null;
}

/** One line, newline included, ready to write. Throws on a message the unit would refuse. */
export function encodeSetupRequest(req: SetupRequest): string {
  return `${JSON.stringify(setupRequestSchema.parse(req))}\n`;
}

/** Why the unit would refuse this network and password, in words for the form; null when fine. */
export function joinProblem(ssid: string, password: string): string | null {
  const name = setupSsidSchema.safeParse(ssid);
  if (!name.success) return name.error.issues[0]?.message ?? 'Check the network name.';
  const pass = setupPasswordSchema.safeParse(password);
  if (!pass.success) return pass.error.issues[0]?.message ?? 'Check the password.';
  return null;
}

/** Rejoins notifications into replies. A line that is not a valid reply is dropped. */
export class SetupLineParser {
  private buffer = '';

  constructor(private readonly maxBufferBytes = 4096) {}

  push(chunk: string): SetupReply[] {
    this.buffer += chunk;
    // A line that never ends would grow this forever.
    if (this.buffer.length > this.maxBufferBytes) {
      this.buffer = this.buffer.slice(-this.maxBufferBytes);
    }

    const replies: SetupReply[] = [];
    let at: number;
    while ((at = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = setupReplySchema.safeParse(json);
      if (parsed.success) replies.push(parsed.data);
    }
    return replies;
  }
}

/** Adds one scanned network: one row per name, strongest signal kept, strongest first. */
export function mergeNetworks(list: SetupNetwork[], next: SetupNetwork): SetupNetwork[] {
  const { ssid, rssi, secure } = next;
  if (!ssid) return list;
  const existing = list.find((n) => n.ssid === ssid);
  if (existing && existing.rssi >= rssi) return list;
  return [...list.filter((n) => n.ssid !== ssid), { ssid, rssi, secure }]
    .sort((a, b) => b.rssi - a.rssi)
    .slice(0, MAX_NETWORKS);
}

/** 1 to 4 bars, close to what a phone shows for the same dBm. */
export function signalBars(rssi: number): 1 | 2 | 3 | 4 {
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -78) return 2;
  return 1;
}

/** What the wizard says about a join result, and where its retry button goes. */
export function describeResult(result: Pick<SetupResult, 'wifi' | 'server'>): SetupOutcome {
  switch (result.wifi) {
    case 'wrong_password':
      return {
        ok: false,
        title: 'Wrong password',
        detail: 'The network refused the password. Check it and try again.',
        backTo: 'password',
      };
    case 'not_found':
      return {
        ok: false,
        title: 'Network not found',
        detail: 'The room unit cannot hear that network. It may be 5 GHz only, or too far away.',
        backTo: 'wifi',
      };
    case 'timeout':
      return {
        ok: false,
        title: 'The network did not answer',
        detail: 'No connection in 20 seconds. Check the password and that the room unit is in range.',
        backTo: 'password',
      };
    case 'ok':
      break;
  }
  if (result.server === 'ok') {
    return {
      ok: true,
      title: 'Room unit is online',
      detail: 'Presence will show in the app within a few seconds.',
      backTo: null,
    };
  }
  if (result.server === 'unauthorized') {
    return {
      ok: false,
      title: 'Server rejected the key',
      detail: "Wi-Fi works, but the server refused the room unit's key. Try again to send a new one.",
      backTo: 'retry',
    };
  }
  return {
    ok: false,
    title: 'Server did not answer',
    detail: 'Wi-Fi works, but the server could not be reached. It may be starting up. Try again in a minute.',
    backTo: 'retry',
  };
}
