import type { LightSource, LightState } from './frames.js';

/**
 * Turning a night of radar and bulb samples into something a person can read.
 *
 * The radar only says "someone is in the room" or not, and it can briefly lose
 * a person lying very still. Everything here is built on that one boolean, so
 * the rules are explicit and live in one place, shared by the API and tests.
 */
export const NIGHT = {
  /** Absences shorter than this are the radar losing a still sleeper. */
  noiseMs: 2 * 60_000,
  /** An absence this long ends one stretch; shorter ones are the room emptying. */
  splitMs: 60 * 60_000,
  /** A stretch only opens on presence at least this long - not a quick visit. */
  openRunMs: 20 * 60_000,
  /** Less presence than this in the window and no night is recorded. */
  minRecordedMs: 60 * 60_000,
  /** Heartbeats come every 60 s; past this a sample says nothing. */
  staleMs: 90_000,
  /** 18:00 local, in hours. The window runs to 14:00 the next day. */
  startHour: 18,
  lengthMs: 20 * 60 * 60_000,
} as const;

export type LightGroup =
  | 'off'
  | 'warm'
  | 'neutral'
  | 'cool'
  | 'red_amber'
  | 'green'
  | 'blue_violet'
  | 'other'
  | 'unknown';

export const LIGHT_GROUPS: readonly LightGroup[] = [
  'off',
  'warm',
  'neutral',
  'cool',
  'red_amber',
  'green',
  'blue_violet',
  'other',
  'unknown',
];

export type PresenceState = 'present' | 'absent' | 'unknown';

export interface PresenceSample {
  at: number;
  present: boolean;
}

export interface LightSample {
  at: number;
  state: LightState;
  source: LightSource;
}

/** Epoch ms throughout: plain numbers survive JSON and need no parsing. */
export interface NightWindow {
  start: number;
  end: number;
}

export interface PresenceSpan {
  from: number;
  to: number;
  state: PresenceState;
}

export interface LightSpan {
  from: number;
  to: number;
  group: LightGroup;
  /** The bulb's actual colour, for drawing. Null when off or unknown. */
  css: string | null;
  /** 1-100, or null when off or unknown. */
  bright: number | null;
}

export interface NightSummary {
  date: string;
  recorded: boolean;
  window: NightWindow;
  stretch: { start: number; end: number } | null;
  inRoomMs: number;
  emptiedCount: number;
  longestStretchMs: number;
  /** Fraction of the stretch the room unit was actually reporting. */
  coverage: number;
  presence: PresenceSpan[];
  light: {
    timeline: LightSpan[];
    groupMs: Record<LightGroup, number>;
    changes: { total: number; bySource: Record<LightSource, number> };
    consistency: { group: LightGroup; share: number } | null;
    onWhilePresentMs: number;
    avgBrightness: number | null;
    coolOrBlueMs: number;
  };
}

// --- dates -------------------------------------------------------------------

/**
 * `tzOffsetMin` is what the browser's Date.getTimezoneOffset() returns:
 * minutes to add to local time to reach UTC (-480 for UTC+8).
 */
export function nightWindow(date: string, tzOffsetMin: number): NightWindow {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const start = Date.UTC(y, m - 1, d, NIGHT.startHour) + tzOffsetMin * 60_000;
  return { start, end: start + NIGHT.lengthMs };
}

/** The evening a moment belongs to. Before 14:00 counts as the night before. */
export function nightDateFor(at: number, tzOffsetMin: number): string {
  const local = new Date(at - tzOffsetMin * 60_000);
  if (local.getUTCHours() < 14) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}

// --- light -------------------------------------------------------------------

export function lightGroup(state: LightState | null): LightGroup {
  if (!state) return 'unknown';
  if (!state.on) return 'off';
  if (state.mode === 'white') {
    const temp = state.temp ?? 0;
    if (temp <= 30) return 'warm';
    if (temp >= 70) return 'cool';
    return 'neutral';
  }
  const h = state.color?.h ?? 0;
  if (h <= 45 || h >= 330) return 'red_amber';
  if (h >= 75 && h <= 165) return 'green';
  if (h >= 180 && h <= 300) return 'blue_violet';
  return 'other';
}

const WARM_RGB = [255, 169, 87];
const NEUTRAL_RGB = [255, 236, 210];
const COOL_RGB = [210, 228, 255];

