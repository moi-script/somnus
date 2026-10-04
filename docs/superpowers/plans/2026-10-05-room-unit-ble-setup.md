# Room Unit Wi-Fi Setup over Bluetooth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the room unit's Wi-Fi, server address and device key entirely from the Somnus app over an encrypted Bluetooth link, and switch the unit to its external antenna.

**Architecture:** The protocol (UUIDs, zod message schemas, line parser, list merging, result wording) lives once in `packages/contracts/src/setup.ts` and is unit-tested there. The app talks it through a new `lib/native/roomSetup.ts` and a 5-step wizard at `/device/room-setup/`. The firmware gets a self-contained `ble_setup.cpp` (NimBLE) whose callbacks only queue lines; the sketch's `loop()` does all Wi-Fi and HTTP work so the radar never stalls.

**Tech Stack:** TypeScript, zod 3, vitest, Next.js 15 static export inside Capacitor 7, `@capacitor-community/bluetooth-le` 7; Arduino ESP32 core 3.3.7 (XIAO_ESP32C6), NimBLE-Arduino 2.5.1, ArduinoJson 7, WiFiManager 2.0.17.

**Spec:** `docs/superpowers/specs/2026-10-05-room-unit-ble-setup-design.md`

## Global Constraints

- Setup service `f2c2717f-fa64-4ba7-ba20-32fe2257d551`; app → unit `62b01999-0497-4557-b649-fbd965a30353` (write, encrypted); unit → app `be53eb28-bb81-410f-99e6-4cbe6e0ff788` (notify).
- Advertised name `Somnus-room-xxxxxx` (same as the hotspot).
- Messages: one JSON object per line, `\n`-terminated.
- `ssid` 1–32 bytes; `password` empty or 8–63 characters; `server` starts with `http://` or `https://`, trailing slashes trimmed; `key` non-empty.
- Scan list: merged by SSID (strongest kept), strongest first, at most 20, hidden SSIDs dropped.
- Pairing: LE Secure Connections, Just Works, bonding (`setSecurityAuth(true, false, true)`); the write characteristic refuses unencrypted writes.
- Setup window: opens on first boot with no network, 60 s offline, BOOT held 3 s, or Serial `setup`; closes after success, or after 5 minutes with Wi-Fi up and no phone connected.
- Join: Wi-Fi 20 s; server check 10 s per attempt, retried for up to 60 s.
- The unit never sends the password or key back; Serial prints the password as `****` and the key as its first 4 characters.
- Firmware version `0.4.0`.
- Two git repos: `C:\lacs_thesis` (contracts, app, docs) and `C:\Users\moises\Documents\Arduino\esp_flash_mmwave` (firmware). Never commit `secrets.h`.
- Firmware compile command (used by Tasks 5–7):
  `"/c/Users/moises/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe" compile --fqbn esp32:esp32:XIAO_ESP32C6 /c/Users/moises/Documents/Arduino/esp_flash_mmwave`

## Review Focus

