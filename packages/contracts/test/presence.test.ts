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