function mix(a: number[], b: number[], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * t));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/** What the bulb looks like, as a CSS colour. Brightness is left to the caller. */
export function lightCss(state: LightState | null): string | null {
  if (!state || !state.on) return null;
  if (state.mode === 'colour') {
    const c = state.color ?? { h: 0, s: 0, v: 100 };
    return `hsl(${c.h} ${c.s}% 50%)`;
  }
  const t = (state.temp ?? 0) / 100;
  return t <= 0.5 ? mix(WARM_RGB, NEUTRAL_RGB, t * 2) : mix(NEUTRAL_RGB, COOL_RGB, (t - 0.5) * 2);
}

function brightnessOf(state: LightState | null): number | null {
  if (!state || !state.on) return null;
  return state.mode === 'colour' ? (state.color?.v ?? null) : state.bright;
}

/** Two states a person would see as the same light. Off is off, whatever else. */
function sameLight(a: LightState | null, b: LightState | null): boolean {
  if (!a || !b) return a === b;
  if (!a.on && !b.on) return true;
  if (a.on !== b.on || a.mode !== b.mode) return false;
  if (a.mode === 'white') return a.bright === b.bright && a.temp === b.temp;
  return a.color?.h === b.color?.h && a.color?.s === b.color?.s && a.color?.v === b.color?.v;
}

// --- presence ------------------------------------------------------------------

/**
 * Samples to spans. Each sample holds until the next one, but never longer
 * than staleMs - past that the unit was not reporting and the span is unknown.
 */
function presenceSpans(samples: PresenceSample[], w: NightWindow): PresenceSpan[] {
  const sorted = samples
    .filter((s) => s.at >= w.start - NIGHT.staleMs && s.at < w.end)
    .sort((a, b) => a.at - b.at);

  const spans: PresenceSpan[] = [];
  const push = (from: number, to: number, state: PresenceState) => {
    from = Math.max(from, w.start);
    to = Math.min(to, w.end);
    if (to <= from) return;
    const last = spans[spans.length - 1];
    if (last && last.state === state && last.to === from) last.to = to;
    else spans.push({ from, to, state });
  };

  let cursor = w.start;
  sorted.forEach((s, i) => {
    if (s.at > cursor) push(cursor, s.at, 'unknown');
    const next = sorted[i + 1]?.at ?? w.end;
    const holdsUntil = Math.min(next, s.at + NIGHT.staleMs);
    push(s.at, holdsUntil, s.present ? 'present' : 'absent');
    cursor = Math.max(cursor, holdsUntil);
  });
  if (cursor < w.end) push(cursor, w.end, 'unknown');
  return spans;
}

interface Run {
  start: number;
  end: number;
}

interface Gap {
  total: number;
  knownAbsent: number;
}

/**
 * Present runs with noise already bridged, and the gap before each run.
 * gaps[i] sits between runs[i - 1] and runs[i]; gaps[0] is unused.
 */
function presentRuns(spans: PresenceSpan[]): { runs: Run[]; gaps: Gap[] } {
  const runs: Run[] = [];
  const gaps: Gap[] = [];
  let gap: Gap | null = null;
  let gapStart = 0;

  for (const s of spans) {
    if (s.state !== 'present') {
      if (!gap) {
        gap = { total: 0, knownAbsent: 0 };
        gapStart = s.from;
      }
      gap.total = s.to - gapStart;
      if (s.state === 'absent') gap.knownAbsent += s.to - s.from;
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && gap && gap.total < NIGHT.noiseMs) {
      last.end = s.to; // the radar lost a still sleeper - bridge it
    } else {
      runs.push({ start: s.from, end: s.to });
      gaps.push(gap ?? { total: 0, knownAbsent: 0 });
    }
    gap = null;
  }
  return { runs, gaps };
}

interface Stretch {
  start: number;
  end: number;
  emptied: number;
  /** Boundaries between undisturbed stretches, i.e. the room-emptied gaps. */
  pieces: Run[];
}

function findStretches(runs: Run[], gaps: Gap[]): Stretch[] {
  const stretches: Stretch[] = [];
  let current: Stretch | null = null;

  runs.forEach((run, i) => {
    const gap = gaps[i]!;
    if (current && gap.total >= NIGHT.splitMs) {
      stretches.push(current);
      current = null;
    }
    if (!current) {
      if (run.end - run.start >= NIGHT.openRunMs) {
        current = { start: run.start, end: run.end, emptied: 0, pieces: [{ ...run }] };
      }
      return;
    }
    current.end = run.end;
    if (gap.knownAbsent >= NIGHT.noiseMs) {
      current.emptied += 1;
      current.pieces.push({ ...run });
    } else {
      // Offline, not empty: we do not know it was disturbed, so do not say so.
      current.pieces[current.pieces.length - 1]!.end = run.end;
    }
  });
  if (current) stretches.push(current);
  return stretches;
}