1. **A phone holding a stale bond** (unit's flash erased, phone still "paired") — encrypted writes fail. Expect a message telling the user to forget `Somnus-room-xxxxxx` in Android Bluetooth settings, not a generic timeout. Pinned by `errorText()` in Task 4 and bench step 7 in Task 7.
2. **Multi-byte network names** (emoji, accents, exactly 32 bytes) — accepted or refused by bytes, not characters. Pinned by tests in Task 1.
3. **The phone drops the link mid-join** — the unit finishes the join on its own; the wizard returns to Find with "The room unit disconnected". Pinned by `lost()` in Task 4 and the `closing` guard in Task 3.
4. **A wrong password on a unit that was already online** — the unit must go back to its previous network, not stay offline. Pinned by `restorePreviousNetwork()` in Task 6 and bench step 2.
5. **Render asleep during the server check** — a slow first answer must not be reported as failure before 60 s. Pinned by `handleJoin()` retries in Task 6 and the "Waking the server…" hint in Task 4.

---

### Task 1: Setup protocol in contracts

**Files:**
- Create: `packages/contracts/src/setup.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/setup.test.ts`

**Interfaces:**
- Produces (exported from `@lacs/contracts`):
  - `SETUP_SERVICE`, `SETUP_RX`, `SETUP_TX`: `string`; `MAX_NETWORKS = 20`
  - `setupRequestSchema`, `setupReplySchema`, `setupSsidSchema`, `setupPasswordSchema`
  - types `SetupRequest`, `SetupJoin`, `SetupReply`, `SetupHello`, `SetupResult`, `SetupNetwork { ssid; rssi; secure }`, `SetupOutcome { ok; title; detail; backTo: 'wifi' | 'password' | 'retry' | null }`
  - `encodeSetupRequest(req: SetupRequest): string` (throws on invalid)
  - `joinProblem(ssid: string, password: string): string | null`
  - `class SetupLineParser { push(chunk: string): SetupReply[] }`
  - `mergeNetworks(list: SetupNetwork[], next: SetupNetwork): SetupNetwork[]`
  - `signalBars(rssi: number): 1 | 2 | 3 | 4`
  - `describeResult(r: { wifi; server }): SetupOutcome`

- [ ] **Step 0: Branch both repos**

```bash
cd /c/lacs_thesis && git switch -c feat/room-ble-setup
cd /c/Users/moises/Documents/Arduino/esp_flash_mmwave && git switch -c feat/ble-setup
```

- [ ] **Step 1: Write the failing tests**

`packages/contracts/test/setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_NETWORKS,
  SetupLineParser,
  describeResult,
  encodeSetupRequest,
  joinProblem,
  mergeNetworks,
  signalBars,
  type SetupNetwork,
} from '../src/index.js';

const JOIN = {
  op: 'join' as const,
  ssid: 'PLDT-Home',
  password: 'correct horse',
  server: 'https://somnus-api.onrender.com/',
  key: 'room-7c1a02.abc',
};

describe('encodeSetupRequest', () => {
  it('writes one line and trims the server address', () => {
    const line = encodeSetupRequest(JOIN);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n')).toHaveLength(2);
    expect(JSON.parse(line).server).toBe('https://somnus-api.onrender.com');
  });

  it('allows an open network', () => {
    expect(() => encodeSetupRequest({ ...JOIN, password: '' })).not.toThrow();
  });

  it.each([
    ['empty ssid', { ...JOIN, ssid: '' }],
    ['33-byte ssid', { ...JOIN, ssid: 'x'.repeat(33) }],
    ['short password', { ...JOIN, password: 'short' }],
    ['64-char password', { ...JOIN, password: 'p'.repeat(64) }],
    ['server without scheme', { ...JOIN, server: 'somnus-api.onrender.com' }],
    ['empty key', { ...JOIN, key: '' }],
  ])('refuses %s', (_, req) => {
    expect(() => encodeSetupRequest(req)).toThrow();
  });
});

describe('joinProblem', () => {
  it('measures network names in bytes, not characters', () => {
    // 8 emoji = 32 bytes in UTF-8: allowed. 9 = 36 bytes: refused.
    expect(joinProblem('😴'.repeat(8), 'password1')).toBeNull();
    expect(joinProblem('😴'.repeat(9), 'password1')).toBe('Network names are at most 32 bytes.');
  });

  it('explains a password of the wrong length', () => {
    expect(joinProblem('Home', 'short')).toBe('Wi-Fi passwords are 8 to 63 characters.');
    expect(joinProblem('Home', '')).toBeNull();
  });

  it('asks for a name when there is none', () => {
    expect(joinProblem('', 'password1')).toBe('Enter the network name.');
  });
});

describe('SetupLineParser', () => {
  it('rejoins a reply split across notifications', () => {
    const parser = new SetupLineParser();
    expect(parser.push('{"op":"hello","id":"room-7c1a02",')).toEqual([]);
    expect(parser.push('"fw":"0.4.0","wifi":null}\n')).toEqual([
      { op: 'hello', id: 'room-7c1a02', fw: '0.4.0', wifi: null },
    ]);
  });

  it('returns every reply in one chunk, in order', () => {
    const parser = new SetupLineParser();
    const replies = parser.push(
      '{"op":"net","ssid":"A","rssi":-50,"secure":true}\n{"op":"scan_done"}\n',
    );
    expect(replies.map((r) => r.op)).toEqual(['net', 'scan_done']);
  });

  it('drops blank, broken and unknown lines', () => {
    const parser = new SetupLineParser();
    expect(parser.push('\n{oops\n{"op":"reboot"}\n{"op":"joining"}\n')).toEqual([{ op: 'joining' }]);
  });

  it('accepts a result with no server check', () => {
    const parser = new SetupLineParser();
    expect(parser.push('{"op":"result","wifi":"not_found","server":null}\n')).toEqual([
      { op: 'result', wifi: 'not_found', server: null },
    ]);
  });
});

describe('mergeNetworks', () => {
  const net = (ssid: string, rssi: number, secure = true): SetupNetwork => ({ ssid, rssi, secure });

  it('keeps one row per name with the strongest signal', () => {
    let list = mergeNetworks([], net('Home', -80));
    list = mergeNetworks(list, net('Home', -60));
    list = mergeNetworks(list, net('Home', -70));
    expect(list).toEqual([net('Home', -60)]);
  });

  it('sorts strongest first', () => {
    let list: SetupNetwork[] = [];
    for (const n of [net('B', -70), net('A', -40), net('C', -90)]) list = mergeNetworks(list, n);
    expect(list.map((n) => n.ssid)).toEqual(['A', 'B', 'C']);
  });

  it('drops hidden networks', () => {
    expect(mergeNetworks([], net('', -40))).toEqual([]);
  });

  it(`keeps at most ${MAX_NETWORKS}`, () => {
    let list: SetupNetwork[] = [];
    for (let i = 0; i < 30; i++) list = mergeNetworks(list, net(`N${i}`, -40 - i));
    expect(list).toHaveLength(MAX_NETWORKS);
    expect(list.at(-1)!.ssid).toBe('N19');
  });

  it('strips the op field a net reply carries', () => {
    const reply = { op: 'net', ssid: 'Home', rssi: -50, secure: false } as SetupNetwork;
    expect(mergeNetworks([], reply)).toEqual([net('Home', -50, false)]);
  });
});

describe('signalBars', () => {
  it.each([
    [-40, 4],
    [-55, 4],
    [-60, 3],
    [-70, 2],
    [-90, 1],
  ])('%i dBm is %i bars', (rssi, bars) => {
    expect(signalBars(rssi)).toBe(bars);
  });
});

describe('describeResult', () => {
  it('is online only when both Wi-Fi and the server are ok', () => {
    expect(describeResult({ wifi: 'ok', server: 'ok' })).toMatchObject({ ok: true, backTo: null });
  });

  it.each([
    ['wrong_password', null, 'Wrong password', 'password'],
    ['not_found', null, 'Network not found', 'wifi'],
    ['timeout', null, 'The network did not answer', 'password'],
    ['ok', 'unauthorized', 'Server rejected the key', 'retry'],
    ['ok', 'unreachable', 'Server did not answer', 'retry'],
    ['ok', null, 'Server did not answer', 'retry'],
  ] as const)('wifi=%s server=%s -> %s', (wifi, server, title, backTo) => {
    expect(describeResult({ wifi, server })).toMatchObject({ ok: false, title, backTo });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/contracts -- setup`
Expected: FAIL — `encodeSetupRequest` etc. are not exported.

- [ ] **Step 3: Implement**

`packages/contracts/src/setup.ts`:

```ts
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
  .refine((p) => p.length === 0 || (p.length >= 8 && p.length <= 63), 'Wi-Fi passwords are 8 to 63 characters.');

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
    if (this.buffer.length > this.maxBufferBytes) this.buffer = this.buffer.slice(-this.maxBufferBytes);

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
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './setup.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/contracts`
Expected: PASS, including the existing frames/night/room suites.

- [ ] **Step 5: Build contracts so the app sees the new exports**

Run: `cd /c/lacs_thesis && npm run build:contracts`
Expected: exits 0; `packages/contracts/dist/setup.js` exists.

- [ ] **Step 6: Commit**

```bash
cd /c/lacs_thesis
git add packages/contracts/src/setup.ts packages/contracts/src/index.ts packages/contracts/test/setup.test.ts docs/superpowers/specs/2026-10-05-room-unit-ble-setup-design.md docs/superpowers/plans/2026-10-05-room-unit-ble-setup.md
git commit -m "feat(contracts): Bluetooth setup protocol for the room unit"
```

---

### Task 2: Ask Android to turn Bluetooth on (v2 item 2)

**Files:**
- Modify: `apps/web/src/lib/native/ble.ts` (the `ble()` loader, `initialize`, `isEnabled`, the MTU block in `connect`)
- Modify: `apps/web/src/lib/native/session.ts` (the `initialize`/`isEnabled` block in `pair`)

**Interfaces:**
- Produces (from `ble.ts`):
  - `loadBleClient(): Promise<BleClient>` (renamed from the private `ble()`)
  - `ensureEnabled(): Promise<boolean>` — initialises, and if Bluetooth is off shows Android's enable prompt; `true` when on
  - `negotiateMtu(deviceId: string): Promise<void>`
- Removes: `initialize()`, `isEnabled()` (only `session.ts` used them)

There is no test runner in `apps/web`; this task is verified by typecheck and on the phone in Task 7.

- [ ] **Step 1: Confirm nothing else uses the functions being removed**

Run: `cd /c/lacs_thesis && grep -rnE "ble\.(initialize|isEnabled)|from './ble'" apps/web/src`
Expected: only `session.ts` calls `initialize` and `isEnabled`.

- [ ] **Step 2: Change `ble.ts`**

Rename the loader and export it:

```ts
export async function loadBleClient(): Promise<BleClientModule['BleClient']> {
  const mod = await import('@capacitor-community/bluetooth-le');
  return mod.BleClient;
}
```

Replace every `await ble()` in the file with `await loadBleClient()`.

Replace `initialize()` and `isEnabled()` (keep the comment block above them) with:

```ts
/**
 * Permission failures are the single most common way this breaks on Android
 * 12+: BLUETOOTH_SCAN needs a runtime grant, and without it scanning returns
 * an empty list rather than an error. Initialising up front turns that silent
 * emptiness into a message someone can act on.
 *
 * With Bluetooth off, Android's own "turn on Bluetooth?" prompt is shown
 * instead of an error; Android does not let an app switch it on silently.
 * Resolves true once Bluetooth is on.
 */
export async function ensureEnabled(): Promise<boolean> {
  const BleClient = await loadBleClient();
  await BleClient.initialize({ androidNeverForLocation: true });
  if (await BleClient.isEnabled()) return true;
  try {
    await BleClient.requestEnable();
  } catch {
    return false; // the user tapped Deny
  }
  return BleClient.isEnabled();
}

/** Android leaves the MTU at 23 unless the central asks. */
export async function negotiateMtu(deviceId: string): Promise<void> {
  const BleClient = await loadBleClient();
  try {
    const withMtu = BleClient as unknown as {
      requestMtu?: (id: string, mtu: number) => Promise<number>;
    };
    await withMtu.requestMtu?.(deviceId, DESIRED_MTU);
  } catch {
    // Negotiation failed; chunked lines still arrive, just in more packets.
  }
}
```

In `connect()`, replace the inline MTU `try { ... } catch { ... }` block (and its comment) with:

```ts
  // Not every device honours the request, which is why the parser below
  // reassembles anyway.
  await negotiateMtu(deviceId);
```

- [ ] **Step 3: Change `session.ts`**

In `pair()`, replace:

```ts
    await ble.initialize();
    if (!(await ble.isEnabled())) {
      set({ status: { state: 'error', message: 'Bluetooth is off. Turn it on and try again.' } });
      return;
    }
```

with:

```ts
    if (!(await ble.ensureEnabled())) {
      set({
        status: { state: 'error', message: 'Bluetooth is needed to connect. Tap Connect to try again.' },
      });
      return;
    }
```

- [ ] **Step 4: Typecheck**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
cd /c/lacs_thesis
git add apps/web/src/lib/native/ble.ts apps/web/src/lib/native/session.ts
git commit -m "fix(app): ask Android to turn Bluetooth on instead of giving up"
```

---

### Task 3: Setup link in the app

**Files:**
- Create: `apps/web/src/lib/native/roomSetup.ts`

**Interfaces:**
- Consumes: `loadBleClient`, `negotiateMtu`, `ScannedDevice` (Task 2); `SETUP_*`, `SetupLineParser`, `encodeSetupRequest`, `SetupHello`, `SetupJoin`, `SetupNetwork`, `SetupReply`, `SetupResult` (Task 1)
- Produces:
  - `class SetupTimeout extends Error`
  - `class SetupRefused extends Error { reason: 'busy' | 'bad_message' }`
  - `findRoomUnit(): Promise<ScannedDevice>`
  - `openSetup(device: ScannedDevice, onLost: () => void): Promise<SetupLink>`
  - `interface SetupLink { device; hello(): Promise<SetupHello>; scan(onNetwork: (n: SetupNetwork) => void): Promise<void>; join(req: Omit<SetupJoin, 'op'>, onStage: (stage: 'join' | 'server') => void): Promise<SetupResult>; close(): Promise<void> }`

- [ ] **Step 1: Write `roomSetup.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd /c/lacs_thesis
git add apps/web/src/lib/native/roomSetup.ts
git commit -m "feat(app): Bluetooth setup link to the room unit"
```

---

### Task 4: Setup wizard and Device tab entry

**Files:**
- Create: `apps/web/src/app/device/room-setup/page.tsx`
- Create: `apps/web/src/components/room-setup/Steps.tsx`
- Modify: `apps/web/src/app/device/page.tsx` (the "Add a band or room unit" card and its key note)

**Interfaces:**
- Consumes: Task 1 helpers (`mergeNetworks`, `signalBars`, `describeResult`, `joinProblem`, types), Task 2 `ensureEnabled`, Task 3 `findRoomUnit`, `openSetup`, `SetupLink`, `SetupTimeout`, `SetupRefused`; `api.claim`, `ApiError`, `API_URL` from `@/lib/api`; `isNative` from `@/lib/platform`; `SubPage`.
- Produces: route `/device/room-setup/`; components `FindStep`, `WifiStep`, `PasswordStep`, `ConnectingStep`, `ResultStep`.

- [ ] **Step 1: Write the step components**

`apps/web/src/components/room-setup/Steps.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { joinProblem, signalBars, type SetupHello, type SetupNetwork, type SetupOutcome } from '@lacs/contracts';

export type JoinStage = 'claim' | 'send' | 'join' | 'server';

export function FindStep({ busy, onSearch }: { busy: boolean; onSearch: () => void }) {
  return (
    <section className="card px-6 py-6">
      <h2 className="text-lg font-semibold">Find the room unit</h2>
      <p className="mt-2 text-muted">
        Keep the phone near the room unit. A new unit, or one without Wi-Fi, is ready on its own.
        If it is already online, hold its BOOT button for 3 seconds first.
      </p>
      <p className="mt-2 text-muted">
        The first time, Android asks to pair with Somnus-room-…. Tap Pair: it encrypts the link
        that carries your Wi-Fi password.
      </p>
      <button type="button" className="btn-primary mt-5" onClick={onSearch} disabled={busy}>
        {busy ? 'Connecting…' : 'Search'}
      </button>
    </section>
  );
}

function Bars({ rssi }: { rssi: number }) {
  const bars = signalBars(rssi);
  return (
    <span className="flex items-end gap-0.5" aria-label={`Signal ${bars} of 4`}>
      {[1, 2, 3, 4].map((b) => (
        <span
          key={b}
          className={`w-1 rounded-sm ${b <= bars ? 'bg-ink' : 'bg-line'}`}
          style={{ height: 4 + b * 3 }}
        />
      ))}
    </span>
  );
}

function Lock() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Password protected">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function WifiStep({
  hello,
  networks,
  scanning,
  onRescan,
  onPick,
}: {
  hello: SetupHello;
  networks: SetupNetwork[];
  scanning: boolean;
  onRescan: () => void;
  onPick: (ssid: string, secure: boolean, hidden: boolean) => void;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="px-6 pt-6">
        <h2 className="text-lg font-semibold">Choose a Wi-Fi network</h2>
        <p className="mt-1 text-sm text-muted">
          Connected to {hello.id} · {hello.wifi ? `currently on ${hello.wifi}` : 'not on Wi-Fi'}
        </p>
        <p className="mt-1 text-sm text-muted">Only 2.4 GHz networks the unit can hear are listed.</p>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {networks.map((n) => (
          <li key={n.ssid}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-6 py-4 text-left"
              onClick={() => onPick(n.ssid, n.secure, false)}
            >
              <Bars rssi={n.rssi} />
              <span className="flex-1 truncate font-medium">{n.ssid}</span>
              {n.secure && <Lock />}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="w-full px-6 py-4 text-left font-medium text-muted"
            onClick={() => onPick('', true, true)}
          >
            Other network…
          </button>
        </li>
      </ul>
      <div className="flex items-center justify-between px-6 py-4">
        <span className="text-sm text-muted">
          {scanning ? 'Looking for networks…' : `${networks.length} found`}
        </span>
        <button type="button" className="btn" onClick={onRescan} disabled={scanning}>
          Rescan
        </button>
      </div>
    </section>
  );
}

export function PasswordStep({
  ssid: initialSsid,
  secure,
  hidden,
  onBack,
  onSubmit,
}: {
  ssid: string;
  secure: boolean;
  hidden: boolean;
  onBack: () => void;
  onSubmit: (ssid: string, password: string) => void;
}) {
  const [ssid, setSsid] = useState(initialSsid);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const issue = joinProblem(ssid, secure ? password : '');
    setProblem(issue);
    if (!issue) onSubmit(ssid, secure ? password : '');
  };

  return (
    <form className="card space-y-4 px-6 py-6" onSubmit={submit}>
      <h2 className="text-lg font-semibold">{hidden ? 'Other network' : ssid}</h2>
      {hidden && (
        <input
          className="field w-full"
          placeholder="Network name"
          value={ssid}
          onChange={(e) => setSsid(e.target.value)}
          aria-label="Network name"
          autoFocus
        />
      )}
      {secure && (
        <div className="flex gap-2">
          <input
            className="field flex-1"
            type={show ? 'text' : 'password'}
            placeholder="Wi-Fi password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Wi-Fi password"
            autoFocus={!hidden}
          />
          <button type="button" className="btn" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
      )}
      {!secure && <p className="text-muted">This network has no password.</p>}
      {problem && <p className="text-sm text-alarm">{problem}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <button type="submit" className="btn-primary flex-1">
          Connect
        </button>
      </div>
    </form>
  );
}

const STAGES: { stage: JoinStage; label: (ssid: string) => string }[] = [
  { stage: 'claim', label: () => 'Adding to your account' },
  { stage: 'send', label: () => 'Sending to the room unit' },
  { stage: 'join', label: (ssid) => `Joining ${ssid}` },
  { stage: 'server', label: () => 'Checking the server' },
];

export function ConnectingStep({ ssid, stage }: { ssid: string; stage: JoinStage }) {
  const current = STAGES.findIndex((s) => s.stage === stage);
  const [slow, setSlow] = useState(false);

  // A sleeping Render instance takes up to a minute; say so instead of looking stuck.
  useEffect(() => {
    setSlow(false);
    if (stage !== 'server') return;
    const timer = setTimeout(() => setSlow(true), 5_000);
    return () => clearTimeout(timer);
  }, [stage]);

  return (
    <section className="card px-6 py-6">
      <h2 className="text-lg font-semibold">Connecting…</h2>
      <ol className="mt-4 space-y-3">
        {STAGES.map((s, i) => (
          <li key={s.stage} className={`flex items-center gap-3 ${i > current ? 'text-muted' : ''}`}>
            <span className="w-5 text-center">{i < current ? '✓' : i === current ? '•' : ''}</span>
            {s.label(ssid)}
          </li>
        ))}
      </ol>
      {slow && <p className="mt-4 text-sm text-muted">Waking the server… this can take up to a minute.</p>}
    </section>
  );
}

export function ResultStep({
  outcome,
  onRetry,
  onDone,
}: {
  outcome: SetupOutcome;
  onRetry: () => void;
  onDone: () => void;
}) {
  return (
    <section className="card px-6 py-6">
      <h2 className="text-lg font-semibold">
        {outcome.ok ? '✓ ' : ''}
        {outcome.title}
      </h2>
      <p className="mt-2 text-muted">{outcome.detail}</p>
      <div className="mt-5 flex gap-2">
        {outcome.backTo && (
          <button type="button" className="btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className={outcome.backTo ? 'btn' : 'btn-primary'} onClick={onDone}>
          {outcome.ok ? 'Go to Sleep' : 'Done'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write the page**

`apps/web/src/app/device/room-setup/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { describeResult, mergeNetworks, type SetupHello, type SetupNetwork, type SetupOutcome } from '@lacs/contracts';
import { API_URL, ApiError, api } from '@/lib/api';
import { isNative } from '@/lib/platform';
import { SubPage } from '@/components/SubPage';
import {
  ConnectingStep,
  FindStep,
  PasswordStep,
  ResultStep,
  WifiStep,
  type JoinStage,
} from '@/components/room-setup/Steps';
import type { SetupLink } from '@/lib/native/roomSetup';

type Step =
  | { name: 'find' }
  | { name: 'wifi' }
  | { name: 'password'; ssid: string; secure: boolean; hidden: boolean }
  | { name: 'connecting'; ssid: string; stage: JoinStage }
  | { name: 'result'; outcome: SetupOutcome };

/** Words for anything the Bluetooth side throws. */
async function errorText(err: unknown): Promise<string> {
  const { SetupRefused, SetupTimeout } = await import('@/lib/native/roomSetup');
  if (err instanceof SetupTimeout) {
    return 'The room unit did not answer. Keep the phone close, and hold its BOOT button for 3 seconds if it is already online.';
  }
  if (err instanceof SetupRefused) {
    return err.reason === 'busy'
      ? 'The room unit is busy. Wait a few seconds and try again.'
      : 'The room unit did not understand the app. Update its firmware.';
  }
  const message = (err as Error)?.message ?? String(err);
  if (/cancel/i.test(message)) return 'No room unit was chosen.';
  // A unit whose memory was erased no longer knows this phone, but Android
  // still thinks they are paired, so every encrypted write fails.
  if (/auth|encrypt|bond|insufficient/i.test(message)) {
    return 'The phone and the room unit no longer trust each other. In Android Bluetooth settings, forget Somnus-room-…, then search again.';
  }
  return message;
}

export default function RoomSetupPage() {
  const router = useRouter();
  const [native, setNative] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>({ name: 'find' });
  const [hello, setHello] = useState<SetupHello | null>(null);
  const [networks, setNetworks] = useState<SetupNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const link = useRef<SetupLink | null>(null);
  const last = useRef<{ ssid: string; password: string } | null>(null);

  useEffect(() => setNative(isNative()), []);
  useEffect(
    () => () => {
      void link.current?.close();
    },
    [],
  );

  const lost = useCallback(() => {
    link.current = null;
    setStep({ name: 'find' });
    setMessage('The room unit disconnected. Search again.');
  }, []);

  const scan = useCallback(async () => {
    const current = link.current;
    if (!current) return;
    setNetworks([]);
    setScanning(true);
    setMessage(null);
    try {
      await current.scan((n) => setNetworks((list) => mergeNetworks(list, n)));
    } catch (err) {
      setMessage(await errorText(err));
    } finally {
      setScanning(false);
    }
  }, []);

  const search = useCallback(async () => {
    setMessage(null);
    setBusy(true);
    try {
      const { ensureEnabled } = await import('@/lib/native/ble');
      if (!(await ensureEnabled())) {
        setMessage('Bluetooth is needed to set up the room unit. Tap Search to try again.');
        return;
      }
      const { findRoomUnit, openSetup } = await import('@/lib/native/roomSetup');
      const device = await findRoomUnit();
      link.current = await openSetup(device, lost);
      setHello(await link.current.hello());
      setStep({ name: 'wifi' });
      void scan();
    } catch (err) {
      await link.current?.close();
      link.current = null;
      setMessage(await errorText(err));
    } finally {
      setBusy(false);
    }
  }, [lost, scan]);

  const join = useCallback(
    async (ssid: string, password: string) => {
      const current = link.current;
      if (!current || !hello) return;
      last.current = { ssid, password };
      setMessage(null);

      // Claiming mints a new key and kills the old one, so it happens only
      // now, right before the unit is handed the new key.
      setStep({ name: 'connecting', ssid, stage: 'claim' });
      let key: string;
      try {
        key = (await api.claim(hello.id)).ingestToken;
      } catch (err) {
        const taken = err instanceof ApiError && err.status === 409;
        setStep({
          name: 'result',
          outcome: taken
            ? {
                ok: false,
                title: 'This room unit belongs to another account',
                detail: 'Remove it from that account first, then set it up again.',
                backTo: null,
              }
            : { ok: false, title: 'Could not add the room unit', detail: (err as Error).message, backTo: 'retry' },
        });
        return;
      }

      setStep({ name: 'connecting', ssid, stage: 'send' });
      try {
        const result = await current.join({ ssid, password, server: API_URL, key }, (stage) =>
          setStep({ name: 'connecting', ssid, stage }),
        );
        const outcome = describeResult(result);
        setStep({ name: 'result', outcome });
        if (outcome.ok) {
          // The unit closes Bluetooth itself a moment later.
          await current.close();
          link.current = null;
        }
      } catch (err) {
        setStep({
          name: 'result',
          outcome: { ok: false, title: 'No answer from the room unit', detail: await errorText(err), backTo: 'retry' },
        });
      }
    },
    [hello],
  );

  const retry = useCallback(
    (outcome: SetupOutcome) => {
      const prev = last.current;
      if (!link.current) {
        setStep({ name: 'find' });
        return;
      }
      if (outcome.backTo === 'wifi' || !prev) {
        setStep({ name: 'wifi' });
        void scan();
      } else if (outcome.backTo === 'password') {
        setStep({ name: 'password', ssid: prev.ssid, secure: true, hidden: false });
      } else {
        void join(prev.ssid, prev.password);
      }
    },
    [join, scan],
  );

  if (native === false) {
    return (
      <SubPage title="Set up the room unit">
        <section className="card px-6 py-6">
          <h2 className="text-lg font-semibold">Needs the Android app</h2>
          <p className="mt-2 text-muted">
            Setting up over Bluetooth only works in the Somnus app on Android.
          </p>
          <p className="mt-2 text-muted">
            Without it: on your phone, join the Wi-Fi network Somnus-room-… that the unit opens,
            then follow the page that appears.
          </p>
          <Link href="/download/" className="btn-primary mt-5 inline-block">
            Get the Android app
          </Link>
        </section>
      </SubPage>
    );
  }

  return (
    <SubPage title="Set up the room unit" subtitle="Wi-Fi, over Bluetooth">
      <div className="space-y-4">
        {step.name === 'find' && <FindStep busy={busy} onSearch={() => void search()} />}
        {step.name === 'wifi' && hello && (
          <WifiStep
            hello={hello}
            networks={networks}
            scanning={scanning}
            onRescan={() => void scan()}
            onPick={(ssid, secure, hidden) => setStep({ name: 'password', ssid, secure, hidden })}
          />
        )}
        {step.name === 'password' && (
          <PasswordStep
            ssid={step.ssid}
            secure={step.secure}
            hidden={step.hidden}
            onBack={() => setStep({ name: 'wifi' })}
            onSubmit={(ssid, password) => void join(ssid, password)}
          />
        )}
        {step.name === 'connecting' && <ConnectingStep ssid={step.ssid} stage={step.stage} />}
        {step.name === 'result' && (
          <ResultStep
            outcome={step.outcome}
            onRetry={() => retry(step.outcome)}
            onDone={() => router.push(step.outcome.ok ? '/sleep/' : '/device/')}
          />
        )}
        {message && <p className="rounded-2xl bg-card px-4 py-3 text-sm shadow-soft">{message}</p>}
      </div>
    </SubPage>
  );
}
```

Note: `PasswordStep` for a hidden network is shown with `secure: true` so a password field appears; an open hidden network is entered with an empty password, which `joinProblem` accepts.

- [ ] **Step 3: Point the Device tab at the wizard**

In `apps/web/src/app/device/page.tsx`, directly before the `<section className="card px-6 py-6">` that holds "Add a band or room unit", add:

```tsx
        <Link href="/device/room-setup/" className="card row rounded-card">
          <RadarIcon className="h-5 w-5 text-sleep" />
          <span className="flex-1">
            <span className="block font-medium">Set up the room unit over Bluetooth</span>
            <span className="block text-sm text-muted">Pick its Wi-Fi in the app. No keys to copy.</span>
          </span>
          <ChevronIcon className="h-5 w-5 text-muted" />
        </Link>
```

(`Link`, `RadarIcon` and `ChevronIcon` are already imported there.) Then replace the room-unit key note:

```tsx
                  ? 'Shown once. Put it in the room unit’s secrets.h as API_DEVICE_TOKEN, then flash it again.'
```

with:

```tsx
                  ? 'Shown once. Easier: use “Set up the room unit over Bluetooth” above, which sends the key for you. By hand: put it in secrets.h as API_DEVICE_TOKEN and flash again.'
```

- [ ] **Step 4: Typecheck and build**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web && npm run build --workspace @lacs/web`
Expected: both exit 0; the build output lists `/device/room-setup`.

- [ ] **Step 5: Check the browser fallback**

Run `npm run dev:web` in the background, open `http://localhost:3000/device/room-setup/` (logged in), and confirm the "Needs the Android app" card shows with a working link to `/download/`. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
cd /c/lacs_thesis
git add apps/web/src/app/device/room-setup/page.tsx apps/web/src/components/room-setup/Steps.tsx apps/web/src/app/device/page.tsx
git commit -m "feat(app): set up the room unit's Wi-Fi from the app over Bluetooth"
```

---

### Task 5: Firmware groundwork — antenna, settings, boot order

**Files (all in `C:\Users\moises\Documents\Arduino\esp_flash_mmwave`):**
- Modify: `esp_flash_mmwave.ino` — top config, `sendStatus()`, `loadSettings()`/`saveSettings()`, `setupWifi()`, `handleWifi()`, `handleButton()`, `handleCommand()`, `printHelp()`, `setup()`

**Interfaces:**
- Produces (used by Task 6):
  - `void applySettings(String url, String token)` — validates, saves to `roomcfg`, updates `apiUrl`/`apiToken`
  - `bool savedNetwork(String& ssid, String& password)`
  - `void fillStatus(JsonDocument& doc)`
  - `void startSetup()` — the single entry point for opening setup (this task: hotspot only)

- [ ] **Step 1: Baseline compile and record the size**

Run the compile command from Global Constraints.
Expected: success. Note the "Sketch uses N bytes (X%)" line — it is compared against in Task 6.

- [ ] **Step 2: External antenna**

Below `static const uint8_t PAYLOAD_VERSION = 2;` add:

```cpp
// 1 = the U.FL antenna on the connector, 0 = the ceramic one on the board.
// Wi-Fi and Bluetooth share whichever is chosen. Set 0 if the external
// antenna is ever unplugged, or range drops to almost nothing.
#define USE_EXTERNAL_ANTENNA 1
```

At the top of `setup()`, right after `delay(1500);`:

```cpp
  // The board package picks the ceramic antenna at boot (variant.cpp).
  pinMode(WIFI_ENABLE, OUTPUT);
  digitalWrite(WIFI_ENABLE, LOW);  // let this code drive the RF switch
  pinMode(WIFI_ANT_CONFIG, OUTPUT);
  digitalWrite(WIFI_ANT_CONFIG, USE_EXTERNAL_ANTENNA ? HIGH : LOW);
```

And after the `[BOOT] Somnus room unit` line:

```cpp
  Serial.printf("[BOOT] antenna: %s\n", USE_EXTERNAL_ANTENNA ? "external (U.FL)" : "built-in");
```

- [ ] **Step 3: Split `sendStatus()` so a status frame can be built without queueing it**

Replace `sendStatus()` with:

```cpp
void fillStatus(JsonDocument& doc) {
  envelope(doc, "status");
  bool radar = radarOk();
  doc["fw"] = ROOM_FW_VERSION;
  doc["transport"] = "wifi";
  doc["online"] = (radar ? 1 : 0) + (bulbReachable ? 1 : 0);
  doc["total"] = 2;
  JsonObject sensors = doc["sensors"].to<JsonObject>();
  sensors["sen0395"] = radar;
  sensors["bulb"] = bulbReachable;
  JsonObject config = doc["config"].to<JsonObject>();
  config["auto"] = autoMode;
  config["offDelayMs"] = OFF_DELAY_MS;
}

void sendStatus() {
  JsonDocument doc;
  fillStatus(doc);
  enqueue(doc);
  lastStatusRadar = radarOk();
  lastStatusBulb = bulbReachable;
  flushNow = true;
}
```

- [ ] **Step 4: One place that saves the server and key**

Replace `saveSettings()` with:

```cpp
/** Stores a server address and device key. Empty values keep what is there. */
void applySettings(String url, String token) {
  url.trim();
  token.trim();
  while (url.endsWith("/")) url.remove(url.length() - 1);

  Preferences prefs;
  prefs.begin("roomcfg", false);
  if (url.startsWith("http://") || url.startsWith("https://")) {
    apiUrl = url;
    prefs.putString("url", apiUrl);
  } else if (url.length() > 0) {
    Serial.println("[wifi] server address must start with http:// or https://, kept the old one");
  }
  if (token.length() > 0) {
    apiToken = token;
    prefs.putString("token", apiToken);
  }
  prefs.end();
  Serial.printf("[wifi] settings saved, server %s, key %.4s...\n", apiUrl.c_str(), apiToken.c_str());
}

/** Called when the setup page is saved. */
void saveSettings() {
  applySettings(paramUrl.getValue(), paramToken.getValue());
  paramToken.setValue("", 120);  // never echo the key back into the form
}
```

- [ ] **Step 5: Saved network first, `secrets.h` as fallback**

Add `#include <esp_wifi.h>` after `#include <WiFiManager.h>`.

Above `setupWifi()` add:

```cpp
/** The network the ESP has stored: from the app, the hotspot or a past join. */
bool savedNetwork(String& ssid, String& password) {
  ssid = "";
  password = "";
  wifi_config_t conf;
  if (esp_wifi_get_config(WIFI_IF_STA, &conf) != ESP_OK) return false;
  char s[33] = {0}, p[65] = {0};
  memcpy(s, conf.sta.ssid, 32);  // a 32-byte name has no terminator
  memcpy(p, conf.sta.password, 64);
  ssid = s;
  password = p;
  return ssid.length() > 0;
}

/** Blocking join, used at boot only. persist=false leaves the saved network alone. */
bool joinNow(const char* ssid, const char* password, bool persist) {
  Serial.printf("[wifi] joining \"%s\"\n", ssid);
  WiFi.persistent(persist);
  WiFi.begin(ssid, password);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  WiFi.persistent(true);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected to \"%s\", IP %s, %d dBm\n", ssid,
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return true;
  }
  Serial.printf("[wifi] could not join \"%s\": %s\n", ssid, wifiReason(WiFi.status()));
  return false;
}
```

`wifiReason()` is defined below `setupWifi()`; add a prototype under the state block so `joinNow` can call it:

```cpp
const char* wifiReason(wl_status_t s);
```

Replace the body of `setupWifi()` after the `wm.setDebugOutput(false);` line (everything from `if (strlen(WIFI_SSID) > 0) {` to the end of the function) with:

```cpp
  // The network last set from the app or the hotspot comes first; secrets.h
  // is only a fallback, so an old secrets.h never undoes a newer setup.
  String ssid, password;
  if (savedNetwork(ssid, password) && joinNow(ssid.c_str(), password.c_str(), true)) return;
  if (strlen(WIFI_SSID) > 0) {
    if (joinNow(WIFI_SSID, WIFI_PASSWORD, false)) return;
    scanNetworks();
  }
  Serial.printf("[wifi] no network in reach. Set it up from the Somnus app, or join \"%s\"\n", portalName);
  startSetup();
```

- [ ] **Step 6: `startSetup()` as the one way in**

Below `startPortal()` add:

```cpp
/** Opens every way to set the unit up. */
void startSetup() {
  startPortal();
}
```

Then replace `startPortal()` with `startSetup()` in: the end of `handleWifi()` (`if (now - offlineSinceMs > PORTAL_AFTER_MS) startPortal();`), `handleButton()`, and the `setup` branch of `handleCommand()`. Update their comments: "open setup (the app over Bluetooth, or the hotspot)". In `printHelp()` change the `setup` line to:

```cpp
    "  setup                       open setup: the Somnus app over Bluetooth, or the hotspot\n"
```

- [ ] **Step 7: Compile**

Run the compile command.
Expected: success.

- [ ] **Step 8: Flash and check on the bench**

Upload from Arduino IDE. In the Serial Monitor (115200): the boot shows `[BOOT] antenna: external (U.FL)` and joins the saved network. Run `scan` and write down the dBm of the home network (bench step 8 compares it with the built-in antenna: set `USE_EXTERNAL_ANTENNA 0`, flash, `scan`, then set it back to 1).

- [ ] **Step 9: Commit**

```bash
cd /c/Users/moises/Documents/Arduino/esp_flash_mmwave
git add esp_flash_mmwave.ino
git commit -m "feat: external antenna, saved network before secrets.h, one setup entry point"
```

---

### Task 6: Firmware — Bluetooth setup

**Files (in `esp_flash_mmwave`):**
- Create: `ble_setup.h`, `ble_setup.cpp`
- Modify: `esp_flash_mmwave.ino` — version, TIMING block, state, `startSetup()`, `handleWifi()`, `handleCommand()` status line, `loop()`, `setupWifi()`

**Interfaces:**
- Consumes: Task 5 `applySettings`, `savedNetwork`, `fillStatus`, `startSetup`; existing `apiRequest`, `deviceId`, `portalName`, `wm`.
- Produces: `SetupHooks`, `bleSetupInit`, `bleSetupStart`, `bleSetupStop`, `bleSetupActive`, `bleSetupConnected`, `bleSetupIdleMs`, `bleSetupLoop`, `bleSetupSend`, `bleSetupError` (see header below).

- [ ] **Step 1: Header**

`ble_setup.h`:

```cpp
#pragma once
#include <Arduino.h>

/*
 * Wi-Fi setup over Bluetooth. The Somnus app finds the unit, asks which
 * networks it can hear, and sends the network, password, server and key.
 * packages/contracts/src/setup.ts in the app repo is the other half.
 *
 * NimBLE callbacks run on the Bluetooth task, so they only queue complete
 * lines. bleSetupLoop(), called from loop(), hands them to the sketch.
 */

struct SetupHooks {
  void (*hello)();
  void (*scan)();
  void (*join)(const String& ssid, const String& password, const String& server, const String& key);
};

void bleSetupInit(const char* name, SetupHooks hooks);
void bleSetupStart();
void bleSetupStop();
bool bleSetupActive();
bool bleSetupConnected();
/** Time since a phone connected, disconnected or wrote. */
unsigned long bleSetupIdleMs();
void bleSetupLoop();
/** Sends one reply; the newline is added here. */
void bleSetupSend(const String& line);
void bleSetupError(const char* reason);
```

- [ ] **Step 2: Implementation**

`ble_setup.cpp`:

```cpp
#include "ble_setup.h"
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

static const char* SETUP_SERVICE = "f2c2717f-fa64-4ba7-ba20-32fe2257d551";
static const char* SETUP_RX = "62b01999-0497-4557-b649-fbd965a30353";  // app -> unit, encrypted write
static const char* SETUP_TX = "be53eb28-bb81-410f-99e6-4cbe6e0ff788";  // unit -> app, notify

// The longest join (32-byte name, 63-char password, server, key) is ~300 bytes.
static const size_t LINE_MAX = 384;
struct Line {
  char text[LINE_MAX];
};

static String deviceName;
static SetupHooks hooks;
static bool active = false;
static volatile bool connected = false;
static volatile uint16_t mtu = 23;
static volatile unsigned long lastActivityMs = 0;
static QueueHandle_t inbox = nullptr;
static NimBLECharacteristic* tx = nullptr;
static String partial;  // only touched on the Bluetooth task

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo& info) override {
    connected = true;
    mtu = info.getMTU();
    lastActivityMs = millis();
    // One phone at a time: nobody else should find the unit while it is busy.
    NimBLEDevice::stopAdvertising();
    Serial.println("[ble ] phone connected");
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    connected = false;
    partial = "";
    lastActivityMs = millis();
    if (active) NimBLEDevice::startAdvertising();
    Serial.println("[ble ] phone disconnected");
  }
  void onMTUChange(uint16_t value, NimBLEConnInfo&) override { mtu = value; }
  void onAuthenticationComplete(NimBLEConnInfo& info) override {
    Serial.printf("[ble ] link %s\n", info.isEncrypted() ? "encrypted" : "NOT encrypted (pairing failed)");
  }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& info) override {
    // WRITE_ENC already refuses plain writes; this is a second lock on the same door.
    if (!info.isEncrypted()) return;
    lastActivityMs = millis();
    NimBLEAttValue value = c->getValue();
    partial.concat(reinterpret_cast<const char*>(value.data()), value.length());
    int nl;
    while ((nl = partial.indexOf('\n')) >= 0) {
      Line msg;
      if ((size_t)nl < LINE_MAX) {
        memcpy(msg.text, partial.c_str(), nl);
        msg.text[nl] = 0;
      } else {
        strcpy(msg.text, "{}");  // too long to be ours: answered with bad_message
      }
      partial.remove(0, nl + 1);
      xQueueSend(inbox, &msg, 0);
    }
    if (partial.length() > LINE_MAX) partial = "";  // a line that never ends
  }
};

void bleSetupInit(const char* name, SetupHooks h) {
  deviceName = name;
  hooks = h;
  if (!inbox) inbox = xQueueCreate(4, sizeof(Line));
}

void bleSetupStart() {
  if (active) return;
  NimBLEDevice::init(deviceName.c_str());
  NimBLEDevice::setMTU(517);
  // Bond, no PIN (the unit has no screen), LE Secure Connections.
  NimBLEDevice::setSecurityAuth(true, false, true);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  NimBLEService* service = server->createService(SETUP_SERVICE);
  NimBLECharacteristic* rx =
      service->createCharacteristic(SETUP_RX, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC);
  rx->setCallbacks(new RxCallbacks());
  tx = service->createCharacteristic(SETUP_TX, NIMBLE_PROPERTY::NOTIFY);
  service->start();
  server->start();

  // The 128-bit service id fills most of the 31-byte advertisement, so the
  // name goes in the scan response.
  NimBLEAdvertisementData adv;
  adv.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  adv.addServiceUUID(SETUP_SERVICE);
  NimBLEAdvertisementData scan;
  scan.setName(deviceName.c_str());
  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->setAdvertisementData(adv);
  advertising->setScanResponseData(scan);
  advertising->enableScanResponse(true);
  NimBLEDevice::startAdvertising();

  active = true;
  connected = false;
  lastActivityMs = millis();
  Serial.printf("[ble ] setup open as \"%s\": open Device > Set up the room unit in the Somnus app\n",
                deviceName.c_str());
}

void bleSetupStop() {
  if (!active) return;
  active = false;
  connected = false;
  tx = nullptr;
  NimBLEDevice::deinit(true);  // gives the Bluetooth stack's RAM back to TLS
  partial = "";
  if (inbox) xQueueReset(inbox);
  Serial.println("[ble ] setup closed");
}

bool bleSetupActive() { return active; }
bool bleSetupConnected() { return active && connected; }
unsigned long bleSetupIdleMs() { return millis() - lastActivityMs; }

void bleSetupSend(const String& line) {
  if (!active || !connected || !tx) return;
  String out = line + "\n";
  size_t chunk = mtu > 3 ? mtu - 3 : 20;
  for (size_t i = 0; i < out.length(); i += chunk) {
    size_t n = min(chunk, out.length() - i);
    // The stack has a few notification buffers; a scan sends ~20 lines at once.
    for (int tries = 0; !tx->notify(reinterpret_cast<const uint8_t*>(out.c_str()) + i, n) && tries < 20; tries++)
      delay(10);
  }
}

void bleSetupError(const char* reason) {
  bleSetupSend(String("{\"op\":\"error\",\"reason\":\"") + reason + "\"}");
}

static bool validJoin(const String& ssid, const String& password, const String& server, const String& key) {
  // Same rules as setupRequestSchema in the app.
  if (ssid.length() < 1 || ssid.length() > 32) return false;  // String length is bytes
  if (password.length() != 0 && (password.length() < 8 || password.length() > 63)) return false;
  if (!server.startsWith("http://") && !server.startsWith("https://")) return false;
  return key.length() > 0;
}

void bleSetupLoop() {
  if (!active || !inbox) return;
  Line msg;
  while (xQueueReceive(inbox, &msg, 0) == pdTRUE) {
    JsonDocument doc;
    if (deserializeJson(doc, msg.text)) {
      bleSetupError("bad_message");
      continue;
    }
    const char* op = doc["op"] | "";
    if (strcmp(op, "hello") == 0) {
      hooks.hello();
    } else if (strcmp(op, "scan") == 0) {
      hooks.scan();
    } else if (strcmp(op, "join") == 0) {
      String ssid = doc["ssid"] | "";
      String password = doc["password"] | "";
      String server = doc["server"] | "";
      String key = doc["key"] | "";
      if (validJoin(ssid, password, server, key)) hooks.join(ssid, password, server, key);
      else bleSetupError("bad_message");
    } else {
      bleSetupError("bad_message");
    }
  }
}
```

The app counts the 32-byte limit in UTF-8 bytes too, so both ends agree for non-ASCII names.

- [ ] **Step 3: Version, timing and state in the sketch**

`#include "ble_setup.h"` after `#include "secrets.h"`. Set `#define ROOM_FW_VERSION "0.4.0"`. In the TIMING block add:

```cpp
const unsigned long SETUP_IDLE_CLOSE_MS = 300000;  // Bluetooth setup closes after 5 min with Wi-Fi up and no phone
const unsigned long JOIN_TIMEOUT_MS  = 20000;  // a join from the app gets this long
const unsigned long SERVER_CHECK_MS  = 60000;  // a sleeping Render instance takes up to a minute
```

In the state block add:

```cpp
// A join requested from the app over Bluetooth, worked through from loop().
enum JoinStage { JOIN_IDLE, JOIN_WIFI, JOIN_SERVER };
JoinStage joinStage = JOIN_IDLE;
unsigned long joinStartedMs = 0;
unsigned long lastServerTryMs = 0;
String joinSsid, prevSsid, prevPassword;
bool scanPending = false;
unsigned long setupCloseAtMs = 0;  // 0 = not scheduled
```

- [ ] **Step 4: The three hooks**

Add a new section above `// ------------------------------- Setup ---`:

```cpp
// --------------------------- Bluetooth setup ---------------------------

void sendHello() {
  JsonDocument doc;
  doc["op"] = "hello";
  doc["id"] = deviceId;
  doc["fw"] = ROOM_FW_VERSION;
  if (WiFi.status() == WL_CONNECTED) doc["wifi"] = WiFi.SSID();
  else doc["wifi"] = nullptr;
  String line;
  serializeJson(doc, line);
  bleSetupSend(line);
}

void startScan() {
  if (scanPending || joinStage != JOIN_IDLE) {
    bleSetupError("busy");
    return;
  }
  WiFi.scanDelete();
  if (WiFi.scanNetworks(true) == WIFI_SCAN_FAILED) {
    bleSetupSend("{\"op\":\"scan_done\"}");
    return;
  }
  scanPending = true;
}

/** Streams the scan to the app once it finishes. Hidden networks are typed in the app instead. */
void finishScan() {
  if (!scanPending) return;
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return;
  scanPending = false;
  for (int i = 0; i < n && i < 30; i++) {
    if (WiFi.SSID(i).length() == 0) continue;
    JsonDocument doc;
    doc["op"] = "net";
    doc["ssid"] = WiFi.SSID(i);
    doc["rssi"] = WiFi.RSSI(i);
    doc["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    String line;
    serializeJson(doc, line);
    bleSetupSend(line);
  }
  WiFi.scanDelete();
  bleSetupSend("{\"op\":\"scan_done\"}");
}

void startJoin(const String& ssid, const String& password, const String& server, const String& key) {
  if (joinStage != JOIN_IDLE || scanPending) {
    bleSetupError("busy");
    return;
  }
  // The app claimed the unit just before this, so the old key is already
  // dead: keep the new one whatever happens to Wi-Fi.
  applySettings(server, key);
  savedNetwork(prevSsid, prevPassword);
  if (wm.getConfigPortalActive()) wm.stopConfigPortal();

  Serial.printf("[ble ] joining \"%s\" (password ****)\n", ssid.c_str());
  WiFi.begin(ssid.c_str(), password.length() ? password.c_str() : nullptr);
  joinSsid = ssid;
  joinStage = JOIN_WIFI;
  joinStartedMs = millis();
  bleSetupSend("{\"op\":\"joining\"}");
}

void sendResult(const char* wifi, const char* server) {
  JsonDocument doc;
  doc["op"] = "result";
  doc["wifi"] = wifi;
  if (server) doc["server"] = server;
  else doc["server"] = nullptr;
  String line;
  serializeJson(doc, line);
  bleSetupSend(line);
}

/** A failed join must not strand a unit that had a working network. */
void restorePreviousNetwork() {
  if (prevSsid.length() > 0) {
    Serial.printf("[wifi] going back to \"%s\"\n", prevSsid.c_str());
    WiFi.begin(prevSsid.c_str(), prevPassword.c_str());  // also saves it again
  } else {
    WiFi.disconnect(false, true);  // forget the credentials that did not work
  }
}

/** Posts one status frame now; the server's answer proves the new key works. */
int postStatusNow() {
  JsonDocument doc;
  fillStatus(doc);
  String frame;
  serializeJson(doc, frame);
  return apiRequest("POST", "/ingest", "{\"frames\":[" + frame + "]}", nullptr);
}

void handleJoin(unsigned long now) {
  if (joinStage == JOIN_WIFI) {
    wl_status_t s = WiFi.status();
    if (s == WL_CONNECTED) {
      Serial.printf("[ble ] joined \"%s\", IP %s, %d dBm. Checking the server\n", joinSsid.c_str(),
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      bleSetupSend("{\"op\":\"checking\"}");
      joinStage = JOIN_SERVER;
      joinStartedMs = now;
      lastServerTryMs = 0;
      return;
    }
    // The first moments can still show the status of the previous network.
    bool settled = now - joinStartedMs > 3000;
    const char* fail = nullptr;
    if (settled && s == WL_CONNECT_FAILED) fail = "wrong_password";
    else if (settled && s == WL_NO_SSID_AVAIL) fail = "not_found";
    else if (now - joinStartedMs > JOIN_TIMEOUT_MS) fail = "timeout";
    if (!fail) return;
    Serial.printf("[ble ] could not join \"%s\": %s\n", joinSsid.c_str(), fail);
    restorePreviousNetwork();
    sendResult(fail, nullptr);
    joinStage = JOIN_IDLE;
    return;
  }

  if (joinStage == JOIN_SERVER) {
    // One 10 s attempt at a time, with the radar running in between.
    if (lastServerTryMs != 0 && now - lastServerTryMs < 2000) return;
    lastServerTryMs = now;
    int code = postStatusNow();
    const char* server = nullptr;
    if (code >= 200 && code < 300) server = "ok";
    else if (code == 401 || code == 403) server = "unauthorized";
    else if (now - joinStartedMs > SERVER_CHECK_MS) server = "unreachable";
    if (!server) {
      Serial.printf("[ble ] server answered %d, trying again\n", code);
      return;
    }
    Serial.printf("[ble ] server check: %s\n", server);
    sendResult("ok", server);
    joinStage = JOIN_IDLE;
    if (strcmp(server, "ok") == 0) setupCloseAtMs = now + 3000;  // let the app read the result first
  }
}

/** Closes Bluetooth after a successful setup, or after an accidental BOOT hold. */
void closeSetupWhenDone(unsigned long now) {
  if (!bleSetupActive()) {
    setupCloseAtMs = 0;
    return;
  }
  if (setupCloseAtMs != 0 && (long)(now - setupCloseAtMs) >= 0) {
    setupCloseAtMs = 0;
    bleSetupStop();
    return;
  }
  if (WiFi.status() == WL_CONNECTED && joinStage == JOIN_IDLE && !bleSetupConnected() &&
      bleSetupIdleMs() > SETUP_IDLE_CLOSE_MS)
    bleSetupStop();
}
```

- [ ] **Step 5: Wire it in**

`startSetup()` becomes:

```cpp
/** Opens every way to set the unit up: Bluetooth for the app, and the hotspot. */
void startSetup() {
  startPortal();
  bleSetupStart();
}
```

In `setupWifi()`, right after `wm.setDebugOutput(false);`:

```cpp
  bleSetupInit(portalName, {sendHello, startScan, startJoin});
```

In `handleWifi()`, right after `wm.process();`:

```cpp
  // A join from the app is in charge of the radio until it finishes.
  if (joinStage != JOIN_IDLE) return;
```

In `loop()`, after `updateRadar();`:

```cpp
  bleSetupLoop();
  finishScan();
  handleJoin(now);
  closeSetupWhenDone(now);
```

In the `status` command, change the hotspot fragment to also report Bluetooth:

```cpp
                    wm.getConfigPortalActive() ? " (setup hotspot open)" : "",
```

becomes

```cpp
                    bleSetupActive() ? " (setup open: app + hotspot)" : wm.getConfigPortalActive() ? " (setup hotspot open)" : "",
```

The functions in Step 4 are defined after `setupWifi()` and `loop()` use them; add prototypes under the state block:

```cpp
void sendHello();
void startScan();
void startJoin(const String& ssid, const String& password, const String& server, const String& key);
void handleJoin(unsigned long now);
void finishScan();
void closeSetupWhenDone(unsigned long now);
```

- [ ] **Step 6: Compile and check the size**

Run the compile command.
Expected: success. If it fails with "Sketch too big", rerun with `--fqbn esp32:esp32:XIAO_ESP32C6:PartitionScheme=huge_app` and record that the README must tell the user to pick *Tools → Partition Scheme → Huge APP (3MB No OTA/1MB SPIFFS)*. Record the final size and the increase over the Task 5 baseline.

- [ ] **Step 7: Bench smoke test**

Flash. In the Serial Monitor type `setup`: expect `[ble ] setup open as "Somnus-room-xxxxxx"`. On the phone (nRF Connect or the app build from Task 7), confirm the unit shows up and, after pairing, `{"op":"hello"}` gets the hello reply. Without pairing, a write must be refused.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/moises/Documents/Arduino/esp_flash_mmwave
git add ble_setup.h ble_setup.cpp esp_flash_mmwave.ino
git commit -m "feat: set up Wi-Fi, server and key from the Somnus app over encrypted Bluetooth"
```

---

### Task 7: Docs, bench checklist and full verification

**Files:**
- Modify: `C:\Users\moises\Documents\Arduino\esp_flash_mmwave\README.md`
- Modify: the comment block at the top of `esp_flash_mmwave.ino` (the `WiFi:` bullet and `Libraries:` line)

- [ ] **Step 1: Header comment**

In the top comment of `esp_flash_mmwave.ino`, replace the `- WiFi: tries WIFI_SSID ...` bullet with:

```
 * - WiFi: set from the Somnus app over Bluetooth (Device > Set up the room
 *   unit). Setup opens on its own when the unit has no network, or when BOOT
 *   is held 3 s; the Somnus-room-xxxxxx hotspot opens at the same time as a
 *   backup. The saved network is tried first, WIFI_SSID in secrets.h after.
```

and the libraries line with:

```
 * Libraries: ArduinoJson 7.x, WiFiManager 2.0.x (tzapu), NimBLE-Arduino 2.x (h2zero).
```

- [ ] **Step 2: README**

Add these sections to `README.md` (keep what is there; update any text that says the key must go in `secrets.h` and be flashed):

```markdown
## Setting up Wi-Fi from the app

1. Power the unit. With no saved network it opens setup by itself; if it is
   already online, hold BOOT for 3 seconds.
2. In the Somnus app: Device > Set up the room unit over Bluetooth > Search.
3. Pick Somnus-room-xxxxxx. The first time, Android asks to pair: tap Pair.
   This encrypts the link that carries the Wi-Fi password.
4. Pick the network, type the password, Connect. The app adds the unit to
   your account and sends the network, password, server address and key.
5. "Room unit is online" means Wi-Fi works and the server accepted the key.

`secrets.h` no longer needs `API_DEVICE_TOKEN` or the WiFi lines; they are
only fallbacks. The Tuya lines are still required.

If the unit's flash is erased, the phone still thinks it is paired. Forget
Somnus-room-xxxxxx in Android Bluetooth settings before setting it up again.

## Antenna

`USE_EXTERNAL_ANTENNA` (top of the sketch) picks the U.FL antenna. Wi-Fi
and Bluetooth share it. Set it to 0 if the external antenna is unplugged.

## Partition scheme

<!-- Fill from Task 6 Step 6: either "Default works" or the Huge APP instruction, with the measured size. -->

## Bench checklist (run after every firmware change to setup)

1. `forget wifi`, then set the unit up from the app end to end.
2. Wrong password: the app says "Wrong password"; the unit goes back to its
   previous network; retrying with the right one works.
3. A network that does not exist, or is 5 GHz only: "Network not found".
4. While online, hold BOOT: setup opens. With no phone connected it closes
   after 5 minutes (`[ble ] setup closed`).
5. Walk in front of the radar during setup: the bulb still switches.
6. Reboot: the unit rejoins on its own. The previous key is refused by the
   server (re-setup minted a new one).
7. Forget the unit in Android Bluetooth settings without pairing again, then
   search: the app explains how to fix it instead of timing out.
8. `scan` with `USE_EXTERNAL_ANTENNA` 1 and 0; write down both dBm values.
9. Note the build size and the partition scheme used.
```

Replace the HTML comment under "Partition scheme" with the real result from Task 6 Step 6 (for example: "Default (1.2 MB app) is too small since 0.4.0: choose Tools > Partition Scheme > Huge APP (3MB No OTA/1MB SPIFFS). Build size: N bytes.").

- [ ] **Step 3: Full verification in the app repo**

Run: `cd /c/lacs_thesis && npm run build:contracts && npm test && npm run typecheck && npm run build --workspace @lacs/web`
Expected: all pass; record the counts.

- [ ] **Step 4: Firmware compile**

Run the compile command (with the partition option if Task 6 needed it).
Expected: success.

- [ ] **Step 5: On the phone**

Build the debug APK (`npm run apk:debug --workspace @lacs/mobile`), install it, and run bench steps 1–7 with the user. Bluetooth off at the start: the "turn on Bluetooth?" prompt appears and setup continues after Allow (v2 item 2).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/moises/Documents/Arduino/esp_flash_mmwave
git add README.md esp_flash_mmwave.ino
git commit -m "docs: app setup over Bluetooth, antenna, partition and bench checklist"
```

No release in this plan: the version bump and APK release happen once, after all six v2 items (see docs/RELEASING.md).
