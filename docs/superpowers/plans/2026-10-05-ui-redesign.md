# Somnus UI Redesign (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the app as the five-tab design from the mockups (Home, Sleep, Health, Bed, More), dark by default with a light option, every number real.

**Architecture:** Theme tokens change value (names stay) so every screen follows. A small `components/ui/` kit (tiles, ring, tabs, rows, pills, strips, charts, colour wheel) is built once and every tab is rebuilt from it. Two read-only endpoints feed the charts that have no data source today: a per-bucket readings summary and a room-presence window. Old pages move under More; old addresses forward.

**Tech Stack:** Next.js 15 static export in Capacitor 7, React 19, Tailwind 3 with CSS-variable tokens, hand-drawn SVG; Express + Mongoose API; zod contracts; vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-ui-redesign-design.md`

## Global Constraints

- Dark is the default theme; `light` and `system` stay selectable. Stored `night` → `dark`, `soft` → `light`, anything else → `dark`.
- No new runtime dependencies. `vitest` is the only new dev dependency (apps/web).
- Unbuilt features are hidden, never faked: no Sleep Activity/Events/Reports tabs, no Sleep & Wellness rows, no Alerts, no Breathing tile, no bell, no Weekly/Monthly.
- Exercise is removed; `/exercise/` forwards to `/home/`.
- Old addresses forward with `router.replace`: `/device/` → `/more/devices/`, `/device/room-setup/` → `/more/devices/room-setup/`, `/node/` → `/more/devices/pair/`, `/me/` → `/more/settings/`, `/history/` → `/more/history/` (query kept), `/exercise/` → `/home/`.
- Thresholds: `hrStatus` < 50 Low, 50–100 Normal, > 100 High. `stressLevel` rise over base < 10 % Low, 10–25 % Medium, > 25 % High. `movementLevel` mean `|mag − 1|` < 0.05 Low, < 0.20 Medium, else High. Greeting 05–12 morning, 12–18 afternoon, else evening.
- Presence: no frame for more than 90 s (`NIGHT.staleMs`) means "no data", never "empty".
- `/room/presence?minutes=` accepts only 60, 360, 1440. `/readings/series`: `to − from` ≤ 7 days, `bucketSec` 60–3600 (default 300).
- Movement on Bed/Home is labelled as coming from the wristband.
- Colours in SVG go through `style`, not presentation attributes (CSS variables do not resolve in attributes).
- Commands reuse the existing queue: `{cmd:'light', …}`, `{cmd:'auto', on}`, `{cmd:'status'}`.
- `scripts/seed-demo.mjs` refuses any API host other than `localhost` / `127.0.0.1`.
- Commit with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer. Never stage `apps/web/tsconfig.tsbuildinfo`.

## Review Focus

1. **Theme carried over from 0.5.0** — a phone that chose "Soft" must open light, "Night" dark, nothing stored dark, with no flash of the wrong theme on load. Pinned by `normalizeTheme` tests (Task 3) and the bootstrap string check (Task 4).
2. **Room unit offline mid-window** — the presence strip must show hatched "no data", not "empty", and the summary must not count it as time out of bed. Pinned by `presenceSegments` gap tests and `presenceSummary` tests (Task 1).
3. **Band never wore / never sent data today** — every Health tab, Home tile and chart must show `--` or "Not enough readings yet", never `NaN`, `0 BPM` or a crash on empty arrays. Pinned by `LineChart` empty branch, `chartStats([])` test (Task 3) and the empty-account screenshot pass (Task 11).
4. **Old links and the installed 0.5.0 app** — `/device/`, `/me/`, `/history/?id=…`, `/node/`, `/exercise/` must land on the new page with the query intact. Pinned by `forwardTarget` tests (Task 3) and the route check in Task 11.
5. **Colour wheel drag on a phone** — dragging must not scroll the page, and only the release sends a command. Pinned by `touch-none` + pointer capture in `ColorWheel` (Task 5), the `wheelToHueSat` round-trip tests (Task 3) and the phone check (Task 11).

---

### Task 1: Presence segments and series types in contracts

**Files:**
- Create: `packages/contracts/src/presence.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/presence.test.ts`

**Interfaces:**
- Produces (from `@lacs/contracts`):
  - `PRESENCE_WINDOWS = [60, 360, 1440] as const`; `roomPresenceQuerySchema` (zod, `minutes`)
  - `interface PresencePoint { at: number; present: boolean }`
  - `interface RoomPresence { before: { present: boolean; at: string } | null; frames: { present: boolean; at: string }[] }`
  - `type PresenceKind = 'present' | 'empty' | 'none'`; `interface PresenceSegment { from: number; to: number; kind: PresenceKind }`
  - `presenceSegments(args: { before: PresencePoint | null; frames: PresencePoint[]; from: number; to: number; now: number }): PresenceSegment[]`
  - `presenceSummary(segments: PresenceSegment[]): { presentMs: number; exits: number; lastExitAt: number | null }`
  - `toPresencePoints(r: RoomPresence): { before: PresencePoint | null; frames: PresencePoint[] }`
  - `readingSeriesQuerySchema` (zod: `from`, `to`, `bucketSec`); `interface SeriesPoint { at: string; bpm: number | null; spo2: number | null; gsr: number | null; motion: number | null }`

- [ ] **Step 0: Confirm the branch**

Run: `cd /c/lacs_thesis && git branch --show-current`
Expected: `feat/ui-redesign`

- [ ] **Step 1: Write the failing tests**

`packages/contracts/test/presence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  presenceSegments,
  presenceSummary,
  readingSeriesQuerySchema,
  roomPresenceQuerySchema,
  toPresencePoints,
  type PresencePoint,
} from '../src/index.js';

const MIN = 60_000;
const FROM = 1_000_000_000_000;
const TO = FROM + 60 * MIN;

/** One presence frame a minute from `start` (inclusive) to `end` (exclusive). */
function beats(start: number, end: number, present: boolean): PresencePoint[] {
  const out: PresencePoint[] = [];
  for (let at = start; at < end; at += MIN) out.push({ at, present });
  return out;
}

describe('presenceSegments', () => {
  it('is all "none" for a unit that never reported', () => {
    expect(presenceSegments({ before: null, frames: [], from: FROM, to: TO, now: TO })).toEqual([
      { from: FROM, to: TO, kind: 'none' },
    ]);
  });

  it('carries a fresh state in from before the window', () => {
    const segs = presenceSegments({
      before: { at: FROM - 30_000, present: true },
      frames: beats(FROM + 30_000, TO, true),
      from: FROM,
      to: TO,
      now: TO,
    });
    expect(segs).toEqual([{ from: FROM, to: TO, kind: 'present' }]);
  });

  it('treats a stale state from before the window as unknown', () => {
    const segs = presenceSegments({
      before: { at: FROM - 10 * MIN, present: true },
      frames: beats(FROM + 5 * MIN, TO, true),
      from: FROM,
      to: TO,
      now: TO,
    });
    expect(segs).toEqual([
      { from: FROM, to: FROM + 5 * MIN, kind: 'none' },
      { from: FROM + 5 * MIN, to: TO, kind: 'present' },
    ]);
  });

  it('splits present and empty where the radar changed', () => {
    const segs = presenceSegments({
      before: null,
      frames: [...beats(FROM, FROM + 20 * MIN, true), ...beats(FROM + 20 * MIN, TO, false)],
      from: FROM,
      to: TO,
      now: TO,
    });
    expect(segs).toEqual([
      { from: FROM, to: FROM + 20 * MIN, kind: 'present' },
      { from: FROM + 20 * MIN, to: TO, kind: 'empty' },
    ]);
  });

  it('shows a reporting gap as "none", starting 90 s after the last frame', () => {
    const segs = presenceSegments({
      before: null,
      frames: [...beats(FROM, FROM + 10 * MIN, true), ...beats(FROM + 30 * MIN, TO, true)],
      from: FROM,
      to: TO,
      now: TO,
    });
    expect(segs).toEqual([
      { from: FROM, to: FROM + 9 * MIN + 90_000, kind: 'present' },
      { from: FROM + 9 * MIN + 90_000, to: FROM + 30 * MIN, kind: 'none' },
      { from: FROM + 30 * MIN, to: TO, kind: 'present' },
    ]);
  });

  it('stops drawing at now', () => {
    const now = FROM + 30 * MIN;
    const segs = presenceSegments({ before: null, frames: beats(FROM, now, false), from: FROM, to: TO, now });
    expect(segs).toEqual([{ from: FROM, to: now, kind: 'empty' }]);
  });

  it('draws nothing when now is before the window', () => {
    expect(presenceSegments({ before: null, frames: [], from: FROM, to: TO, now: FROM - 1 })).toEqual([]);
  });
});

describe('presenceSummary', () => {
  it('counts time present and each present-to-empty change', () => {
    const summary = presenceSummary([
      { from: 0, to: 10 * MIN, kind: 'present' },
      { from: 10 * MIN, to: 12 * MIN, kind: 'empty' },
      { from: 12 * MIN, to: 40 * MIN, kind: 'present' },
      { from: 40 * MIN, to: 45 * MIN, kind: 'empty' },
    ]);
    expect(summary).toEqual({ presentMs: 38 * MIN, exits: 2, lastExitAt: 40 * MIN });
  });

  it('does not call a reporting gap an exit', () => {
    const summary = presenceSummary([
      { from: 0, to: 10 * MIN, kind: 'present' },
      { from: 10 * MIN, to: 20 * MIN, kind: 'none' },
      { from: 20 * MIN, to: 30 * MIN, kind: 'empty' },
    ]);
    expect(summary).toEqual({ presentMs: 10 * MIN, exits: 0, lastExitAt: null });
  });
});

describe('toPresencePoints', () => {
  it('turns the API body into epoch points', () => {
    expect(
      toPresencePoints({
        before: { present: true, at: '2026-10-05T00:00:00.000Z' },
        frames: [{ present: false, at: '2026-10-05T00:01:00.000Z' }],
      }),
    ).toEqual({
      before: { present: true, at: Date.parse('2026-10-05T00:00:00.000Z') },
      frames: [{ present: false, at: Date.parse('2026-10-05T00:01:00.000Z') }],
    });
  });
});