function overlap(a: { from: number; to: number }, b: { from: number; to: number }): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
}

function emptyGroups(): Record<LightGroup, number> {
  return Object.fromEntries(LIGHT_GROUPS.map((g) => [g, 0])) as Record<LightGroup, number>;
}

function emptySources(): Record<LightSource, number> {
  return { auto: 0, app: 0, serial: 0, external: 0 };
}

// --- the summary -------------------------------------------------------------

/**
 * One night. `light` may include samples from before the window: the latest
 * of those is the state the bulb was already in when the night began.
 */
export function summarizeNight(
  date: string,
  window: NightWindow,
  presence: PresenceSample[],
  light: LightSample[],
): NightSummary {
  const spans = presenceSpans(presence, window);
  const presentMs = spans
    .filter((s) => s.state === 'present')
    .reduce((sum, s) => sum + (s.to - s.from), 0);

  const { runs, gaps } = presentRuns(spans);
  const main = findStretches(runs, gaps).reduce<Stretch | null>(
    (best, s) => (!best || s.end - s.start > best.end - best.start ? s : best),
    null,
  );

  const empty: NightSummary = {
    date,
    recorded: false,
    window,
    stretch: null,
    inRoomMs: 0,
    emptiedCount: 0,
    longestStretchMs: 0,
    coverage: 0,
    presence: [],
    light: {
      timeline: [],
      groupMs: emptyGroups(),
      changes: { total: 0, bySource: emptySources() },
      consistency: null,
      onWhilePresentMs: 0,
      avgBrightness: null,
      coolOrBlueMs: 0,
    },
  };
  if (!main || presentMs < NIGHT.minRecordedMs) return empty;

  const stretch = { from: main.start, to: main.end };
  const lengthMs = main.end - main.start;
  const inStretch = spans
    .map((s) => ({ ...s, from: Math.max(s.from, stretch.from), to: Math.min(s.to, stretch.to) }))
    .filter((s) => s.to > s.from);
  const unknownMs = inStretch
    .filter((s) => s.state === 'unknown')
    .reduce((sum, s) => sum + (s.to - s.from), 0);

  // Light as a step function across the stretch.
  const sortedLight = [...light].sort((a, b) => a.at - b.at);
  let state: LightState | null = null;
  for (const s of sortedLight) if (s.at <= stretch.from) state = s.state;

  const timeline: LightSpan[] = [];
  const bySource = emptySources();
  let total = 0;
  let from = stretch.from;
  const close = (to: number) => {
    if (to <= from) return;
    const group = lightGroup(state);
    const css = lightCss(state);
    const bright = brightnessOf(state);
    const last = timeline[timeline.length - 1];
    if (last && last.group === group && last.css === css && last.bright === bright) last.to = to;
    else timeline.push({ from, to, group, css, bright });
    from = to;
  };
  for (const s of sortedLight) {
    if (s.at <= stretch.from || s.at >= stretch.to) continue;
    if (sameLight(state, s.state)) continue;
    close(s.at);
    const wasKnown = state !== null;
    state = s.state;
    // Learning what an unknown bulb was doing is not anyone changing it.
    if (!wasKnown) continue;
    total += 1;
    bySource[s.source] += 1;
  }
  close(stretch.to);

  const groupMs = emptyGroups();
  for (const span of timeline) groupMs[span.group] += span.to - span.from;

  const dominant = LIGHT_GROUPS.reduce((a, b) => (groupMs[b] > groupMs[a] ? b : a));

  let onWhilePresentMs = 0;
  let brightWeighted = 0;
  for (const span of timeline) {
    if (span.bright === null) continue;
    for (const p of inStretch) {
      if (p.state !== 'present') continue;
      const ms = overlap(span, p);
      onWhilePresentMs += ms;
      brightWeighted += ms * span.bright;
    }
  }

  return {
    date,
    recorded: true,
    window,
    stretch: { start: main.start, end: main.end },
    inRoomMs: lengthMs,
    emptiedCount: main.emptied,
    longestStretchMs: Math.max(...main.pieces.map((p) => p.end - p.start)),
    coverage: 1 - unknownMs / lengthMs,
    presence: inStretch,
    light: {
      timeline,
      groupMs,
      changes: { total, bySource },
      consistency: { group: dominant, share: groupMs[dominant] / lengthMs },
      onWhilePresentMs,
      avgBrightness: onWhilePresentMs > 0 ? Math.round(brightWeighted / onWhilePresentMs) : null,
      coolOrBlueMs: groupMs.cool + groupMs.blue_violet,
    },
  };
}
