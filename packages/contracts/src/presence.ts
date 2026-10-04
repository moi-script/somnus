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