describe('query schemas', () => {
  it('accepts only the three presence windows', () => {
    expect(roomPresenceQuerySchema.parse({}).minutes).toBe(60);
    expect(roomPresenceQuerySchema.parse({ minutes: '1440' }).minutes).toBe(1440);
    expect(roomPresenceQuerySchema.safeParse({ minutes: '7' }).success).toBe(false);
  });

  it('limits a series to seven days, from before to', () => {
    const from = '2026-10-01T00:00:00.000Z';
    expect(readingSeriesQuerySchema.parse({ from, to: '2026-10-02T00:00:00.000Z' }).bucketSec).toBe(300);
    expect(readingSeriesQuerySchema.safeParse({ from, to: '2026-10-09T00:00:01.000Z' }).success).toBe(false);
    expect(readingSeriesQuerySchema.safeParse({ from, to: from }).success).toBe(false);
    expect(readingSeriesQuerySchema.safeParse({ from, to: '2026-10-02T00:00:00.000Z', bucketSec: '30' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/contracts -- presence`
Expected: FAIL — `presenceSegments is not a function` (and the other imports).

- [ ] **Step 3: Implement**

`packages/contracts/src/presence.ts`:

```ts
import { z } from 'zod';
import { NIGHT } from './night.js';

/**
 * The room unit's presence over a short window, for the Bed and Home strips.
 *
 * The unit reports on every change and every 60 s as a heartbeat. A silence
 * longer than NIGHT.staleMs means it was offline, which is "no data", never
 * "nobody there".
 */

export const PRESENCE_WINDOWS = [60, 360, 1440] as const;

export const roomPresenceQuerySchema = z.object({
  minutes: z.coerce
    .number()
    .int()
    .refine((m) => (PRESENCE_WINDOWS as readonly number[]).includes(m), 'minutes must be 60, 360 or 1440')
    .default(60),
});

export interface PresencePoint {
  at: number;
  present: boolean;
}

/** GET /devices/:id/room/presence. Frames oldest first. */
export interface RoomPresence {
  before: { present: boolean; at: string } | null;
  frames: { present: boolean; at: string }[];
}

export type PresenceKind = 'present' | 'empty' | 'none';

export interface PresenceSegment {
  from: number;
  to: number;
  kind: PresenceKind;
}

export function toPresencePoints(r: RoomPresence): { before: PresencePoint | null; frames: PresencePoint[] } {
  const point = (p: { present: boolean; at: string }): PresencePoint => ({ at: Date.parse(p.at), present: p.present });
  return { before: r.before ? point(r.before) : null, frames: r.frames.map(point) };
}

export function presenceSegments(args: {
  before: PresencePoint | null;
  frames: PresencePoint[];
  from: number;
  to: number;
  now: number;
}): PresenceSegment[] {
  const { from } = args;
  const end = Math.min(args.to, args.now);
  if (end <= from) return [];

  const points = [...(args.before ? [args.before] : []), ...args.frames].sort((a, b) => a.at - b.at);
  const out: PresenceSegment[] = [];
  const push = (a: number, b: number, kind: PresenceKind) => {
    const s = Math.max(a, from);
    const e = Math.min(b, end);
    if (e <= s) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.to === s) last.to = e;
    else out.push({ from: s, to: e, kind });
  };

  if (points.length === 0) {
    push(from, end, 'none');
    return out;
  }

  push(from, points[0]!.at, 'none');
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const next = points[i + 1]?.at ?? end;
    const fresh = Math.min(next, p.at + NIGHT.staleMs);
    push(p.at, fresh, p.present ? 'present' : 'empty');
    push(fresh, next, 'none');
  }
  return out;
}

/** Time present, and how often someone left (present straight to empty; a gap is not a leave). */
export function presenceSummary(segments: PresenceSegment[]): {
  presentMs: number;
  exits: number;
  lastExitAt: number | null;
} {
  let presentMs = 0;
  let exits = 0;
  let lastExitAt: number | null = null;
  segments.forEach((s, i) => {
    if (s.kind === 'present') presentMs += s.to - s.from;
    const prev = segments[i - 1];
    if (s.kind === 'empty' && prev?.kind === 'present' && prev.to === s.from) {
      exits++;
      lastExitAt = s.from;
    }
  });
  return { presentMs, exits, lastExitAt };
}

const SEVEN_DAYS = 7 * 24 * 60 * 60_000;

/** GET /devices/:id/readings/series. */
export const readingSeriesQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    bucketSec: z.coerce.number().int().min(60).max(3600).default(300),
  })
  .refine(
    (q) => {
      const span = Date.parse(q.to) - Date.parse(q.from);
      return span > 0 && span <= SEVEN_DAYS;
    },
    { message: 'to must be after from, and at most 7 days later' },
  );

/** One bucket of the band's readings; each value is the bucket mean of usable readings. */
export interface SeriesPoint {
  at: string;
  bpm: number | null;
  spo2: number | null;
  gsr: number | null;
  /** Mean |acceleration - 1 g|: 0 is perfectly still. */
  motion: number | null;
}
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './presence.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/contracts && npm run build:contracts`
Expected: all contracts suites PASS; build exits 0.

- [ ] **Step 5: Commit**

```bash
cd /c/lacs_thesis
git add packages/contracts/src/presence.ts packages/contracts/src/index.ts packages/contracts/test/presence.test.ts docs/superpowers/plans/2026-10-05-ui-redesign.md docs/superpowers/specs/2026-10-05-ui-redesign-design.md
git commit -m "feat(contracts): presence segments and readings series types"
```

---

### Task 2: Presence window and readings series endpoints

**Files:**
- Modify: `apps/api/src/routes/room.ts` (add a route after `/:deviceId/room/latest`)
- Modify: `apps/api/src/routes/devices.ts` (add a route after `/:deviceId/readings`)
- Modify: `apps/web/src/lib/api.ts` (two client calls)
- Test: `apps/api/test/series.test.ts`, `apps/api/test/room.test.ts`

**Interfaces:**
- Consumes: Task 1 `roomPresenceQuerySchema`, `readingSeriesQuerySchema`, `RoomPresence`, `SeriesPoint`.
- Produces: `GET /api/v1/devices/:deviceId/room/presence?minutes=` → `RoomPresence`; `GET /api/v1/devices/:deviceId/readings/series?from&to&bucketSec` → `SeriesPoint[]`; client `api.roomPresence(deviceId: string, minutes: 60 | 360 | 1440): Promise<RoomPresence>` and `api.readingSeries(deviceId: string, from: Date, to: Date, bucketSec?: number): Promise<SeriesPoint[]>`.

The API tests need the local MongoDB (`mongodb://127.0.0.1:27017`) the suite already uses.

- [ ] **Step 1: Write the failing presence tests**

Append to `apps/api/test/room.test.ts`:

```ts
describe('room presence window', () => {
  const HOUR = 60 * MIN;
  const NEWEST = 100_000_000;

  /** One batch, so ingest back-dates each frame by its ms distance from the newest. */
  async function seed(roomToken: string) {
    await ingest(roomToken, [
      presence(1, NEWEST - 2 * HOUR, true),
      presence(2, NEWEST - 30 * MIN, true),
      presence(3, NEWEST - 10 * MIN, false),
      presence(4, NEWEST, false),
    ]);
  }

  it('returns the frames in the window oldest first, and the one before it', async () => {
    const { token, roomToken } = await setup();
    await seed(roomToken);
    const res = await asUser(token).get(`/devices/${ROOM_ID}/room/presence?minutes=60`);
    expect(res.status).toBe(200);
    expect(res.body.before.present).toBe(true);
    expect(res.body.frames.map((f: { present: boolean }) => f.present)).toEqual([true, false, false]);
    const times = res.body.frames.map((f: { at: string }) => Date.parse(f.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(Date.parse(res.body.before.at)).toBeLessThan(times[0]);
  });

  it('defaults to an hour and has no "before" for a unit that just started', async () => {
    const { token, roomToken } = await setup();
    await ingest(roomToken, [presence(1, 5_000, true)]);
    const res = await asUser(token).get(`/devices/${ROOM_ID}/room/presence`);
    expect(res.status).toBe(200);
    expect(res.body.before).toBeNull();
    expect(res.body.frames).toHaveLength(1);
  });

  it('only accepts 60, 360 or 1440 minutes', async () => {
    const { token } = await setup();
    const res = await asUser(token).get(`/devices/${ROOM_ID}/room/presence?minutes=7`);
    expect(res.status).toBe(400);
  });

  it('answers a band and another account exactly as /room/latest does', async () => {
    const { token } = await setup();
    const band = await asUser(token).get('/devices/lacs-7a3f21/room/presence');
    const bandLatest = await asUser(token).get('/devices/lacs-7a3f21/room/latest');
    expect(band.status).toBe(bandLatest.status);

    const other = await registerUser();
    const theirs = await asUser(other.token).get(`/devices/${ROOM_ID}/room/presence`);
    const theirsLatest = await asUser(other.token).get(`/devices/${ROOM_ID}/room/latest`);
    expect(theirs.status).not.toBe(200);
    expect(theirs.status).toBe(theirsLatest.status);
  });
});
```

- [ ] **Step 2: Write the failing series tests**

`apps/api/test/series.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DeviceModel, ReadingModel } from '../src/models/index.js';
import { app, claimDevice, clearDb, registerUser, startDb, stopDb } from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const BAND = 'lacs-7a3f21';
const BUCKET = 5 * 60_000;
// Aligned to a 5-minute boundary so every bucket is predictable.
const T0 = Math.floor(Date.parse('2026-10-04T22:00:00.000Z') / BUCKET) * BUCKET;

let seq = 0;
async function reading(at: number, over: { ppg?: object; gsr?: object; imu?: object } = {}) {
  const device = await DeviceModel.findOne({ deviceId: BAND }).lean();
  await ReadingModel.create({
    deviceId: BAND,
    ownerId: device!.ownerId,
    seq: ++seq,
    deviceMs: seq * 200,
    recordedAt: new Date(at),
    ppg: { ok: true, finger: true, ir: 1, red: 1, bpm: 70, bpmAvg: 70, spo2: 97, spo2Valid: true, ...over.ppg },
    imu: { ok: true, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, mag: 1, tempC: 30, ...over.imu },
    gsr: { ok: true, raw: 1800, volt: 1.4, base: 1800, ...over.gsr },
    motor: { on: false, pattern: 'idle' },
    flags: [],
  });
}

async function setup() {
  const { token } = await registerUser();
  await claimDevice(token, BAND);
  return token;
}

function series(token: string, query: string) {
  return request(app)
    .get(`/api/v1/devices/${BAND}/readings/series?${query}`)
    .set('Authorization', `Bearer ${token}`);
}

const DAY = `from=${new Date(T0).toISOString()}&to=${new Date(T0 + 86_400_000).toISOString()}`;

describe('readings series', () => {
  it('averages each bucket, ignoring readings that are not usable', async () => {
    const token = await setup();
    await reading(T0 + 1_000, { ppg: { bpm: 60, bpmAvg: 60 }, gsr: { raw: 1800 }, imu: { mag: 1.1 } });
    await reading(T0 + 2_000, { ppg: { bpm: 70, bpmAvg: 70, spo2: -1, spo2Valid: false }, gsr: { raw: 1820 }, imu: { mag: 0.9 } });
    await reading(T0 + 3_000, { ppg: { finger: false, bpm: 200, bpmAvg: 200, spo2: 50, spo2Valid: false }, gsr: { ok: false, raw: 5000 }, imu: { ok: false, mag: 3 } });

    const res = await series(token, DAY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { at: new Date(T0).toISOString(), bpm: 65, spo2: 97, gsr: 1810, motion: 0.1 },
    ]);
  });

  it('uses bpm when bpmAvg is still 0', async () => {
    const token = await setup();
    await reading(T0 + 1_000, { ppg: { bpm: 80, bpmAvg: 0 } });
    const res = await series(token, DAY);
    expect(res.body[0].bpm).toBe(80);
  });

  it('leaves out empty buckets and buckets with nothing usable, oldest first', async () => {
    const token = await setup();
    await reading(T0 + 2 * BUCKET + 1_000);
    await reading(T0 + 1_000);
    await reading(T0 + BUCKET + 1_000, {
      ppg: { ok: false, spo2Valid: false },
      gsr: { ok: false },
      imu: { ok: false },
    });
    const res = await series(token, DAY);
    expect(res.body.map((p: { at: string }) => p.at)).toEqual([
      new Date(T0).toISOString(),
      new Date(T0 + 2 * BUCKET).toISOString(),
    ]);
  });

  it('refuses a range over seven days or a missing from', async () => {
    const token = await setup();
    const long = await series(token, `from=${new Date(T0).toISOString()}&to=${new Date(T0 + 8 * 86_400_000).toISOString()}`);
    expect(long.status).toBe(400);
    const missing = await series(token, `to=${new Date(T0).toISOString()}`);
    expect(missing.status).toBe(400);
  });

  it("hides another account's band the way /readings does", async () => {
    await setup();
    const other = await registerUser();
    const res = await series(other.token, DAY);
    const plain = await request(app)
      .get(`/api/v1/devices/${BAND}/readings`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(plain.status);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/api -- room series`
Expected: FAIL — the new routes answer 404 (`not found`), so status and body assertions fail.

- [ ] **Step 4: Implement the presence route**

In `apps/api/src/routes/room.ts`, add `roomPresenceQuerySchema` to the `@lacs/contracts` import, then add after the `/:deviceId/room/latest` route:

```ts
/** Presence over the last hour, 6 hours or day, plus the state just before it. */
roomRouter.get(
  '/:deviceId/room/presence',
  ...roomOnly,
  asyncHandler(async (req, res) => {
    const query = roomPresenceQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(res, query.error.issues);
    const deviceId = req.params.deviceId!;
    const from = new Date(Date.now() - query.data.minutes * 60_000);
    const [before, frames] = await Promise.all([
      RoomFrameModel.findOne({ deviceId, t: 'presence', recordedAt: { $lt: from } })
        .sort({ recordedAt: -1 })
        .lean<RoomFrameLean>(),
      RoomFrameModel.find({ deviceId, t: 'presence', recordedAt: { $gte: from } })
        .sort({ recordedAt: 1 })
        .lean<RoomFrameLean[]>(),
    ]);
    const point = (f: RoomFrameLean) => ({ present: Boolean(f.present), at: f.recordedAt.toISOString() });
    res.json({ before: before ? point(before) : null, frames: frames.map(point) });
  }),
);
```

- [ ] **Step 5: Implement the series route**

In `apps/api/src/routes/devices.ts`, import `readingSeriesQuerySchema` from `@lacs/contracts`, then add after the `/:deviceId/readings` route:

```ts
/**
 * The band's readings over up to a week, averaged per bucket.
 *
 * At 5 readings a second a day is ~400k rows; charts need a few hundred
 * points. Unusable readings (no finger, invalid SpO2, a sensor not answering)
 * are left out of each mean rather than dragging it to zero.
 */
devicesRouter.get(
  '/:deviceId/readings/series',
  requireOwnedDevice,
  asyncHandler(async (req, res) => {
    const parsed = readingSeriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }
    const { from, to, bucketSec } = parsed.data;
    const bucketMs = bucketSec * 1000;
    const at = { $toLong: '$recordedAt' };

    const rows = await ReadingModel.aggregate<{
      _id: number;
      bpm: number | null;
      spo2: number | null;
      gsr: number | null;
      motion: number | null;
    }>([
      { $match: { deviceId: req.params.deviceId, recordedAt: { $gte: new Date(from), $lt: new Date(to) } } },
      {
        $group: {
          _id: { $subtract: [at, { $mod: [at, bucketMs] }] },
          bpm: {
            $avg: {
              $cond: [
                { $and: ['$ppg.ok', '$ppg.finger'] },
                {
                  $let: {
                    vars: { b: { $cond: [{ $gt: ['$ppg.bpmAvg', 0] }, '$ppg.bpmAvg', '$ppg.bpm'] } },
                    in: { $cond: [{ $gt: ['$$b', 0] }, '$$b', null] },
                  },
                },
                null,
              ],
            },
          },
          spo2: { $avg: { $cond: [{ $eq: ['$ppg.spo2Valid', true] }, '$ppg.spo2', null] } },
          gsr: { $avg: { $cond: [{ $eq: ['$gsr.ok', true] }, '$gsr.raw', null] } },
          motion: {
            $avg: { $cond: [{ $eq: ['$imu.ok', true] }, { $abs: { $subtract: ['$imu.mag', 1] } }, null] },
          },
        },
      },
      {
        $match: {
          $or: [{ bpm: { $ne: null } }, { spo2: { $ne: null } }, { gsr: { $ne: null } }, { motion: { $ne: null } }],
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const round = (v: number | null, digits: number) =>
      v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits;
    res.json(
      rows.map((r) => ({
        at: new Date(r._id).toISOString(),
        bpm: round(r.bpm, 0),
        spo2: round(r.spo2, 0),
        gsr: round(r.gsr, 0),
        motion: round(r.motion, 3),
      })),
    );
  }),
);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/api`
Expected: all API suites PASS (the 42 existing plus the new ones).

- [ ] **Step 7: Client calls**

In `apps/web/src/lib/api.ts`, add `RoomPresence` and `SeriesPoint` to the `@lacs/contracts` type import, and add inside the `api` object after `roomLatest`:

```ts
  roomPresence: (deviceId: string, minutes: 60 | 360 | 1440) =>
    request<RoomPresence>(`/devices/${deviceId}/room/presence?minutes=${minutes}`),

  readingSeries: (deviceId: string, from: Date, to: Date, bucketSec = 300) =>
    request<SeriesPoint[]>(
      `/devices/${deviceId}/readings/series?from=${from.toISOString()}&to=${to.toISOString()}&bucketSec=${bucketSec}`,
    ),
```

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
cd /c/lacs_thesis
git add apps/api/src/routes/room.ts apps/api/src/routes/devices.ts apps/api/test/room.test.ts apps/api/test/series.test.ts apps/web/src/lib/api.ts
git commit -m "feat(api): presence window and per-bucket readings series"
```

---

### Task 3: App test runner and display rules

**Files:**
- Modify: `apps/web/package.json` (devDependency + `test` script)
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/lib/levels.ts`, `apps/web/src/lib/forward.ts`
- Test: `apps/web/src/lib/levels.test.ts`, `apps/web/src/lib/forward.test.ts`

**Interfaces:**
- Produces (`@/lib/levels`):
  - `type Level = 'Low' | 'Medium' | 'High'`; `type HrStatus = 'Low' | 'Normal' | 'High'`
  - `hrStatus(bpm: number | null | undefined): HrStatus | null`
  - `stressLevel(raw: number | null | undefined, base: number | null | undefined): Level | null`
  - `movementLevel(mags: number[]): Level | null`
  - `greeting(d: Date): string`
  - `sleepGoalProgress(minutes: number, goalHours: number): { fraction: number; badge: 'Good' | 'Fair' | 'Short' }`
  - `consistencyLabel(starts: number[]): 'Good' | 'Fair' | 'Irregular' | null`
  - `chartStats(values: number[]): { avg: number; min: number; max: number } | null`
  - `wheelToHueSat(x: number, y: number, r: number): { h: number; s: number }`; `hueSatToWheel(h: number, s: number, r: number): { x: number; y: number }`
- Produces (`@/lib/forward`): `forwardTarget(to: string, search: string): string`

- [ ] **Step 1: Add vitest to the app**

In `apps/web/package.json` add to `"scripts"`: `"test": "vitest run"`, and to `"devDependencies"`: `"vitest": "^2.1.8"`. Then:

Run: `cd /c/lacs_thesis && npm install`
Expected: exits 0.

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Pure functions only: no DOM, no React. Screens are checked by screenshots.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/levels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  chartStats,
  consistencyLabel,
  greeting,
  hrStatus,
  hueSatToWheel,
  movementLevel,
  sleepGoalProgress,
  stressLevel,
  wheelToHueSat,
} from './levels';

describe('hrStatus', () => {
  it.each([
    [null, null],
    [0, null],
    [49, 'Low'],
    [50, 'Normal'],
    [100, 'Normal'],
    [101, 'High'],
  ] as const)('%s bpm -> %s', (bpm, status) => {
    expect(hrStatus(bpm)).toBe(status);
  });
});

describe('stressLevel', () => {
  it('rates the rise over the settled base', () => {
    expect(stressLevel(1890, 1800)).toBe('Low'); // 5 %
    expect(stressLevel(1980, 1800)).toBe('Medium'); // 10 %
    expect(stressLevel(2250, 1800)).toBe('Medium'); // 25 %
    expect(stressLevel(2300, 1800)).toBe('High'); // 27.8 %
  });

  it('says nothing without a reading or a base', () => {
    expect(stressLevel(null, 1800)).toBeNull();
    expect(stressLevel(1800, 0)).toBeNull();
  });
});

describe('movementLevel', () => {
  it('measures how far acceleration strays from 1 g', () => {
    expect(movementLevel([1.01, 0.99, 1.02])).toBe('Low');
    expect(movementLevel([1.1, 0.9])).toBe('Medium');
    expect(movementLevel([1.5, 0.6])).toBe('High');
    expect(movementLevel([])).toBeNull();
  });
});

describe('greeting', () => {
  it.each([
    [4, 'Good evening'],
    [5, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [17, 'Good afternoon'],
    [18, 'Good evening'],
  ])('%i:00 -> %s', (hour, text) => {
    expect(greeting(new Date(2026, 9, 5, hour, 0))).toBe(text);
  });
});

describe('sleepGoalProgress', () => {
  it('fills toward the goal and caps at full', () => {
    expect(sleepGoalProgress(432, 8)).toEqual({ fraction: 0.9, badge: 'Good' });
    expect(sleepGoalProgress(360, 8)).toEqual({ fraction: 0.75, badge: 'Fair' });
    expect(sleepGoalProgress(300, 8).badge).toBe('Short');
    expect(sleepGoalProgress(600, 8).fraction).toBe(1);
    expect(sleepGoalProgress(100, 0)).toEqual({ fraction: 0, badge: 'Short' });
  });
});

describe('consistencyLabel', () => {
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();

  it('needs three nights', () => {
    expect(consistencyLabel([at(1, 23), at(2, 23)])).toBeNull();
  });

  it('handles bedtimes either side of midnight', () => {
    expect(consistencyLabel([at(1, 23, 50), at(3, 0, 10), at(3, 23, 55)])).toBe('Good');
  });

  it('calls a spread of an hour or more irregular', () => {
    expect(consistencyLabel([at(1, 21), at(2, 23), at(4, 1)])).toBe('Irregular');
    // 22:00, 23:30, 23:00 -> spread of about 37 minutes
    expect(consistencyLabel([at(1, 22), at(2, 23, 30), at(3, 23)])).toBe('Fair');
  });
});

describe('chartStats', () => {
  it('rounds avg and keeps min and max', () => {
    expect(chartStats([60, 70, 71])).toEqual({ avg: 67, min: 60, max: 71 });
    expect(chartStats([])).toBeNull();
  });
});

describe('colour wheel', () => {
  it('puts hue 0 at the top and goes clockwise', () => {
    expect(wheelToHueSat(0, -100, 100)).toEqual({ h: 0, s: 100 });
    expect(wheelToHueSat(100, 0, 100)).toEqual({ h: 90, s: 100 });
    expect(wheelToHueSat(0, 50, 100)).toEqual({ h: 180, s: 50 });
    expect(wheelToHueSat(-100, 0, 100)).toEqual({ h: 270, s: 100 });
  });

  it('clamps outside the wheel to full saturation', () => {
    expect(wheelToHueSat(0, -300, 100).s).toBe(100);
  });

  it('round-trips through the marker position', () => {
    for (const [h, s] of [
      [0, 100],
      [30, 80],
      [200, 40],
      [330, 100],
    ] as const) {
      const p = hueSatToWheel(h, s, 104);
      expect(wheelToHueSat(p.x, p.y, 104)).toEqual({ h, s });
    }
  });
});
```

`apps/web/src/lib/forward.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { forwardTarget } from './forward';

describe('forwardTarget', () => {
  it('keeps the query string', () => {
    expect(forwardTarget('/more/history/', '?id=lacs-7a3f21')).toBe('/more/history/?id=lacs-7a3f21');
  });

  it('works without one', () => {
    expect(forwardTarget('/home/', '')).toBe('/home/');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/web`
Expected: FAIL — cannot resolve `./levels` / `./forward`.

- [ ] **Step 4: Implement**

`apps/web/src/lib/levels.ts`:

```ts
/**
 * Words for numbers: the rules every tile and pill uses.
 *
 * Thresholds are starting values for a resting adult, to be tuned on the
 * bench. They describe a reading; they do not diagnose anything.
 */

export type Level = 'Low' | 'Medium' | 'High';
export type HrStatus = 'Low' | 'Normal' | 'High';

export function hrStatus(bpm: number | null | undefined): HrStatus | null {
  if (!bpm || bpm <= 0) return null;
  if (bpm < 50) return 'Low';
  if (bpm > 100) return 'High';
  return 'Normal';
}

/** Skin response risen over its settled base: a rough sign of arousal, not stress itself. */
export function stressLevel(raw: number | null | undefined, base: number | null | undefined): Level | null {
  if (raw === null || raw === undefined || !base || base <= 0) return null;
  const rise = (raw - base) / base;
  if (rise > 0.25) return 'High';
  if (rise >= 0.1) return 'Medium';
  return 'Low';
}

/** Mean distance of acceleration from 1 g (still) over the samples given. */
export function movementLevel(mags: number[]): Level | null {
  if (mags.length === 0) return null;
  const mean = mags.reduce((sum, m) => sum + Math.abs(m - 1), 0) / mags.length;
  if (mean < 0.05) return 'Low';
  if (mean < 0.2) return 'Medium';
  return 'High';
}

export function greeting(d: Date): string {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function sleepGoalProgress(
  minutes: number,
  goalHours: number,
): { fraction: number; badge: 'Good' | 'Fair' | 'Short' } {
  const goal = goalHours * 60;
  const fraction = goal > 0 ? Math.min(1, minutes / goal) : 0;
  const rounded = Math.round(fraction * 100) / 100;
  return { fraction: rounded, badge: rounded >= 0.9 ? 'Good' : rounded >= 0.75 ? 'Fair' : 'Short' };
}

/**
 * How regular bedtimes are, from each night's start. Minutes are counted from
 * noon so 23:50 and 00:10 sit 20 minutes apart, not 23 hours.
 */
export function consistencyLabel(starts: number[]): 'Good' | 'Fair' | 'Irregular' | null {
  if (starts.length < 3) return null;
  const mins = starts.map((t) => {
    const d = new Date(t);
    return (d.getHours() * 60 + d.getMinutes() - 720 + 1440) % 1440;
  });
  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  const sd = Math.sqrt(mins.reduce((a, m) => a + (m - mean) ** 2, 0) / mins.length);
  if (sd < 30) return 'Good';
  if (sd < 60) return 'Fair';
  return 'Irregular';
}

export function chartStats(values: number[]): { avg: number; min: number; max: number } | null {
  if (values.length === 0) return null;
  return {
    avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * Pointer offset from the wheel's centre to hue (0 at the top, clockwise, as
 * CSS conic-gradient draws it) and saturation (0 at the centre, 100 at the edge).
 */
export function wheelToHueSat(x: number, y: number, r: number): { h: number; s: number } {
  const s = Math.round(Math.min(1, Math.hypot(x, y) / r) * 100);
  let deg = (Math.atan2(x, -y) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return { h: Math.round(deg) % 360, s };
}

export function hueSatToWheel(h: number, s: number, r: number): { x: number; y: number } {
  const rad = (h * Math.PI) / 180;
  const d = (s / 100) * r;
  return { x: d * Math.sin(rad), y: -d * Math.cos(rad) };
}
```

`apps/web/src/lib/forward.ts`:

```ts
/** Where an old address now lives, with its query (`?id=…`) carried over. */
export function forwardTarget(to: string, search: string): string {
  return `${to}${search}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /c/lacs_thesis
git add apps/web/package.json package-lock.json apps/web/vitest.config.ts apps/web/src/lib/levels.ts apps/web/src/lib/levels.test.ts apps/web/src/lib/forward.ts apps/web/src/lib/forward.test.ts
git commit -m "feat(app): display rules for tiles, pills and the colour wheel"
```

---

### Task 4: Dark-first theme

**Files:**
- Modify: `apps/web/src/app/globals.css` (both token blocks, `.card`)
- Modify: `apps/web/tailwind.config.ts` (new colours, glow shadow)
- Modify: `apps/web/src/lib/theme.ts` (whole file)
- Modify: `apps/web/src/app/layout.tsx` (`themeColor`)
- Test: `apps/web/src/lib/theme.test.ts`

**Interfaces:**
- Produces: `type Theme = 'dark' | 'light' | 'system'`; `normalizeTheme(stored: string | null): Theme`; `readTheme()`, `setTheme(t)`, `applyTheme(t)`, `THEME_BOOTSTRAP` (same names as today). Tailwind colours `primary`, `good`, `stress` (+ existing), shadow `glow`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { THEME_BOOTSTRAP, normalizeTheme } from './theme';

describe('normalizeTheme', () => {
  it.each([
    [null, 'dark'],
    ['dark', 'dark'],
    ['light', 'light'],
    ['system', 'system'],
    ['night', 'dark'],
    ['soft', 'light'],
    ['garbage', 'dark'],
  ] as const)('%s -> %s', (stored, theme) => {
    expect(normalizeTheme(stored)).toBe(theme);
  });
});

describe('THEME_BOOTSTRAP', () => {
  it('maps the old names the same way before React loads', () => {
    expect(THEME_BOOTSTRAP).toContain("s === 'light' || s === 'soft'");
    expect(THEME_BOOTSTRAP).toContain("s === 'system'");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/web -- theme`
Expected: FAIL — `normalizeTheme is not a function`.

- [ ] **Step 3: Rewrite `theme.ts`**

```ts
export type Theme = 'dark' | 'light' | 'system';

const KEY = 'lacs.theme';

/**
 * Dark is the default since 0.6. Choices made before then carry over:
 * "night" was the dark one, "soft" the light one.
 */
export function normalizeTheme(stored: string | null): Theme {
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  if (stored === 'night') return 'dark';
  if (stored === 'soft') return 'light';
  return 'dark';
}

export function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return normalizeTheme(window.localStorage.getItem(KEY));
}

export function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function setTheme(theme: Theme): void {
  window.localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

/**
 * Runs before React hydrates, so the page never paints in the wrong theme.
 * Inlined into the document head as a plain string; keep it in step with
 * normalizeTheme.
 */
export const THEME_BOOTSTRAP = `
(function () {
  try {
    var s = localStorage.getItem('${KEY}');
    var t = s === 'light' || s === 'soft' ? 'light' : s === 'system' ? 'system' : 'dark';
    var dark = t === 'dark' ||
      (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /c/lacs_thesis && npm test --workspace @lacs/web -- theme`
Expected: PASS.

- [ ] **Step 5: Tokens**

In `apps/web/src/app/globals.css`, replace the `:root { … }` block and the `:root[data-theme='dark'] { … }` block with:

```css
  /* Light: the option. Same hues as dark, deepened to hold up on white. */
  :root {
    --canvas: 244 246 251;
    --card: 255 255 255;
    --ink: 23 32 46;
    --muted: 120 132 155;
    --line: 231 235 243;
    --shadow: 23 32 46;

    --primary: 37 99 235;
    --good: 20 184 166;
    --heart: 225 29 99;
    --oxygen: 124 58 237;
    --stress: 5 150 105;
    --sleep: 79 70 229;
    --skin: 217 119 6;
    --motion: 13 148 136;
    --alarm: 225 29 72;

    color-scheme: light;
  }

  /* Dark: the default, from the mockups. Deep navy with a faint blue glow. */
  :root[data-theme='dark'] {
    --canvas: 11 16 32;
    --card: 18 26 46;
    --ink: 233 238 246;
    --muted: 138 150 171;
    --line: 30 42 74;
    --shadow: 0 0 0;

    --primary: 59 130 246;
    --good: 46 230 197;
    --heart: 255 92 138;
    --oxygen: 167 139 250;
    --stress: 52 211 153;
    --sleep: 99 102 241;
    --skin: 245 158 11;
    --motion: 45 212 191;
    --alarm: 244 63 94;

    color-scheme: dark;
  }
```

Replace the `.card` rule with:

```css
  .card {
    @apply rounded-card border border-line bg-card shadow-soft;
  }

  :root[data-theme='dark'] .card {
    box-shadow: 0 0 0 1px rgb(var(--primary) / 0.08), 0 8px 24px rgb(var(--primary) / 0.06);
  }
```

and the `.btn-primary` rule's `bg-ink … text-canvas` with `bg-primary … text-white` (keep the rest of its classes).

In `apps/web/tailwind.config.ts`, add to `colors`:

```ts
        primary: token('primary'),
        good: token('good'),
        stress: token('stress'),
```

and to `boxShadow`:

```ts
        glow: '0 0 16px rgb(var(--primary) / 0.35)',
```

In `apps/web/src/app/layout.tsx`, change the dark `themeColor` to `'#0B1020'`.

- [ ] **Step 6: Typecheck and build**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web && npm run build --workspace @lacs/web`
Expected: both exit 0. (`me/page.tsx` still uses the old theme names; fix it now by changing its `THEMES` array to:)

```ts
const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'dark', label: 'Dark', hint: 'Easier at night' },
  { value: 'light', label: 'Light', hint: 'Pale and bright' },
  { value: 'system', label: 'Match phone', hint: 'Follows your settings' },
];
```

and its initial state `useState<Theme>('system')` to `useState<Theme>('dark')`. Rerun the two commands; expected: exit 0.

- [ ] **Step 7: Commit**

```bash
cd /c/lacs_thesis
git add apps/web/src/app/globals.css apps/web/tailwind.config.ts apps/web/src/lib/theme.ts apps/web/src/lib/theme.test.ts apps/web/src/app/layout.tsx apps/web/src/app/me/page.tsx
git commit -m "feat(app): dark-first theme from the mockups, light kept as an option"
```

---

### Task 5: UI kit and icons

**Files:**
- Create: `apps/web/src/components/ui/tone.ts`, `IconDisc.tsx`, `StatTile.tsx`, `Ring.tsx`, `SegmentedTabs.tsx`, `ListRow.tsx`, `StatusPill.tsx`, `SectionCard.tsx`, `TimelineStrip.tsx`, `LineChart.tsx`, `ColorWheel.tsx`
- Create: `apps/web/src/lib/useTabParam.ts`
- Modify: `apps/web/src/components/Icons.tsx` (append icons)
- Modify: `apps/web/src/components/NightStrips.tsx` (rebuild on `TimelineStrip`)

**Interfaces:**
- Consumes: Task 3 `chartStats`, `wheelToHueSat`, `hueSatToWheel`; `fmtClock` from `@/lib/format`; `UNKNOWN_FILL`, `GROUP_META` from `@/components/LightMix`.
- Produces:
  - `type Tone = 'heart' | 'oxygen' | 'stress' | 'sleep' | 'motion' | 'skin' | 'primary' | 'good' | 'alarm' | 'muted'`; `TONE: Record<Tone, { text: string; soft: string; color: string }>`
  - `IconDisc({ icon, tone, size? })`
  - `StatTile({ icon, tone, label, value, unit?, status?, statusTone? })`
  - `Ring({ value, tone, title, label, sublabel?, badge? })`
  - `SegmentedTabs<T>({ tabs: {id: T; label: string}[], active: T, onChange(id: T), activeClass? })`, `SegmentedToggle<T>(same props)`
  - `ListRow({ icon, tone?, title, subtitle?, href?, onClick?, right? })`
  - `StatusPill({ tone: 'good' | 'warn' | 'bad' | 'idle', label, dot? })`
  - `SectionCard({ title?, icon?, action?, children, className? })`
  - `interface StripSegment { from: number; to: number; kind: string; fill?: string; opacity?: number; title?: string }`, `TimelineStrip({ segments, kinds: Record<string, {label: string; fill: string}>, from, to, axis?, legend?, label? })`
  - `interface ChartPoint { t: number; v: number }`, `LineChart({ points, tone, from?, to?, min?, max?, height?, gapMs?, digits?, label })`, `ChartStatsRow({ values, unit, digits? })`
  - `ColorWheel({ hue, sat, size?, onChange(h, s), onCommit(h, s) })`
  - `useTabParam<T extends string>(allowed: readonly T[], fallback: T): [T, (t: T) => void]`
  - Icons: `HomeIcon`, `BedIcon`, `MenuIcon`, `GearIcon`, `ExitIcon`, `WalkIcon`, `PowerIcon`

No unit tests here: the logic these draw is tested in Task 3; the drawing is checked by screenshots in Task 11. Verified by typecheck and build.

- [ ] **Step 1: Tone map and icon disc**

`components/ui/tone.ts`:

```ts
/**
 * Every accent the kit draws with. Tailwind needs the class names written
 * out in full to keep them; `color` is for SVG and inline styles, where
 * CSS variables only work through `style`.
 */
export type Tone = 'heart' | 'oxygen' | 'stress' | 'sleep' | 'motion' | 'skin' | 'primary' | 'good' | 'alarm' | 'muted';

export const TONE: Record<Tone, { text: string; soft: string; color: string }> = {
  heart: { text: 'text-heart', soft: 'bg-heart/15', color: 'rgb(var(--heart))' },
  oxygen: { text: 'text-oxygen', soft: 'bg-oxygen/15', color: 'rgb(var(--oxygen))' },
  stress: { text: 'text-stress', soft: 'bg-stress/15', color: 'rgb(var(--stress))' },
  sleep: { text: 'text-sleep', soft: 'bg-sleep/15', color: 'rgb(var(--sleep))' },
  motion: { text: 'text-motion', soft: 'bg-motion/15', color: 'rgb(var(--motion))' },
  skin: { text: 'text-skin', soft: 'bg-skin/15', color: 'rgb(var(--skin))' },
  primary: { text: 'text-primary', soft: 'bg-primary/15', color: 'rgb(var(--primary))' },
  good: { text: 'text-good', soft: 'bg-good/15', color: 'rgb(var(--good))' },
  alarm: { text: 'text-alarm', soft: 'bg-alarm/15', color: 'rgb(var(--alarm))' },
  muted: { text: 'text-muted', soft: 'bg-muted/15', color: 'rgb(var(--muted))' },
};
```

`components/ui/IconDisc.tsx`:

```tsx
import type { ReactNode } from 'react';
import { TONE, type Tone } from './tone';

export function IconDisc({ icon, tone, size = 'h-10 w-10' }: { icon: ReactNode; tone: Tone; size?: string }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-2xl ${TONE[tone].soft} ${TONE[tone].text}`}>
      {icon}
    </span>
  );
}
```

- [ ] **Step 2: Tiles, pill, card, row**

`components/ui/StatTile.tsx`:

```tsx
import type { ReactNode } from 'react';
import { IconDisc } from './IconDisc';
import { TONE, type Tone } from './tone';

/** Icon, label, one big value and a short status, as in the mockups' tiles. */
export function StatTile({
  icon,
  tone,
  label,
  value,
  unit,
  status,
  statusTone,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: string;
  unit?: string;
  status?: string | null;
  statusTone?: Tone;
}) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <IconDisc icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="truncate text-xs text-muted">{label}</p>
        <p className="tabular truncate text-lg font-bold leading-tight">
          {value}
          {unit && <span className="ml-1 text-xs font-medium text-muted">{unit}</span>}
        </p>
        {status && <p className={`truncate text-xs font-medium ${TONE[statusTone ?? tone].text}`}>{status}</p>}
      </div>
    </div>
  );
}
```

`components/ui/StatusPill.tsx`:

```tsx
const PILL = {
  good: 'bg-good/15 text-good',
  warn: 'bg-skin/15 text-skin',
  bad: 'bg-alarm/15 text-alarm',
  idle: 'bg-muted/15 text-muted',
} as const;

export function StatusPill({
  tone,
  label,
  dot = true,
}: {
  tone: keyof typeof PILL;
  label: string;
  dot?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold ${PILL[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {label}
    </span>
  );
}
```

`components/ui/SectionCard.tsx`:

```tsx
import type { ReactNode } from 'react';

export function SectionCard({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card px-5 py-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="flex items-center gap-2 font-semibold">
              {icon}
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
```

`components/ui/ListRow.tsx`:

```tsx
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronIcon } from '../Icons';
import { IconDisc } from './IconDisc';
import type { Tone } from './tone';

export function ListRow({
  icon,
  tone = 'primary',
  title,
  subtitle,
  href,
  onClick,
  right,
}: {
  icon: ReactNode;
  tone?: Tone;
  title: string;
  subtitle?: string;
  href?: string;
  onClick?: () => void;
  right?: ReactNode;
}) {
  const body = (
    <>
      <IconDisc icon={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && <span className="block truncate text-sm text-muted">{subtitle}</span>}
      </span>
      {right}
      {(href || onClick) && <ChevronIcon className="h-5 w-5 shrink-0 text-muted" />}
    </>
  );
  const cls = 'flex w-full items-center gap-3 px-4 py-3 text-left';
  if (href) return <Link href={href} className={`${cls} hover:bg-canvas/50`}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`${cls} hover:bg-canvas/50`}>{body}</button>;
  return <div className={cls}>{body}</div>;
}
```

- [ ] **Step 3: Ring and tabs**

`components/ui/Ring.tsx`:

```tsx
import type { ReactNode } from 'react';
import { TONE, type Tone } from './tone';

/** Progress ring with the label in the middle, glowing in its tone. */
export function Ring({
  value,
  tone,
  title,
  label,
  sublabel,
  badge,
}: {
  value: number;
  tone: Tone;
  title: string;
  label: string;
  sublabel?: string;
  badge?: ReactNode;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = TONE[tone].color;
  return (
    <div className="relative mx-auto h-52 w-52">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8" style={{ stroke: 'rgb(var(--line))' }} />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ stroke: color, filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xs text-muted">{title}</span>
        <span className="tabular text-3xl font-bold leading-tight">{label}</span>
        {sublabel && <span className="text-xs text-muted">{sublabel}</span>}
        {badge && <span className="mt-2">{badge}</span>}
      </div>
    </div>
  );
}
```

`components/ui/SegmentedTabs.tsx`:

```tsx
export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
  activeClass = 'bg-primary text-white shadow-glow',
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  activeClass?: string;
}) {
  return (
    <div role="tablist" className="flex gap-1 rounded-2xl border border-line bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
            t.id === active ? activeClass : 'text-muted hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Two-way switch such as Manual / Adaptive Radar; the chosen side glows green. */
export function SegmentedToggle<T extends string>(props: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return <SegmentedTabs {...props} activeClass="bg-good text-canvas shadow-glow" />;
}
```

`lib/useTabParam.ts`:

```ts
'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The open tab, kept in ?tab= so Back and reloads land on it.
 * Callers must sit inside <Suspense> (useSearchParams in a static export).
 */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T): [T, (t: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('tab');
  const tab = raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback((t: T) => router.replace(`${pathname}?tab=${t}`, { scroll: false }), [router, pathname]);
  return [tab, set];
}
```

- [ ] **Step 4: Timeline strip and NightStrips on top of it**

`components/ui/TimelineStrip.tsx`:

```tsx
import { fmtClock } from '@/lib/format';

export interface StripSegment {
  from: number;
  to: number;
  kind: string;
  /** Overrides the kind's fill, e.g. the bulb's real colour. */
  fill?: string;
  opacity?: number;
  title?: string;
}

/** One horizontal band of coloured spans over time, with an axis and legend. */
export function TimelineStrip({
  segments,
  kinds,
  from,
  to,
  axis = true,
  legend = true,
  label,
}: {
  segments: StripSegment[];
  kinds: Record<string, { label: string; fill: string }>;
  from: number;
  to: number;
  axis?: boolean;
  legend?: boolean;
  label?: string;
}) {
  const span = to - from || 1;
  const pct = (t: number) => `${((t - from) / span) * 100}%`;
  const ticks = [from + span / 3, from + (2 * span) / 3];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {label && <span className="w-10 shrink-0 text-xs font-medium text-muted">{label}</span>}
        <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-canvas" role="img" aria-label={label ?? 'Timeline'}>
          {segments.map((s) => (
            <div
              key={`${s.from}-${s.kind}`}
              className="absolute inset-y-0"
              style={{
                left: pct(s.from),
                width: `${((s.to - s.from) / span) * 100}%`,
                background: s.fill ?? kinds[s.kind]?.fill ?? 'transparent',
                opacity: s.opacity ?? 1,
              }}
              title={s.title ?? kinds[s.kind]?.label}
            />
          ))}
        </div>
      </div>
      {axis && (
        <div className={`relative h-4 text-[11px] text-muted ${label ? 'ml-[3.25rem]' : ''}`}>
          <span className="tabular absolute left-0">{fmtClock(from)}</span>
          {ticks.map((t) => (
            <span key={t} className="tabular absolute -translate-x-1/2" style={{ left: pct(t) }}>
              {fmtClock(t)}
            </span>
          ))}
          <span className="tabular absolute right-0">{fmtClock(to)}</span>
        </div>
      )}
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {Object.entries(kinds).map(([kind, k]) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: k.fill }} />
              {k.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

Replace the whole of `components/NightStrips.tsx` with:

```tsx
'use client';

import type { NightSummary } from '@lacs/contracts';
import { GROUP_META, UNKNOWN_FILL } from './LightMix';
import { TimelineStrip } from './ui/TimelineStrip';

const ROOM_KINDS = {
  present: { label: 'In the room', fill: 'rgb(var(--sleep))' },
  absent: { label: 'Room empty', fill: 'rgb(var(--line))' },
  unknown: { label: 'No data', fill: UNKNOWN_FILL },
};

/**
 * The night as two aligned strips: when someone was in the room, and what the
 * light was doing, painted in the bulb's real colour. Dimmer light draws
 * fainter, so a 10% amber glow does not look like a floodlight.
 */
export function NightStrips({ night }: { night: NightSummary }) {
  const stretch = night.stretch;
  if (!stretch) return null;
  return (
    <div className="space-y-3">
      <TimelineStrip
        label="Room"
        from={stretch.start}
        to={stretch.end}
        kinds={ROOM_KINDS}
        axis={false}
        segments={night.presence.map((p) => ({ from: p.from, to: p.to, kind: p.state }))}
      />
      <TimelineStrip
        label="Light"
        from={stretch.start}
        to={stretch.end}
        kinds={{}}
        legend={false}
        segments={night.light.timeline.map((l) => ({
          from: l.from,
          to: l.to,
          kind: l.group,
          fill: l.group === 'unknown' ? UNKNOWN_FILL : (l.css ?? GROUP_META.off.color),
          opacity: l.bright === null ? 1 : 0.35 + (0.65 * l.bright) / 100,
          title: GROUP_META[l.group].label + (l.bright ? `, ${l.bright}%` : ''),
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 5: Line chart**

`components/ui/LineChart.tsx`:

```tsx
import { fmtClock } from '@/lib/format';
import { chartStats } from '@/lib/levels';
import { TONE, type Tone } from './tone';

export interface ChartPoint {
  t: number;
  v: number;
}

/**
 * A day of one signal: y labels, time labels, and a line that breaks where
 * the band sent nothing for a while instead of bridging the gap.
 */
export function LineChart({
  points,
  tone,
  from,
  to,
  min,
  max,
  height = 140,
  gapMs = 15 * 60_000,
  digits = 0,
  label,
}: {
  points: ChartPoint[];
  tone: Tone;
  from?: number;
  to?: number;
  min?: number;
  max?: number;
  height?: number;
  gapMs?: number;
  digits?: number;
  label: string;
}) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-sm text-muted" style={{ height }} role="img" aria-label={`${label}: not enough readings`}>
        Not enough readings yet
      </div>
    );
  }
  const values = points.map((p) => p.v);
  const t0 = from ?? points[0]!.t;
  const t1 = to ?? points[points.length - 1]!.t;
  const tspan = t1 - t0 || 1;
  let lo = min ?? Math.min(...values);
  let hi = max ?? Math.max(...values);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const W = 1000;
  const x = (t: number) => ((t - t0) / tspan) * W;
  const y = (v: number) => height - 6 - ((v - lo) / (hi - lo)) * (height - 12);

  const runs: ChartPoint[][] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (!prev || p.t - prev.t > gapMs) runs.push([p]);
    else runs[runs.length - 1]!.push(p);
  });

  const color = TONE[tone].color;
  const fmt = (v: number) => v.toFixed(digits);

  return (
    <div>
      <div className="flex gap-2">
        <div className="tabular flex w-8 shrink-0 flex-col justify-between text-right text-[11px] text-muted" style={{ height }}>
          <span>{fmt(hi)}</span>
          <span>{fmt((hi + lo) / 2)}</span>
          <span>{fmt(lo)}</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="flex-1"
          style={{ height }}
          role="img"
          aria-label={`${label}: ${points.length} points`}
        >
          {[0.5].map((f) => (
            <line key={f} x1={0} x2={W} y1={height * f} y2={height * f} style={{ stroke: 'rgb(var(--line))' }} strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
          ))}
          {runs.map((run) =>
            run.length === 1 ? (
              <circle key={run[0]!.t} cx={x(run[0]!.t)} cy={y(run[0]!.v)} r={2} style={{ fill: color }} />
            ) : (
              <polyline
                key={run[0]!.t}
                points={run.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
                fill="none"
                strokeWidth={1.8}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ stroke: color, filter: `drop-shadow(0 0 3px ${color})` }}
              />
            ),
          )}
        </svg>
      </div>
      <div className="tabular ml-10 mt-1 flex justify-between text-[11px] text-muted">
        <span>{fmtClock(t0)}</span>
        <span>{fmtClock(t0 + tspan / 2)}</span>
        <span>{fmtClock(t1)}</span>
      </div>
    </div>
  );
}

/** "Avg 68 · Min 54 · Max 102" under a big value. */
export function ChartStatsRow({ values, unit }: { values: number[]; unit: string }) {
  const stats = chartStats(values);
  if (!stats) return null;
  return (
    <div className="tabular flex gap-4 text-xs text-muted">
      <span>
        Avg <b className="text-ink">{stats.avg}</b> {unit}
      </span>
      <span>
        Min <b className="text-ink">{stats.min}</b> {unit}
      </span>
      <span>
        Max <b className="text-ink">{stats.max}</b> {unit}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Colour wheel**

`components/ui/ColorWheel.tsx`:

```tsx
'use client';

import { useRef } from 'react';
import { hueSatToWheel, wheelToHueSat } from '@/lib/levels';

/**
 * Hue round the edge (red at the top, clockwise), white in the middle.
 * `onChange` follows the finger for the preview; only `onCommit`, on release,
 * should send anything to the bulb. `touch-none` keeps a drag from scrolling.
 */
export function ColorWheel({
  hue,
  sat,
  size = 208,
  onChange,
  onCommit,
}: {
  hue: number;
  sat: number;
  size?: number;
  onChange: (h: number, s: number) => void;
  onCommit: (h: number, s: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pick = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const r = rect.width / 2;
    return wheelToHueSat(e.clientX - rect.left - r, e.clientY - rect.top - r, r);
  };
  const marker = hueSatToWheel(hue, sat, size / 2);

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Colour"
      aria-valuenow={hue}
      aria-valuetext={`Hue ${hue}, saturation ${sat}%`}
      tabIndex={0}
      className="relative mx-auto touch-none select-none rounded-full"
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle closest-side, #fff, rgba(255,255,255,0)), conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = pick(e);
        onChange(p.h, p.s);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const p = pick(e);
        onChange(p.h, p.s);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        const p = pick(e);
        onCommit(p.h, p.s);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <span
        className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-lift"
        style={{ left: size / 2 + marker.x, top: size / 2 + marker.y, background: `hsl(${hue} ${sat}% 50%)` }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Icons**

Append to `components/Icons.tsx`:

```tsx
export function HomeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </Svg>
  );
}

export function BedIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 18V7" />
      <path d="M3 14h18v4" />
      <path d="M21 14v-2a3 3 0 0 0-3-3h-7v5" />
      <circle cx="7" cy="11" r="2" />
    </Svg>
  );
}

export function MenuIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function GearIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Svg>
  );
}

export function ExitIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l-4-4 4-4" />
      <path d="M6 12h10" />
    </Svg>
  );
}

export function WalkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="m9 21 2.5-6 2.5 2v4" />
      <path d="M8 12l2-4.5 4 1 2 3.5 2.5 1" />
      <path d="M11.5 15 10 7.5" />
    </Svg>
  );
}

export function PowerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3v8" />
      <path d="M6.4 6.4a8 8 0 1 0 11.2 0" />
    </Svg>
  );
}
```

- [ ] **Step 8: Typecheck and build**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web && npm run build --workspace @lacs/web`
Expected: both exit 0 (the Sleep page still renders `NightStrips`, now built on `TimelineStrip`).

- [ ] **Step 9: Commit**

```bash
cd /c/lacs_thesis
git add apps/web/src/components/ui apps/web/src/lib/useTabParam.ts apps/web/src/components/Icons.tsx apps/web/src/components/NightStrips.tsx
git commit -m "feat(app): UI kit from the mockups - tiles, ring, tabs, rows, strips, charts, colour wheel"
```

---

### Task 6: Five tabs, More, moved pages and forwarding

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx` (whole file)
- Create: `apps/web/src/components/Forward.tsx`, `apps/web/src/lib/targets.ts`
- Create: `apps/web/src/app/more/page.tsx`
- Move (`git mv`): `app/device/page.tsx` → `app/more/devices/page.tsx`; `app/device/room-setup/page.tsx` → `app/more/devices/room-setup/page.tsx`; `app/node/page.tsx` → `app/more/devices/pair/page.tsx`; `app/me/page.tsx` → `app/more/settings/page.tsx`; `app/history/page.tsx` → `app/more/history/page.tsx`
- Delete: `app/exercise/page.tsx`
- Create (forwarders): `app/device/page.tsx`, `app/device/room-setup/page.tsx`, `app/node/page.tsx`, `app/me/page.tsx`, `app/history/page.tsx`, `app/exercise/page.tsx`
- Modify: `app/page.tsx`, `app/login/page.tsx`, and every `href`/`router` path listed in Step 6
- Create (temporary, replaced in Tasks 7 and 10): `app/home/page.tsx`, `app/bed/page.tsx`

**Interfaces:**
- Consumes: Task 3 `forwardTarget`; Task 5 `ListRow`, icons.
- Produces: `AppShell({ title, subtitle?, action?, children })` (the `deviceName`/`connected` props are gone); `Forward({ to })`; `readSleepTarget(): number`, `writeSleepTarget(hours: number): void` in `@/lib/targets`.

- [ ] **Step 1: AppShell**

Replace `components/AppShell.tsx` with:

```tsx
'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LATEST_APK, useUpdate } from '@/lib/update';
import { BedIcon, HeartIcon, HomeIcon, MenuIcon, MoonIcon } from './Icons';

const TABS = [
  { href: '/home/', label: 'Home', Icon: HomeIcon },
  { href: '/sleep/', label: 'Sleep', Icon: MoonIcon },
  { href: '/health/', label: 'Health', Icon: HeartIcon },
  { href: '/bed/', label: 'Bed', Icon: BedIcon },
  { href: '/more/', label: 'More', Icon: MenuIcon },
];

/**
 * Page frame for the five tabs. Tabs sit at the bottom on a phone where a
 * thumb reaches them, and along the top on wider screens. `action` is the
 * header's right side: a status pill, a settings button.
 */
export function AppShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { update, showBanner, dismiss } = useUpdate();

  return (
    <div className="min-h-screen pb-28 sm:pb-10">
      <header className="mx-auto max-w-3xl px-5 pt-6 sm:px-8 sm:pt-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>

        <nav className="mt-6 hidden gap-1 border-b border-line sm:flex">
          {TABS.map(({ href, label }) => {
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`-mb-px border-b-2 px-4 py-3 font-medium transition-colors ${
                  active ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
        {showBanner && update && (
          <div className="card mb-4 flex items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">Somnus {update.version} is out</p>
              <p className="text-sm text-muted">Install it over this one. Your readings stay on the phone.</p>
            </div>
            <a href={LATEST_APK} className="btn-primary shrink-0 !py-2 text-sm">
              Update
            </a>
            <button type="button" onClick={dismiss} aria-label="Not now" className="shrink-0 px-1 text-xl leading-none text-muted">
              ×
            </button>
          </div>
        )}
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-line bg-card/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-3xl">
          {TABS.map(({ href, label, Icon }) => {
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-1 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs font-medium transition-colors ${
                  active ? 'text-primary' : 'text-muted'
                }`}
              >
                <Icon className={`h-6 w-6 ${active ? '' : 'opacity-70'}`} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
```

- [ ] **Step 2: Forwarder and sleep target helpers**

`components/Forward.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { forwardTarget } from '@/lib/forward';

/** An old address that moved. Keeps the installed 0.5.0 app and saved links working. */
export function Forward({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(forwardTarget(to, window.location.search));
  }, [router, to]);
  return <p className="p-6 text-muted">Moving you to the new page…</p>;
}
```

`lib/targets.ts`:

```ts
const KEY = 'lacs.targets';

/** Hours of sleep the user aims for, kept on this phone. Default 8. */
export function readSleepTarget(): number {
  if (typeof window === 'undefined') return 8;
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as { sleepHours?: unknown };
    const hours = Number(stored.sleepHours);
    return Number.isFinite(hours) && hours >= 4 && hours <= 12 ? hours : 8;
  } catch {
    return 8;
  }
}

export function writeSleepTarget(hours: number): void {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    window.localStorage.setItem(KEY, JSON.stringify({ ...stored, sleepHours: hours }));
  } catch {
    window.localStorage.setItem(KEY, JSON.stringify({ sleepHours: hours }));
  }
}
```

- [ ] **Step 3: Move pages and add forwarders**

```bash
cd /c/lacs_thesis/apps/web/src/app
mkdir -p more/devices/pair more/devices/room-setup more/settings more/history
git mv device/room-setup/page.tsx more/devices/room-setup/page.tsx
git mv device/page.tsx more/devices/page.tsx
git mv node/page.tsx more/devices/pair/page.tsx
git mv me/page.tsx more/settings/page.tsx
git mv history/page.tsx more/history/page.tsx
git rm -q exercise/page.tsx
```

Create each forwarder (same shape, different `to`):

`app/device/page.tsx`:
```tsx
import { Forward } from '@/components/Forward';
export default function Page() {
  return <Forward to="/more/devices/" />;
}
```
`app/device/room-setup/page.tsx`: same with `to="/more/devices/room-setup/"`.
`app/node/page.tsx`: same with `to="/more/devices/pair/"`.
`app/me/page.tsx`: same with `to="/more/settings/"`.
`app/history/page.tsx`: same with `to="/more/history/"`.
`app/exercise/page.tsx`: same with `to="/home/"`.

Temporary tab pages so every tab link resolves until Tasks 7 and 10 replace them. `app/home/page.tsx`:
```tsx
'use client';
import { AppShell } from '@/components/AppShell';
export default function HomePage() {
  return <AppShell title="Home">{null}</AppShell>;
}
```
`app/bed/page.tsx`: same with `BedPage` and `title="Bed"`.

- [ ] **Step 4: More page**

`app/more/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';
import { useDevice } from '@/lib/useDevice';
import { AppShell } from '@/components/AppShell';
import { ListRow } from '@/components/ui/ListRow';
import { ChipIcon, GearIcon, SparkIcon } from '@/components/Icons';

export default function MorePage() {
  const router = useRouter();
  const { active } = useDevice();

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
  }, [router]);

  return (
    <AppShell
      title="More"
      action={
        <Link href="/more/settings/" aria-label="App Settings" className="rounded-full p-2 text-muted hover:text-ink">
          <GearIcon className="h-6 w-6" />
        </Link>
      }
    >
      <section className="card overflow-hidden">
        <h2 className="px-5 pt-5 text-sm font-semibold text-muted">Settings</h2>
        <div className="mt-2 divide-y divide-line">
          <ListRow
            icon={<ChipIcon className="h-5 w-5" />}
            tone="primary"
            title="Device Management"
            subtitle="Band, room unit and Bluetooth"
            href="/more/devices/"
          />
          <ListRow
            icon={<SparkIcon className="h-5 w-5" />}
            tone="sleep"
            title="History"
            subtitle="Everything the band recorded"
            href={active ? `/more/history/?id=${active.deviceId}` : '/more/history/'}
          />
          <ListRow
            icon={<GearIcon className="h-5 w-5" />}
            tone="muted"
            title="App Settings"
            subtitle="Appearance, sleep target, account"
            href="/more/settings/"
          />
        </div>
      </section>
    </AppShell>
  );
}
```

- [ ] **Step 5: Turn moved tab pages into sub-pages**

`app/more/devices/page.tsx`: replace the `AppShell` import with `import { SubPage } from '@/components/SubPage';`, and replace the opening

```tsx
    <AppShell
      title="Device"
      subtitle="Your band, its sensors and how it is connected"
      deviceName={active?.name ?? null}
      connected={state === 'live'}
    >
```

with `<SubPage title="Device Management" subtitle="Your band, room unit and how they connect">`, and the closing `</AppShell>` with `</SubPage>`.

`app/more/settings/page.tsx`:
- replace `import { AppShell } from '@/components/AppShell';` with `import { SubPage } from '@/components/SubPage';` and add `import { readSleepTarget, writeSleepTarget } from '@/lib/targets';`
- replace `<AppShell title="Me" deviceName={active?.name ?? null} connected={false}>` with `<SubPage title="App Settings">` and `</AppShell>` with `</SubPage>`
- remove `const { active } = useDevice();` and the `useDevice` import (no longer used)
- replace the `TARGETS_KEY` constant, the `Targets` interface, the `targets` state, the stored-targets block in the effect, and `saveTargets` with:

```tsx
  const [sleepHours, setSleepHours] = useState(8);
```

with `setSleepHours(readSleepTarget());` added in the effect after `setThemeState(readTheme());`.
- replace the whole "Set your targets" button and its panel with:

```tsx
          <button type="button" className="row" onClick={() => setPanel(panel === 'targets' ? null : 'targets')}>
            <TargetIcon className="h-5 w-5 text-good" />
            <span className="flex-1 font-medium">Sleep target</span>
            <span className="text-sm text-muted">{sleepHours} h</span>
            <ChevronIcon className="h-5 w-5 text-muted" />
          </button>

          {panel === 'targets' && (
            <div className="border-t border-line bg-canvas/50 px-5 py-5">
              <label className="block text-sm font-medium" htmlFor="sleep">
                Hours of sleep
              </label>
              <input
                id="sleep"
                type="number"
                min={4}
                max={12}
                step={0.5}
                className="field mt-2"
                value={sleepHours}
                onChange={(e) => {
                  const hours = Number(e.target.value);
                  setSleepHours(hours);
                  if (hours >= 4 && hours <= 12) writeSleepTarget(hours);
                }}
              />
              <p className="mt-3 text-sm text-muted">Saved on this phone. The Sleep ring fills toward it.</p>
            </div>
          )}
```

- [ ] **Step 6: Point every link at the new addresses**

| File | Old | New |
|---|---|---|
| `app/page.tsx` | `'/health/'` | `'/home/'` |
| `app/login/page.tsx` | `router.push('/health/')` | `router.push('/home/')` |
| `app/more/devices/page.tsx` | `href="/node/"` | `href="/more/devices/pair/"` |
| `app/more/devices/page.tsx` | `href="/sleep/"` (and its text "Light controls and nights") | `href="/bed/"`, text "Light and presence" |
| `app/more/devices/page.tsx` | `href="/device/room-setup/"` | `href="/more/devices/room-setup/"` |
| `app/more/devices/page.tsx` | `` href={`/history/?id=${active.deviceId}`} `` | `` href={`/more/history/?id=${active.deviceId}`} `` |
| `app/more/devices/pair/page.tsx` | `href="/device/"` | `href="/more/devices/"` |
| `app/more/history/page.tsx` | `href="/device/"` | `href="/more/devices/"` |
| `app/more/devices/room-setup/page.tsx` | `router.push(step.outcome.ok ? '/sleep/' : '/device/')` | `router.push(step.outcome.ok ? '/bed/' : '/more/devices/')` |
| `components/room-setup/Steps.tsx` | `'Go to Sleep'` | `'Go to Bed'` |
| `app/sleep/page.tsx` | `href="/device/"` | `href="/more/devices/room-setup/"` |
| `app/health/page.tsx` | `href="/device/"` | `href="/more/devices/"` |
| `app/health/page.tsx` | `` href={`/history/?id=${…}`} `` | `` href={`/more/history/?id=${active?.deviceId ?? ''}`} `` |

Then remove the `deviceName`/`connected` props from the `AppShell` calls in `app/sleep/page.tsx` and `app/health/page.tsx` (both pages are rewritten in Tasks 8 and 9; this keeps the build green until then).

Run: `cd /c/lacs_thesis/apps/web/src && grep -rnE "\"/(device|node|me|history|exercise)/|'/(device|node|me|history|exercise)/|\`/(device|node|me|history|exercise)/" app components lib | grep -v "^app/\(device\|node\|me\|history\|exercise\)/page.tsx\|^app/device/room-setup/page.tsx"`
Expected: no output.

- [ ] **Step 7: Typecheck, test, build**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web && npm test --workspace @lacs/web && npm run build --workspace @lacs/web`
Expected: all exit 0; the build lists `/home`, `/bed`, `/more`, `/more/devices`, `/more/devices/pair`, `/more/devices/room-setup`, `/more/settings`, `/more/history`, and the six forwarders.

- [ ] **Step 8: Commit**

```bash
cd /c/lacs_thesis
git add -A apps/web/src/app apps/web/src/components/AppShell.tsx apps/web/src/components/Forward.tsx apps/web/src/components/room-setup/Steps.tsx apps/web/src/lib/targets.ts
git commit -m "feat(app): five tabs, More menu, pages moved under More, old addresses forward"
```

---

### Task 7: Home dashboard

**Files:**
- Create: `apps/web/src/lib/useLightCommand.ts`, `apps/web/src/lib/useRoomPresence.ts`
- Modify: `apps/web/src/app/home/page.tsx` (whole file)

**Interfaces:**
- Consumes: Task 1 `presenceSegments`, `toPresencePoints`, `PresenceSegment`; Task 2 `api.roomPresence`; Task 3 `greeting`, `hrStatus`, `stressLevel`, `movementLevel`, `sleepGoalProgress`; Task 5 kit; Task 6 `AppShell`, `readSleepTarget`; existing `useDevice`, `useRoom`, `useStream`, `api.nights`, `api.queueCommand`.
- Produces:
  - `useLightCommand(deviceId: string | null, lastAck: RoomAck | null): { send(command: Command): Promise<void>; message: string | null }`
  - `useRoomPresence(deviceId: string | null, minutes: 60 | 360 | 1440, present: boolean | null): { segments: PresenceSegment[]; from: number; to: number; loading: boolean }`
  - `PRESENCE_KINDS` (strip kinds for present / empty / none), exported from `useRoomPresence.ts`

- [ ] **Step 1: Light command hook (moved out of `RoomNow`)**

`lib/useLightCommand.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command } from '@lacs/contracts';
import { api } from './api';
import type { RoomAck } from './useRoom';

/** The room unit polls every 5 s; well past that and it is probably offline. */
const ANSWER_TIMEOUT_MS = 30_000;

/**
 * Sends a command to the room unit and turns its ack frame into words:
 * "Sent…" until the ack, then "Done." or why not.
 */
export function useLightCommand(deviceId: string | null, lastAck: RoomAck | null) {
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<{ cmd: string; since: number } | null>(null);

  const send = useCallback(
    async (command: Command) => {
      if (!deviceId) return;
      setMessage('Sent, waiting for the room unit…');
      const since = Date.now();
      pending.current = { cmd: command.cmd, since };
      try {
        await api.queueCommand(deviceId, command);
      } catch (err) {
        pending.current = null;
        setMessage((err as Error).message);
        return;
      }
      setTimeout(() => {
        if (pending.current?.since === since) {
          pending.current = null;
          setMessage('No answer yet. The room unit checks for commands every few seconds, so it may be offline.');
        }
      }, ANSWER_TIMEOUT_MS);
    },
    [deviceId],
  );

  useEffect(() => {
    const waiting = pending.current;
    if (!lastAck || !waiting || lastAck.cmd !== waiting.cmd || lastAck.at < waiting.since) return;
    pending.current = null;
    setMessage(lastAck.ok ? 'Done.' : `The room unit could not do that${lastAck.detail ? `: ${lastAck.detail}` : '.'}`);
  }, [lastAck]);

  return { send, message };
}
```

- [ ] **Step 2: Presence window hook**

`lib/useRoomPresence.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { presenceSegments, toPresencePoints, type PresenceSegment, type RoomPresence } from '@lacs/contracts';
import { UNKNOWN_FILL } from '@/components/LightMix';
import { api } from './api';

export const PRESENCE_KINDS = {
  present: { label: 'In bed', fill: 'rgb(var(--sleep))' },
  empty: { label: 'Empty', fill: 'rgb(var(--line))' },
  none: { label: 'No data', fill: UNKNOWN_FILL },
};

/**
 * Presence over the last `minutes`. Refetched when the radar's live state
 * changes (so a change shows within a second) and every 30 s; the window
 * itself slides every 15 s.
 */
export function useRoomPresence(deviceId: string | null, minutes: 60 | 360 | 1440, present: boolean | null) {
  const [data, setData] = useState<RoomPresence | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    const load = () =>
      api
        .roomPresence(deviceId, minutes)
        .then((r) => !cancelled && setData(r))
        .catch(() => undefined);
    void load();
    const every = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(every);
    };
  }, [deviceId, minutes, present]);

  const to = now;
  const from = now - minutes * 60_000;
  const segments: PresenceSegment[] = data ? presenceSegments({ ...toPresencePoints(data), from, to, now }) : [];
  return { segments, from, to, loading: data === null };
}
```

- [ ] **Step 3: Home page**

Replace `app/home/page.tsx` with:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { NightSummary } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { fmtDuration } from '@/lib/format';
import { greeting, hrStatus, movementLevel, sleepGoalProgress, stressLevel } from '@/lib/levels';
import { readSleepTarget } from '@/lib/targets';
import { useDevice } from '@/lib/useDevice';
import { useLightCommand } from '@/lib/useLightCommand';
import { useRoom } from '@/lib/useRoom';
import { PRESENCE_KINDS, useRoomPresence } from '@/lib/useRoomPresence';
import { useStream } from '@/lib/useStream';
import { AppShell } from '@/components/AppShell';
import { BedIcon, BulbIcon, DropIcon, HeartIcon, MoonIcon, SparkIcon, WalkIcon, BluetoothIcon } from '@/components/Icons';
import { IconDisc } from '@/components/ui/IconDisc';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatTile } from '@/components/ui/StatTile';
import { StatusPill } from '@/components/ui/StatusPill';
import { TimelineStrip } from '@/components/ui/TimelineStrip';

export default function HomePage() {
  const router = useRouter();
  const { active, room } = useDevice();
  const live = useRoom(room?.deviceId ?? null);
  const { state, latest, history } = useStream(active?.deviceId ?? null);
  const presence = useRoomPresence(room?.deviceId ?? null, 360, live.present);
  const light = useLightCommand(room?.deviceId ?? null, live.lastAck);
  const [nights, setNights] = useState<NightSummary[] | null>(null);
  const [goal, setGoal] = useState(8);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
    setGoal(readSleepTarget());
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, [router]);

  useEffect(() => {
    if (!room) return;
    api.nights(room.deviceId, 2).then(setNights).catch(() => setNights([]));
  }, [room]);

  const bandLive = state === 'live' && latest !== null;
  const bpm = bandLive && latest.ppg.ok && latest.ppg.finger ? Math.round(latest.ppg.bpmAvg || latest.ppg.bpm) : null;
  const spo2 = bandLive && latest.ppg.spo2Valid && latest.ppg.spo2 ? latest.ppg.spo2 : null;
  const stress = bandLive && latest.gsr.ok ? stressLevel(latest.gsr.raw, latest.gsr.base) : null;
  const movement = useMemo(
    () => (bandLive ? movementLevel(history.slice(-50).filter((f) => f.imu.ok).map((f) => f.imu.mag)) : null),
    [bandLive, history],
  );

  // Tonight while someone is in the room, otherwise the newest recorded night.
  const tonight = nights?.[0];
  const sleeping = live.present === true && tonight?.stretch;
  const shown = sleeping ? tonight : nights?.find((n) => n.recorded);
  const minutes = shown ? Math.round(shown.inRoomMs / 60_000) : 0;
  const progress = sleepGoalProgress(minutes, goal);

  const fourHoursAgo = presence.to - 4 * 3_600_000;
  const lastFour = presence.segments
    .filter((s) => s.to > fourHoursAgo)
    .map((s) => ({ ...s, from: Math.max(s.from, fourHoursAgo) }));

  return (
    <AppShell
      title={greeting(now)}
      subtitle={now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Link href="/sleep/" className="card block p-4">
            <IconDisc icon={<MoonIcon className="h-5 w-5" />} tone="sleep" />
            <p className="mt-3 text-xs text-muted">{sleeping ? 'Sleeping' : 'Last night'}</p>
            <p className="tabular text-2xl font-bold">{shown ? fmtDuration(shown.inRoomMs) : '--'}</p>
            {shown && <p className="text-xs text-muted">Sleep quality: <span className="font-semibold text-good">{progress.badge}</span></p>}
          </Link>
          <Link href="/bed/" className="card block p-4">
            <IconDisc icon={<BedIcon className="h-5 w-5" />} tone="good" />
            <p className="mt-3 text-xs text-muted">Bed status</p>
            <p className="text-2xl font-bold">
              {!room ? '--' : !live.online ? 'Offline' : live.present ? 'Occupied' : 'Empty'}
            </p>
          </Link>
        </div>

        <div className="card grid grid-cols-2 divide-x divide-line">
          <div className="flex items-center gap-3 p-4">
            <BluetoothIcon className={`h-5 w-5 ${bandLive ? 'text-good' : 'text-muted'}`} />
            <div>
              <p className="text-sm font-medium">Wristband</p>
              <StatusPill tone={bandLive ? 'good' : 'idle'} label={active ? (bandLive ? 'Connected' : 'Not sending') : 'Not added'} />
            </div>
          </div>
          <div className="flex items-center gap-3 p-4">
            <BedIcon className={`h-5 w-5 ${live.online ? 'text-good' : 'text-muted'}`} />
            <div>
              <p className="text-sm font-medium">Bed Unit</p>
              <StatusPill tone={live.online ? 'good' : 'idle'} label={room ? (live.online ? 'Connected' : 'Offline') : 'Not added'} />
            </div>
          </div>
        </div>

        <h2 className="pt-2 font-semibold">Live Health</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatTile icon={<HeartIcon className="h-5 w-5" />} tone="heart" label="Heart Rate" value={bpm ? String(bpm) : '--'} unit={bpm ? 'BPM' : undefined} status={hrStatus(bpm)} />
          <StatTile icon={<DropIcon className="h-5 w-5" />} tone="oxygen" label="SpO₂" value={spo2 ? `${spo2}%` : '--'} />
          <StatTile icon={<SparkIcon className="h-5 w-5" />} tone="stress" label="Stress" value={stress ?? '--'} />
          <StatTile icon={<WalkIcon className="h-5 w-5" />} tone="motion" label="Movement" value={movement ?? '--'} />
        </div>

        {room && (
          <SectionCard title="Sleep Activity" action={<span className="text-xs text-muted">Last 4 hours</span>}>
            <TimelineStrip segments={lastFour} kinds={PRESENCE_KINDS} from={fourHoursAgo} to={presence.to} />
          </SectionCard>
        )}

        {room && (
          <>
            <h2 className="pt-2 font-semibold">Quick Controls</h2>
            <div className="grid grid-cols-3 gap-4">
              <button
                type="button"
                className="card flex flex-col items-center gap-2 p-4"
                disabled={!live.online}
                onClick={() => void light.send({ cmd: 'light', on: !(live.light?.on ?? false) })}
              >
                <IconDisc icon={<BulbIcon className="h-5 w-5" />} tone="skin" />
                <span className="text-sm font-medium">Light</span>
                <span className={`text-xs font-semibold ${live.light?.on ? 'text-good' : 'text-muted'}`}>
                  {live.light ? (live.light.on ? 'ON' : 'OFF') : '--'}
                </span>
              </button>
            </div>
            {light.message && <p className="text-sm text-muted">{light.message}</p>}
          </>
        )}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Typecheck and build**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web && npm run build --workspace @lacs/web`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
cd /c/lacs_thesis
git add apps/web/src/lib/useLightCommand.ts apps/web/src/lib/useRoomPresence.ts apps/web/src/app/home/page.tsx
git commit -m "feat(app): Home dashboard - sleep, bed status, live health, last 4 hours, light"
```

---

### Task 8: Sleep overview

**Files:**
- Modify: `apps/web/src/app/sleep/page.tsx` (rewrite the page and `Night`)

**Interfaces:**
- Consumes: Task 3 `sleepGoalProgress`, `consistencyLabel`; Task 5 `Ring`, `StatTile`, `SectionCard`, `StatusPill`; Task 6 `AppShell`, `readSleepTarget`; existing `NightStrips` (Task 5), `LightMix`, `NightBars`, `nightLabel`, `fmtClock`, `fmtDuration`.
- Produces: the `/sleep/` page. `RoomNow` is no longer rendered here (it moves to Bed in Task 10).

- [ ] **Step 1: Rewrite the page**

In `app/sleep/page.tsx`:
- remove the `RoomNow`, `MetricTile`, `BulbIcon`, `RadarIcon`, `SparkIcon` imports, `GROUP_META` from the `LightMix` import (keep `LightMix` and `NightBars`), the `SLEEP`/`LIGHT` constants, and the `useRoom` import and `live` variable; add:

```tsx
import { consistencyLabel, sleepGoalProgress } from '@/lib/levels';
import { readSleepTarget } from '@/lib/targets';
import { ExitIcon } from '@/components/Icons';
import { Ring } from '@/components/ui/Ring';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatTile } from '@/components/ui/StatTile';
import { StatusPill } from '@/components/ui/StatusPill';
```

- replace the `<AppShell …>` opening with `<AppShell title="Sleep" subtitle={room ? label : 'Your nights'}>`;
- remove `<RoomNow deviceId={room.deviceId} room={live} />`;
- add `const [goal, setGoal] = useState(8);` and `setGoal(readSleepTarget());` inside the login-check effect;
- compute `const consistency = consistencyLabel((nights ?? []).filter((n) => n.recorded && n.stretch).map((n) => n.stretch!.start));` and pass `goal` and `consistency` to `<Night night={night} goal={goal} consistency={consistency} />`;
- replace the whole `Night` function (and the `SOURCE_LABEL` constant, now unused) with:

```tsx
function Night({
  night,
  goal,
  consistency,
}: {
  night: NightSummary;
  goal: number;
  consistency: 'Good' | 'Fair' | 'Irregular' | null;
}) {
  const stretch = night.stretch!;
  const progress = sleepGoalProgress(Math.round(night.inRoomMs / 60_000), goal);
  const badgeTone = progress.badge === 'Good' ? 'good' : progress.badge === 'Fair' ? 'warn' : 'bad';

  return (
    <>
      <section className="card px-6 py-6">
        <Ring
          value={progress.fraction}
          tone="good"
          title="Sleep Duration"
          label={fmtDuration(night.inRoomMs)}
          sublabel={`Goal: ${goal}h`}
          badge={<StatusPill tone={badgeTone} label={progress.badge} />}
        />
        <p className="mt-3 text-center text-xs text-muted">Time in the room, from the radar. It cannot tell sleep from lying awake.</p>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <StatTile icon={<MoonIcon className="h-5 w-5" />} tone="sleep" label="Sleep Start" value={fmtClock(stretch.start)} />
        <StatTile icon={<MoonIcon className="h-5 w-5" />} tone="skin" label="Sleep End" value={fmtClock(stretch.end)} />
        <StatTile icon={<MoonIcon className="h-5 w-5" />} tone="good" label="Sleep Consistency" value={consistency ?? '--'} status={consistency ? 'Last two weeks' : 'Needs 3 nights'} statusTone="muted" />
        <StatTile
          icon={<ExitIcon className="h-5 w-5" />}
          tone="heart"
          label="Bed Exits"
          value={night.emptiedCount === 0 ? 'None' : `${night.emptiedCount} ${night.emptiedCount === 1 ? 'time' : 'times'}`}
        />
      </div>

      <SectionCard title="Sleep Timeline">
        <NightStrips night={night} />
        {night.coverage < 0.9 && (
          <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
            The room unit was not reporting for {fmtDuration(night.inRoomMs * (1 - night.coverage))} of this night. Those
            stretches are hatched and left out, not guessed.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Light through the night">
        <p className="-mt-2 mb-4 text-sm text-muted">
          {night.light.onWhilePresentMs > 0
            ? `On for ${fmtDuration(night.light.onWhilePresentMs)} while someone was in the room, at ${night.light.avgBrightness}% on average.`
            : 'Off the whole time someone was in the room.'}
        </p>
        <LightMix night={night} />
      </SectionCard>
    </>
  );
}
```

- keep the night selector, the "No night recorded" card, the empty state (its link is already `/more/devices/room-setup/` from Task 6) and the "Last two weeks" `NightBars` section as they are.

- [ ] **Step 2: Typecheck and build**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web && npm run build --workspace @lacs/web`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
cd /c/lacs_thesis
git add apps/web/src/app/sleep/page.tsx
git commit -m "feat(app): Sleep overview with duration ring, start/end, consistency, bed exits"
```

---

### Task 9: Health tabs and Heart Rate detail

**Files:**
- Create: `apps/web/src/lib/useSeries.ts`, `apps/web/src/components/QuickCheck.tsx`
- Modify: `apps/web/src/app/health/page.tsx` (whole file)
- Create: `apps/web/src/app/health/heart/page.tsx`

**Interfaces:**
- Consumes: Task 2 `api.readingSeries`; Task 3 `hrStatus`, `stressLevel`; Task 5 kit, `useTabParam`; existing `useDevice`, `useStream`, `api.events`, `EventList`.
- Produces: `useSeries(deviceId: string | null, from: Date, to: Date | null): { points: SeriesPoint[]; loading: boolean }` (when `to` is null it means "now" and refreshes every 60 s); `QuickCheck({ live: boolean, latest: TelemetryFrame | null })`; `startOfDay(d: Date): Date` exported from `useSeries.ts`.

- [ ] **Step 1: Series hook**

`lib/useSeries.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import type { SeriesPoint } from '@lacs/contracts';
import { api } from './api';

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Five-minute means of the band's readings from `from` to `to` (or now, refreshed each minute). */
export function useSeries(deviceId: string | null, from: Date, to: Date | null) {
  const [points, setPoints] = useState<SeriesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const fromMs = from.getTime();
  const toMs = to?.getTime() ?? null;

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    const load = () =>
      api
        .readingSeries(deviceId, new Date(fromMs), new Date(toMs ?? Date.now()), 300)
        .then((p) => {
          if (cancelled) return;
          setPoints(p);
          setLoading(false);
        })
        .catch(() => !cancelled && setLoading(false));
    setLoading(true);
    void load();
    if (toMs !== null) return () => void (cancelled = true);
    const every = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(every);
    };
  }, [deviceId, fromMs, toMs]);

  return { points, loading };
}
```

- [ ] **Step 2: Quick check, moved out of the old Health page**

`components/QuickCheck.tsx` (the old Health page's Quick check, moved as one component; the only change is `state !== 'live'` → `!live`):

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TelemetryFrame } from '@lacs/contracts';

const CHECK_SECONDS = 15;

interface CheckResult {
  frames: number;
  cleanFrames: number;
  bpm: number | null;
  skinRise: number | null;
  stillness: number;
}

/** Fifteen seconds of holding still, and what the band managed to read. */
export function QuickCheck({ live, latest }: { live: boolean; latest: TelemetryFrame | null }) {
  const [checking, setChecking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState<CheckResult | null>(null);
  const captured = useRef<TelemetryFrame[]>([]);

  useEffect(() => {
    if (checking && latest) captured.current.push(latest);
  }, [checking, latest]);

  const runCheck = useCallback(() => {
    captured.current = [];
    setResult(null);
    setChecking(true);
    setSecondsLeft(CHECK_SECONDS);
    const tick = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    setTimeout(() => {
      clearInterval(tick);
      setChecking(false);
      setSecondsLeft(0);
      const frames = captured.current;
      const clean = frames.filter((f) => f.ppg.ok && f.ppg.finger && f.imu.ok && f.gsr.ok);
      const beats = clean.map((f) => f.ppg.bpmAvg || f.ppg.bpm).filter((v) => v > 0);
      const skin = clean.map((f) => f.gsr.raw);
      const motion = clean.map((f) => f.imu.mag);
      setResult({
        frames: frames.length,
        cleanFrames: clean.length,
        bpm: beats.length ? Math.round(beats.reduce((a, b) => a + b, 0) / beats.length) : null,
        skinRise: skin.length && clean[0] ? Math.round(Math.max(...skin) - (clean[0].gsr.base ?? skin[0]!)) : null,
        stillness: motion.length ? Math.max(...motion.map((m) => Math.abs(m - 1))) : 0,
      });
    }, CHECK_SECONDS * 1000);
  }, []);

  return (
    <section className="card px-6 py-6">
      <h2 className="text-lg font-semibold">Quick check</h2>
      <p className="mt-1 text-muted">
        Hold still with a finger on the sensor for {CHECK_SECONDS} seconds and the band reports what it managed to read.
      </p>

      <button type="button" className="btn-primary mt-4" onClick={runCheck} disabled={checking || !live}>
        {checking ? `Reading, ${secondsLeft}s left` : 'Start check'}
      </button>

      {!live && !checking && (
        <p className="mt-3 text-sm text-muted">The band needs to be sending data before a check can run.</p>
      )}

      {result && (
        <dl className="mt-5 divide-y divide-line border-t border-line">
          <div className="flex justify-between py-3">
            <dt className="text-muted">Heart rate</dt>
            <dd className="tabular font-semibold">{result.bpm ? `${result.bpm} bpm` : 'not enough clean data'}</dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-muted">Skin response</dt>
            <dd className="tabular font-semibold">
              {result.skinRise === null ? 'no reading' : result.skinRise > 250 ? `rose ${result.skinRise}` : 'steady'}
            </dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-muted">How still you were</dt>
            <dd className="tabular font-semibold">
              {result.stillness < 0.15 ? 'very still' : result.stillness < 0.5 ? 'some movement' : 'too much movement'}
            </dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-muted">Usable readings</dt>
            <dd className="tabular font-semibold">
              {result.cleanFrames} of {result.frames}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Health page**

Replace `app/health/page.tsx` with:

```tsx
'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SeriesPoint, StoredEvent } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { hrStatus, stressLevel } from '@/lib/levels';
import { useDevice } from '@/lib/useDevice';
import { startOfDay, useSeries } from '@/lib/useSeries';
import { useStream } from '@/lib/useStream';
import { useTabParam } from '@/lib/useTabParam';
import { AppShell } from '@/components/AppShell';
import { EventList } from '@/components/EventList';
import { DropIcon, HeartIcon, SparkIcon } from '@/components/Icons';
import { QuickCheck } from '@/components/QuickCheck';
import { ChartStatsRow, LineChart, type ChartPoint } from '@/components/ui/LineChart';
import { ListRow } from '@/components/ui/ListRow';
import { SectionCard } from '@/components/ui/SectionCard';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { StatusPill } from '@/components/ui/StatusPill';

const TABS = [
  { id: 'heart', label: 'Heart Rate' },
  { id: 'spo2', label: 'SpO₂' },
  { id: 'stress', label: 'Stress' },
  { id: 'history', label: 'History' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const TAB_IDS = TABS.map((t) => t.id);

function pointsOf(series: SeriesPoint[], key: 'bpm' | 'spo2' | 'gsr'): ChartPoint[] {
  return series.flatMap((p) => (p[key] === null ? [] : [{ t: Date.parse(p.at), v: p[key]! }]));
}

const STATUS_TONE = { Normal: 'good', Low: 'warn', High: 'bad', Medium: 'warn' } as const;

function HealthView() {
  const router = useRouter();
  const { active, bands } = useDevice();
  const [tab, setTab] = useTabParam<Tab>(TAB_IDS, 'heart');
  const { state, latest } = useStream(active?.deviceId ?? null);
  const today = useMemo(() => startOfDay(new Date()), []);
  const { points, loading } = useSeries(active?.deviceId ?? null, today, null);
  const [events, setEvents] = useState<StoredEvent[]>([]);

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
  }, [router]);

  useEffect(() => {
    if (!active) return;
    api.events(active.deviceId, 50).then(setEvents).catch(() => setEvents([]));
  }, [active]);

  if (bands !== null && bands.length === 0) {
    return (
      <SectionCard title="Add your band to get started">
        <p className="text-muted">Once the band is added and sending, heart rate, SpO₂ and stress show up here.</p>
        <Link href="/more/devices/" className="btn-primary mt-4 inline-block">
          Add a band
        </Link>
      </SectionCard>
    );
  }

  const live = state === 'live';
  const bpm = live && latest?.ppg.ok && latest.ppg.finger ? Math.round(latest.ppg.bpmAvg || latest.ppg.bpm) || null : null;
  const spo2 = live && latest?.ppg.spo2Valid && latest.ppg.spo2 ? latest.ppg.spo2 : null;
  const stress = live && latest?.gsr.ok ? stressLevel(latest.gsr.raw, latest.gsr.base) : null;
  const bpmPoints = pointsOf(points, 'bpm');
  const spo2Points = pointsOf(points, 'spo2');
  const gsrPoints = pointsOf(points, 'gsr');
  const chartFrom = today.getTime();
  const chartTo = Date.now();
  const empty = loading ? 'Loading…' : undefined;

  return (
    <div className="space-y-4">
      <SegmentedTabs tabs={[...TABS]} active={tab} onChange={setTab} />

      {tab === 'heart' && (
        <>
          <SectionCard
            title="Heart Rate"
            icon={<HeartIcon className="h-5 w-5 text-heart" />}
            action={hrStatus(bpm) && <StatusPill tone={STATUS_TONE[hrStatus(bpm)!]} label={hrStatus(bpm)!} />}
          >
            <p className="tabular text-4xl font-bold">
              {bpm ?? '--'} <span className="text-base font-medium text-muted">BPM</span>
            </p>
            <div className="mt-2">
              <ChartStatsRow values={bpmPoints.map((p) => p.v)} unit="BPM" />
            </div>
            <div className="mt-4">{empty ?? <LineChart points={bpmPoints} tone="heart" from={chartFrom} to={chartTo} label="Heart rate today" />}</div>
            <Link href="/health/heart/" className="mt-4 inline-block text-sm font-medium text-primary">
              View details
            </Link>
          </SectionCard>
          <QuickCheck live={live} latest={latest} />
        </>
      )}

      {tab === 'spo2' && (
        <SectionCard title="SpO₂" icon={<DropIcon className="h-5 w-5 text-oxygen" />} action={spo2 && <StatusPill tone={spo2 >= 95 ? 'good' : spo2 >= 90 ? 'warn' : 'bad'} label={spo2 >= 95 ? 'Normal' : 'Low'} />}>
          <p className="tabular text-4xl font-bold">
            {spo2 ?? '--'}
            <span className="text-base font-medium text-muted">%</span>
          </p>
          <div className="mt-2">
            <ChartStatsRow values={spo2Points.map((p) => p.v)} unit="%" />
          </div>
          <div className="mt-4">{empty ?? <LineChart points={spo2Points} tone="oxygen" from={chartFrom} to={chartTo} min={80} max={100} label="SpO2 today" />}</div>
          <p className="mt-3 text-xs text-muted">Only readings the band marked valid are shown.</p>
        </SectionCard>
      )}

      {tab === 'stress' && (
        <SectionCard title="Stress" icon={<SparkIcon className="h-5 w-5 text-stress" />} action={stress && <StatusPill tone={STATUS_TONE[stress]} label={stress} />}>
          <p className="text-4xl font-bold">{stress ?? '--'}</p>
          <div className="mt-4">{empty ?? <LineChart points={gsrPoints} tone="stress" from={chartFrom} to={chartTo} label="Skin response today" />}</div>
          <p className="mt-3 text-xs text-muted">Skin response (GSR) — an estimate of arousal, not a diagnosis.</p>
        </SectionCard>
      )}

      {tab === 'history' && (
        <>
          <SectionCard title="Recent events">
            <EventList events={events.map((e) => ({ kind: e.kind, value: e.value, at: e.recordedAt, seq: e.seq }))} />
          </SectionCard>
          {active && (
            <section className="card overflow-hidden">
              <ListRow icon={<SparkIcon className="h-5 w-5" />} tone="sleep" title="Full history" subtitle="Every reading and event" href={`/more/history/?id=${active.deviceId}`} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default function HealthPage() {
  return (
    <AppShell title="Health">
      <Suspense fallback={<p className="text-muted">Loading</p>}>
        <HealthView />
      </Suspense>
    </AppShell>
  );
}
```

- [ ] **Step 4: Heart Rate detail**

`app/health/heart/page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { hrStatus } from '@/lib/levels';
import { useDevice } from '@/lib/useDevice';
import { startOfDay, useSeries } from '@/lib/useSeries';
import { useStream } from '@/lib/useStream';
import { ChevronIcon } from '@/components/Icons';
import { SubPage } from '@/components/SubPage';
import { ChartStatsRow, LineChart } from '@/components/ui/LineChart';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatusPill } from '@/components/ui/StatusPill';

const DAY = 86_400_000;

export default function HeartDetailPage() {
  const { active } = useDevice();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const isToday = day.getTime() === startOfDay(new Date()).getTime();
  const end = useMemo(() => (isToday ? null : new Date(day.getTime() + DAY)), [day, isToday]);
  const { points, loading } = useSeries(active?.deviceId ?? null, day, end);
  const { state, latest } = useStream(active?.deviceId ?? null);

  const bpmPoints = points.flatMap((p) => (p.bpm === null ? [] : [{ t: Date.parse(p.at), v: p.bpm }]));
  const current =
    isToday && state === 'live' && latest?.ppg.ok && latest.ppg.finger ? Math.round(latest.ppg.bpmAvg || latest.ppg.bpm) || null : null;
  const status = hrStatus(current);

  return (
    <SubPage title="Heart Rate">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button type="button" className="btn px-3" aria-label="Previous day" onClick={() => setDay(new Date(day.getTime() - DAY))}>
            <ChevronIcon className="h-5 w-5 rotate-180" />
          </button>
          <span className="font-semibold">
            {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button type="button" className="btn px-3" aria-label="Next day" disabled={isToday} onClick={() => setDay(new Date(day.getTime() + DAY))}>
            <ChevronIcon className="h-5 w-5" />
          </button>
        </div>

        <SectionCard>
          <div className="text-center">
            <p className="tabular text-5xl font-bold">
              {current ?? '--'} <span className="text-lg font-medium text-muted">BPM</span>
            </p>
            <p className="text-sm text-muted">{isToday ? 'Current' : 'No live value for a past day'}</p>
            {status && (
              <div className="mt-2">
                <StatusPill tone={status === 'Normal' ? 'good' : status === 'Low' ? 'warn' : 'bad'} label={status} />
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-center">
            <ChartStatsRow values={bpmPoints.map((p) => p.v)} unit="BPM" />
          </div>
          <div className="mt-4">
            {loading ? (
              <p className="py-10 text-center text-sm text-muted">Loading…</p>
            ) : (
              <LineChart points={bpmPoints} tone="heart" from={day.getTime()} to={end ? end.getTime() : Date.now()} label="Heart rate for the day" />
            )}
          </div>
        </SectionCard>
      </div>
    </SubPage>
  );
}
```

- [ ] **Step 5: Typecheck, test, build**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web && npm test --workspace @lacs/web && npm run build --workspace @lacs/web`
Expected: all exit 0; the build lists `/health` and `/health/heart`.

- [ ] **Step 6: Commit**

```bash
cd /c/lacs_thesis
git add apps/web/src/lib/useSeries.ts apps/web/src/components/QuickCheck.tsx apps/web/src/app/health
git commit -m "feat(app): Health tabs with day charts, and the Heart Rate detail"
```

---

### Task 10: Bed tab and Lighting Control

**Files:**
- Modify: `apps/web/src/app/bed/page.tsx` (whole file)
- Create: `apps/web/src/app/bed/lighting/page.tsx`
- Delete: `apps/web/src/components/RoomNow.tsx`

**Interfaces:**
- Consumes: Task 1 `presenceSummary`, `nightWindow`, `nightDateFor` (existing); Task 3 `movementLevel`; Task 5 kit, `useTabParam`, `ColorWheel`; Task 7 `useLightCommand`, `useRoomPresence`, `PRESENCE_KINDS`; existing `useRoom`, `useDevice`, `useStream`, `lightCss`, `GROUP_META`, `Swatch`.
- Produces: `/bed/` and `/bed/lighting/`.

- [ ] **Step 1: Bed page**

Replace `app/bed/page.tsx` with:

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { lightCss, nightDateFor, nightWindow, presenceSummary } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { fmtClock, fmtDuration } from '@/lib/format';
import { movementLevel } from '@/lib/levels';
import { useDevice } from '@/lib/useDevice';
import { useLightCommand } from '@/lib/useLightCommand';
import { useRoom } from '@/lib/useRoom';
import { PRESENCE_KINDS, useRoomPresence } from '@/lib/useRoomPresence';
import { useStream } from '@/lib/useStream';
import { AppShell } from '@/components/AppShell';
import { BedIcon, BulbIcon, ExitIcon, RadarIcon, WalkIcon } from '@/components/Icons';
import { GROUP_META, Swatch } from '@/components/LightMix';
import { ListRow } from '@/components/ui/ListRow';
import { SectionCard } from '@/components/ui/SectionCard';
import { SegmentedTabs, SegmentedToggle } from '@/components/ui/SegmentedTabs';
import { StatTile } from '@/components/ui/StatTile';
import { StatusPill } from '@/components/ui/StatusPill';
import { TimelineStrip } from '@/components/ui/TimelineStrip';

const WINDOWS = [
  { id: '60', label: '1 h' },
  { id: '360', label: '6 h' },
  { id: '1440', label: '24 h' },
] as const;

export default function BedPage() {
  const router = useRouter();
  const { room, active, devices } = useDevice();
  const live = useRoom(room?.deviceId ?? null);
  const { state, history } = useStream(active?.deviceId ?? null);
  const [win, setWin] = useState<'60' | '360' | '1440'>('60');
  const graph = useRoomPresence(room?.deviceId ?? null, Number(win) as 60 | 360 | 1440, live.present);
  const day = useRoomPresence(room?.deviceId ?? null, 1440, live.present);
  const light = useLightCommand(room?.deviceId ?? null, live.lastAck);
  const asked = useRef(false);

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
  }, [router]);

  // Auto mode is only reported in status frames. Ask once, quietly.
  useEffect(() => {
    if (!room || asked.current || !live.online || live.auto !== null) return;
    asked.current = true;
    void api.queueCommand(room.deviceId, { cmd: 'status' }).catch(() => undefined);
  }, [room, live.online, live.auto]);

  const summary = presenceSummary(graph.segments);
  const tz = new Date().getTimezoneOffset();
  const tonight = nightWindow(nightDateFor(Date.now(), tz), tz);
  const lastExit = presenceSummary(day.segments).lastExitAt;
  const exitTonight = lastExit !== null && lastExit >= tonight.start ? lastExit : null;
  const bandLive = state === 'live';
  const movement = useMemo(
    () => (bandLive ? movementLevel(history.slice(-50).filter((f) => f.imu.ok).map((f) => f.imu.mag)) : null),
    [bandLive, history],
  );
  const css = lightCss(live.light);
  const brightness = live.light?.on ? (live.light.mode === 'colour' ? live.light.color?.v ?? 100 : live.light.bright ?? 100) : null;

  if (devices !== null && !room) {
    return (
      <AppShell title="Bed">
        <SectionCard title="Add the bed unit">
          <p className="text-muted">The bed unit is the radar by your bed and the bulb it controls. Set it up from the app over Bluetooth.</p>
          <Link href="/more/devices/room-setup/" className="btn-primary mt-4 inline-block">
            Set up the bed unit
          </Link>
        </SectionCard>
      </AppShell>
    );
  }

  const present = live.present;
  return (
    <AppShell title="Bed" action={<StatusPill tone={live.online ? 'good' : 'idle'} label={live.online ? 'Connected' : 'Offline'} />}>
      <div className="space-y-4">
        <SectionCard title="Bed Unit Status">
          <div className="grid grid-cols-2 gap-3">
            <StatTile icon={<BedIcon className="h-5 w-5" />} tone="good" label="Occupancy" value={present === null ? '--' : present ? 'Occupied' : 'Empty'} />
            <StatTile icon={<RadarIcon className="h-5 w-5" />} tone="primary" label="Presence" value={present === null ? '--' : present ? 'Detected' : 'Not detected'} />
            <StatTile icon={<ExitIcon className="h-5 w-5" />} tone="heart" label="Bed Exit" value={exitTonight ? `Left ${fmtClock(exitTonight)}` : 'Not detected'} />
            {movement && <StatTile icon={<WalkIcon className="h-5 w-5" />} tone="motion" label="Movement" value={movement} status="from wristband" statusTone="muted" />}
          </div>
        </SectionCard>

        <SectionCard title="Presence" action={<div className="w-40"><SegmentedTabs tabs={[...WINDOWS]} active={win} onChange={setWin} /></div>}>
          <TimelineStrip segments={graph.segments} kinds={PRESENCE_KINDS} from={graph.from} to={graph.to} />
          <p className="mt-3 text-sm text-muted">
            In bed {fmtDuration(summary.presentMs)} of the last {WINDOWS.find((w) => w.id === win)!.label}
            {summary.exits > 0 ? ` · left ${summary.exits} ${summary.exits === 1 ? 'time' : 'times'}` : ''}
          </p>
        </SectionCard>

        <section className="card overflow-hidden">
          <h2 className="px-5 pt-5 font-semibold">Radar Monitoring</h2>
          <div className="mt-2">
            <ListRow
              icon={<BedIcon className="h-5 w-5" />}
              tone="good"
              title="Presence / Occupancy"
              subtitle={present === null ? 'Waiting for the radar' : present ? 'Person in bed' : 'No one in bed'}
            />
          </div>
        </section>

        <SectionCard title="Smart Lighting" action={<Link href="/bed/lighting/" className="text-sm font-medium text-primary">Lighting control</Link>}>
          <div className="flex items-center gap-3">
            <Swatch className="h-9 w-9" fill={css ?? GROUP_META.off.color} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{!live.light ? 'Light state unknown' : live.light.on ? 'Light is on' : 'Light is off'}</p>
              {brightness !== null && <p className="text-sm text-muted">{brightness}%</p>}
            </div>
            <BulbIcon className="h-5 w-5 text-skin" />
          </div>
          <p className="mb-2 mt-4 text-sm text-muted">Lighting Mode</p>
          <SegmentedToggle
            tabs={[
              { id: 'manual', label: 'Manual' },
              { id: 'adaptive', label: 'Adaptive Radar' },
            ]}
            active={live.auto ? 'adaptive' : 'manual'}
            onChange={(id) => void light.send({ cmd: 'auto', on: id === 'adaptive' })}
          />
          {light.message && <p className="mt-3 text-sm text-muted">{light.message}</p>}
        </SectionCard>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Lighting Control**

`app/bed/lighting/page.tsx`:

```tsx
'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import type { Command } from '@lacs/contracts';
import { useDevice } from '@/lib/useDevice';
import { useLightCommand } from '@/lib/useLightCommand';
import { useRoom } from '@/lib/useRoom';
import { useTabParam } from '@/lib/useTabParam';
import { PowerIcon } from '@/components/Icons';
import { SubPage } from '@/components/SubPage';
import { ColorWheel } from '@/components/ui/ColorWheel';
import { SectionCard } from '@/components/ui/SectionCard';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';

type LightCmd = Extract<Command, { cmd: 'light' }>;

const SWATCHES: { label: string; css: string; command: LightCmd }[] = [
  { label: 'Warm night', css: '#FFA957', command: { cmd: 'light', on: true, bright: 15, temp: 0 } },
  { label: 'Reading', css: '#FFECD2', command: { cmd: 'light', on: true, bright: 70, temp: 40 } },
  { label: 'Amber', css: 'hsl(30 100% 50%)', command: { cmd: 'light', on: true, color: { h: 30, s: 100, v: 25 } } },
  { label: 'Red', css: 'hsl(0 100% 50%)', command: { cmd: 'light', on: true, color: { h: 0, s: 100, v: 15 } } },
  { label: 'Blue', css: 'hsl(230 100% 55%)', command: { cmd: 'light', on: true, color: { h: 230, s: 100, v: 30 } } },
];

function LightingView() {
  const { room } = useDevice();
  const live = useRoom(room?.deviceId ?? null);
  const { send, message } = useLightCommand(room?.deviceId ?? null, live.lastAck);
  const [tab, setTab] = useTabParam(['manual', 'adaptive'] as const, 'manual');
  const colour = live.light?.mode === 'colour' ? live.light.color : null;
  const [hue, setHue] = useState(colour?.h ?? 30);
  const [sat, setSat] = useState(colour?.s ?? 100);
  const [bright, setBright] = useState(colour?.v ?? live.light?.bright ?? 50);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the bulb when its state arrives or changes elsewhere.
  useEffect(() => {
    if (!live.light) return;
    if (live.light.mode === 'colour' && live.light.color) {
      setHue(live.light.color.h);
      setSat(live.light.color.s);
      setBright(live.light.color.v);
    } else if (live.light.bright) {
      setBright(live.light.bright);
    }
  }, [live.light]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const sendBrightness = (v: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void send(
        live.light?.mode === 'colour'
          ? { cmd: 'light', on: true, color: { h: hue, s: sat, v } }
          : { cmd: 'light', on: true, bright: v, temp: live.light?.temp ?? 20 },
      );
    }, 500);
  };

  const on = live.light?.on ?? false;

  return (
    <div className="space-y-4">
      <SegmentedTabs
        tabs={[
          { id: 'manual', label: 'Manual' },
          { id: 'adaptive', label: 'Adaptive Radar' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'manual' && (
        <SectionCard>
          <ColorWheel
            hue={hue}
            sat={sat}
            onChange={(h, s) => {
              setHue(h);
              setSat(s);
            }}
            onCommit={(h, s) => void send({ cmd: 'light', on: true, color: { h, s, v: Math.max(1, bright) } })}
          />

          <label className="mt-6 block">
            <span className="flex justify-between text-sm font-medium">
              Brightness <span className="tabular text-muted">{bright}%</span>
            </span>
            <input
              type="range"
              min={1}
              max={100}
              value={bright}
              onChange={(e) => {
                const v = Number(e.target.value);
                setBright(v);
                sendBrightness(v);
              }}
              className="mt-2 w-full accent-[rgb(var(--primary))]"
            />
          </label>

          <div className="mt-5 flex justify-between gap-2">
            {SWATCHES.map((s) => (
              <button
                key={s.label}
                type="button"
                aria-label={s.label}
                title={s.label}
                className="h-10 w-10 rounded-full border-2 border-line"
                style={{ background: s.css }}
                onClick={() => void send(s.command)}
              />
            ))}
          </div>

          <button
            type="button"
            className={`mx-auto mt-6 flex items-center gap-2 rounded-pill border px-6 py-3 font-semibold ${
              on ? 'border-good text-good' : 'border-line text-muted'
            }`}
            onClick={() => void send({ cmd: 'light', on: !on })}
          >
            <PowerIcon className="h-5 w-5" />
            {on ? 'Turn Off' : 'Turn On'}
          </button>
        </SectionCard>
      )}

      {tab === 'adaptive' && (
        <SectionCard title="Adaptive Radar Mode">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted">On when someone comes in, off 30 s after the room empties.</p>
            <button
              type="button"
              role="switch"
              aria-checked={live.auto === true}
              aria-label="Adaptive Radar Mode"
              onClick={() => void send({ cmd: 'auto', on: !(live.auto === true) })}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${live.auto ? 'bg-good' : 'bg-line'}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${live.auto ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
          {live.auto === null && <p className="mt-3 text-xs text-muted">Asking the bed unit whether it is on…</p>}
        </SectionCard>
      )}

      {message && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}

export default function LightingPage() {
  return (
    <SubPage title="Lighting Control">
      <Suspense fallback={<p className="text-muted">Loading</p>}>
        <LightingView />
      </Suspense>
    </SubPage>
  );
}
```

- [ ] **Step 3: Remove `RoomNow`**

Run: `cd /c/lacs_thesis/apps/web/src && grep -rn "RoomNow" app components lib`
Expected: only `components/RoomNow.tsx` itself. Then `git rm -q components/RoomNow.tsx`.

- [ ] **Step 4: Typecheck, test, build**

Run: `cd /c/lacs_thesis && npm run typecheck --workspace @lacs/web && npm test --workspace @lacs/web && npm run build --workspace @lacs/web`
Expected: all exit 0; the build lists `/bed` and `/bed/lighting`.

- [ ] **Step 5: Commit**

```bash
cd /c/lacs_thesis
git add -A apps/web/src/app/bed apps/web/src/components/RoomNow.tsx
git commit -m "feat(app): Bed tab with presence graph and status, Lighting Control with colour wheel"
```

---

### Task 11: Demo data, screenshots, phone check

**Files:**
- Create: `scripts/seed-demo.mjs`
- Modify: `README.md` (a "Demo data" paragraph under the existing development section)

**Interfaces:**
- Consumes: the running local API (`npm run dev:api`, port 4000) and web (`npm run dev:web`, port 3000).
- Produces: a demo account printed by the script; screenshots in the session scratchpad.

- [ ] **Step 1: Seed script**

`scripts/seed-demo.mjs`:

```js
#!/usr/bin/env node
/**
 * Fills a LOCAL Somnus API with a demo account and a night of data, for
 * screenshots and the thesis demo. Refuses any other host, so it can never
 * write invented data to the real server.
 *
 *   node scripts/seed-demo.mjs [--api http://localhost:4000]
 */
const arg = process.argv.indexOf('--api');
const API = arg > 0 ? process.argv[arg + 1] : 'http://localhost:4000';
const host = new URL(API).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error(`[seed] refusing ${API}: demo data only goes to localhost`);
  process.exit(1);
}
const BASE = `${API}/api/v1`;

async function call(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const MIN = 60_000;
const HOURS = 8;
const NEWEST = 50_000_000; // device ms of the newest frame; ingest anchors it at arrival

const email = `demo-${Date.now()}@example.com`;
const password = 'demo-password-123';
const { token } = await call('/auth/register', { body: { email, password } });
const band = await call('/devices/claim', { token, body: { deviceId: 'lacs-dec0de', name: 'Demo band' } });
const room = await call('/devices/claim', { token, body: { deviceId: 'room-dec0de', name: 'Demo bed unit' } });

// Room: a heartbeat a minute for 8 hours, with two trips out of bed.
const out = (m) => (m >= 180 && m < 186) || (m >= 390 && m < 394);
const roomFrames = [];
let seq = 1;
for (let m = HOURS * 60; m >= 0; m--) {
  roomFrames.push({ v: 2, t: 'presence', id: 'room-dec0de', seq: seq++, ms: NEWEST - m * MIN, present: !out(HOURS * 60 - m) });
}
const lightAt = (minutesAgo, state, source) => ({
  v: 2, t: 'light', id: 'room-dec0de', seq: seq++, ms: NEWEST - minutesAgo * MIN,
  on: state.on, mode: state.mode, bright: state.bright ?? null, temp: state.temp ?? null, color: state.color ?? null, source,
});
roomFrames.push(lightAt(HOURS * 60, { on: true, mode: 'white', bright: 40, temp: 10 }, 'auto'));
roomFrames.push(lightAt(HOURS * 60 - 20, { on: true, mode: 'colour', color: { h: 20, s: 90, v: 15 } }, 'app'));
roomFrames.push(lightAt(HOURS * 60 - 60, { on: false, mode: 'white', bright: 15, temp: 0 }, 'auto'));
await call('/ingest', { token: room.ingestToken, body: { frames: roomFrames } });

// Band: one reading a minute for 8 hours - heart rate drifting down, a rise
// at each trip out of bed.
const bandFrames = [];
for (let m = HOURS * 60; m >= 0; m--) {
  const t = HOURS * 60 - m;
  const up = out(t) ? 25 : 0;
  const bpm = Math.round(66 - 8 * Math.sin((t / (HOURS * 60)) * Math.PI) + up + (Math.random() * 4 - 2));
  const mag = out(t) ? 1.35 : 1 + (Math.random() * 0.06 - 0.03);
  bandFrames.push({
    v: 2, t: 'telemetry', id: 'lacs-dec0de', seq: t + 1, ms: NEWEST - m * MIN,
    ppg: { ok: true, finger: true, ir: 98000, red: 87000, bpm, bpmAvg: bpm, spo2: 95 + Math.round(Math.random() * 3), spo2Valid: true },
    imu: { ok: true, ax: 0, ay: 0, az: mag, gx: 0, gy: 0, gz: 0, mag, tempC: 31 },
    gsr: { ok: true, raw: 1800 + (out(t) ? 400 : Math.round(Math.random() * 60)), volt: 1.45, base: 1800 },
    steps: { count: 0, cadence: 0 },
    motor: { on: false, pattern: 'idle' },
    flags: [],
  });
}
await call('/ingest', { token: band.ingestToken, body: { frames: bandFrames } });

console.log(`[seed] demo account ready on ${API}`);
console.log(`[seed]   email:    ${email}`);
console.log(`[seed]   password: ${password}`);
```

- [ ] **Step 2: Refusal check**

Run: `cd /c/lacs_thesis && node scripts/seed-demo.mjs --api https://somnus-api-kx6h.onrender.com; echo "exit $?"`
Expected: `[seed] refusing https://somnus-api-kx6h.onrender.com: demo data only goes to localhost` and `exit 1`.

- [ ] **Step 3: Run locally and seed**

Start the API and web against the local server (background):

Run: `cd /c/lacs_thesis && NEXT_PUBLIC_API_URL=http://localhost:4000 npm run dev`
Expected: API on 4000, web on 3000.

Run: `cd /c/lacs_thesis && node scripts/seed-demo.mjs`
Expected: prints an email and password.

- [ ] **Step 4: Screenshots and comparison**

In a browser at 390 × 844, log in with the demo account and capture, in **dark** then **light** (switch in More → App Settings): `/home/`, `/sleep/`, `/health/?tab=heart`, `/health/?tab=spo2`, `/health/?tab=stress`, `/health/?tab=history`, `/health/heart/`, `/bed/`, `/bed/lighting/`, `/bed/lighting/?tab=adaptive`, `/more/`, `/more/devices/`, `/more/settings/`. Then log in as a fresh account with no devices and capture `/home/`, `/health/`, `/bed/` (empty states). Compare each with `new_ui_changes/somnus_ui1.png` / `somnus_ui2.png`; fix layout differences for parts that have data in A; show the screenshots to the user.

Also open each old address — `/device/`, `/me/`, `/node/`, `/exercise/`, `/history/?id=lacs-dec0de` — and confirm it lands on its new page with the query kept.

Expected: no console errors; no `NaN`, `undefined` or `0 BPM` on any screen; offline gaps hatched in the Bed strip.

- [ ] **Step 5: Full verification**

Run: `cd /c/lacs_thesis && npm run build:contracts && npm test && npm run typecheck && npm run build --workspace @lacs/web`
Expected: all pass; record the test counts.

Build the debug APK (`JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot" npm run apk`), install it on a phone and check: bottom bar and safe area, the theme carries over from 0.5.0, band pairing and room setup open from More → Device Management, the colour wheel drags without scrolling the page and only sends on release.

- [ ] **Step 6: README and commit**

Add to `README.md` under the development section:

```markdown
### Demo data

`node scripts/seed-demo.mjs` creates a demo account on a **local** API with a
night of bed-unit and band data, and prints its login. It refuses any host
other than localhost, so it can never write invented data to the real server.
```

```bash
cd /c/lacs_thesis
git add scripts/seed-demo.mjs README.md
git commit -m "chore: local demo data for screenshots and the defense"
```

No release in this plan: version bump and release follow docs/RELEASING.md when the user asks.
