import { describe, expect, it } from 'vitest';
import {
  lightCss,
  lightGroup,
  nightDateFor,
  nightWindow,
  summarizeNight,
  type LightSample,
  type LightState,
  type PresenceSample,
} from '../src/index.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Manila, UTC+8. getTimezoneOffset() reports it as -480. */
const TZ = -480;
const DATE = '2026-09-17';
const WINDOW = nightWindow(DATE, TZ);

/** Local clock time on the night of DATE; hours past 24 are the next morning. */
function at(h: number, m = 0, s = 0): number {
  return WINDOW.start + (h - 18) * HOUR + m * MIN + s * 1000;
}

/** What the room unit sends: one sample per minute, starting at `from`. */
function beats(from: number, to: number, present: boolean): PresenceSample[] {
  const out: PresenceSample[] = [];
  for (let t = from; t < to; t += MIN) out.push({ at: t, present });
  return out;
}

const warm: LightState = { on: true, mode: 'white', bright: 20, temp: 10, color: null };
const cool: LightState = { on: true, mode: 'white', bright: 60, temp: 90, color: null };
const off: LightState = { on: false, mode: 'white', bright: 20, temp: 10, color: null };

describe('nightWindow', () => {
  it('runs 18:00 to 14:00 local, labelled by the evening', () => {
    expect(new Date(WINDOW.start).toISOString()).toBe('2026-09-17T10:00:00.000Z');
    expect(new Date(WINDOW.end).toISOString()).toBe('2026-09-18T06:00:00.000Z');
  });

  it('files the small hours under the evening before', () => {
    expect(nightDateFor(at(27), TZ)).toBe('2026-09-17'); // 03:00 on the 18th
    expect(nightDateFor(at(22), TZ)).toBe('2026-09-17');
    expect(nightDateFor(at(42), TZ)).toBe('2026-09-18'); // 18:00 on the 18th
  });
});

describe('summarizeNight - the room', () => {
  const ordinary = [...beats(at(23), at(31), true), ...beats(at(31), at(33), false)];

  it('measures an ordinary night', () => {
    const n = summarizeNight(DATE, WINDOW, ordinary, []);
    expect(n.recorded).toBe(true);
    expect(n.stretch).toEqual({ start: at(23), end: at(31) });
    expect(n.inRoomMs).toBe(8 * HOUR);
    expect(n.emptiedCount).toBe(0);
    expect(n.longestStretchMs).toBe(8 * HOUR);
    expect(n.coverage).toBe(1);
  });

  it('does not count a still sleeper the radar briefly lost', () => {
    const samples = [
      ...beats(at(23), at(26), true),
      { at: at(26), present: false },
      ...beats(at(26, 0, 40), at(31), true),
      ...beats(at(31), at(33), false),
    ];
    const n = summarizeNight(DATE, WINDOW, samples, []);
    expect(n.emptiedCount).toBe(0);
    expect(n.inRoomMs).toBe(8 * HOUR);
  });

  it('counts a trip out of the room', () => {
    const samples = [
      ...beats(at(23), at(27), true),
      ...beats(at(27), at(27, 10), false),
      ...beats(at(27, 10), at(31), true),
      ...beats(at(31), at(33), false),
    ];
    const n = summarizeNight(DATE, WINDOW, samples, []);
    expect(n.emptiedCount).toBe(1);
    expect(n.inRoomMs).toBe(8 * HOUR);
    expect(n.longestStretchMs).toBe(4 * HOUR);
  });

  it('reports an hour offline as missing, never as the room emptying', () => {
    const samples = [
      ...beats(at(23), at(25), true),
      ...beats(at(26), at(31), true),
      ...beats(at(31), at(33), false),
    ];
    const n = summarizeNight(DATE, WINDOW, samples, []);
    expect(n.emptiedCount).toBe(0);
    expect(n.stretch).toEqual({ start: at(23), end: at(31) });
    expect(n.coverage).toBeLessThan(0.9);
    expect(n.presence.some((p) => p.state === 'unknown')).toBe(true);
  });

  it('splits the night on a long gap and keeps the longer part', () => {
    const samples = [
      ...beats(at(23), at(25), true),
      ...beats(at(25), at(26, 30), false),
      ...beats(at(26, 30), at(31), true),
      ...beats(at(31), at(33), false),
    ];
    const n = summarizeNight(DATE, WINDOW, samples, []);
    expect(n.stretch).toEqual({ start: at(26, 30), end: at(31) });
  });

  it('does not start the night on a short visit before bed', () => {
    const samples = [
      ...beats(at(22, 30), at(22, 45), true),
      ...beats(at(22, 45), at(23), false),
      ...beats(at(23), at(31), true),
      ...beats(at(31), at(33), false),
    ];
    const n = summarizeNight(DATE, WINDOW, samples, []);
    expect(n.stretch?.start).toBe(at(23));
    expect(n.emptiedCount).toBe(0);
  });

  it('records nothing when the room was barely used', () => {
    expect(summarizeNight(DATE, WINDOW, [], []).recorded).toBe(false);
    const short = [...beats(at(23), at(23, 30), true), ...beats(at(23, 30), at(24), false)];
    const n = summarizeNight(DATE, WINDOW, short, []);
    expect(n.recorded).toBe(false);
    expect(n.stretch).toBeNull();
  });
});

describe('summarizeNight - the light', () => {
  const room = [...beats(at(23), at(31), true), ...beats(at(31), at(33), false)];

  it('tracks colour, changes and consistency across the night', () => {
    const light: LightSample[] = [
      { at: at(22, 50), state: warm, source: 'app' },
      { at: at(23, 30), state: off, source: 'auto' },
      { at: at(30, 30), state: cool, source: 'external' },
    ];
    const n = summarizeNight(DATE, WINDOW, room, light);
    expect(n.light.groupMs.warm).toBe(30 * MIN);
    expect(n.light.groupMs.off).toBe(7 * HOUR);
    expect(n.light.groupMs.cool).toBe(30 * MIN);
    expect(n.light.changes.total).toBe(2);
    expect(n.light.changes.bySource).toMatchObject({ auto: 1, external: 1, app: 0, serial: 0 });
    expect(n.light.consistency).toEqual({ group: 'off', share: 0.875 });
    expect(n.light.coolOrBlueMs).toBe(30 * MIN);
    expect(n.light.onWhilePresentMs).toBe(60 * MIN);
    expect(n.light.avgBrightness).toBe(40);
    expect(n.light.timeline.map((s) => s.group)).toEqual(['warm', 'off', 'cool']);
  });

  it('carries in the state set before the night began', () => {
    const n = summarizeNight(DATE, WINDOW, room, [{ at: at(17), state: off, source: 'app' }]);
    expect(n.light.groupMs.off).toBe(8 * HOUR);
    expect(n.light.changes.total).toBe(0);
  });

  it('does not count a re-report of the same state as a change', () => {
    const n = summarizeNight(DATE, WINDOW, room, [
      { at: at(22), state: off, source: 'app' },
      { at: at(24), state: { ...off, bright: 80 }, source: 'external' },
    ]);
    expect(n.light.changes.total).toBe(0);
  });

  it('does not call the first report of an unknown light a change', () => {
    const n = summarizeNight(DATE, WINDOW, room, [{ at: at(24), state: off, source: 'external' }]);
    expect(n.light.changes.total).toBe(0);
    expect(n.light.groupMs.unknown).toBe(HOUR);
  });

  it('says unknown when there is no light data at all', () => {
    const n = summarizeNight(DATE, WINDOW, room, []);
    expect(n.light.groupMs.unknown).toBe(8 * HOUR);
    expect(n.light.avgBrightness).toBeNull();
  });
});

describe('light groups and colours', () => {
  const colour = (h: number): LightState => ({
    on: true,
    mode: 'colour',
    bright: null,
    temp: null,
    color: { h, s: 90, v: 30 },
  });

  it('groups white by temperature and colour by hue', () => {
    expect(lightGroup(warm)).toBe('warm');
    expect(lightGroup({ ...warm, temp: 50 })).toBe('neutral');
    expect(lightGroup(cool)).toBe('cool');
    expect(lightGroup(colour(20))).toBe('red_amber');
    expect(lightGroup(colour(350))).toBe('red_amber');
    expect(lightGroup(colour(120))).toBe('green');
    expect(lightGroup(colour(240))).toBe('blue_violet');
    expect(lightGroup(colour(60))).toBe('other');
    expect(lightGroup(off)).toBe('off');
    expect(lightGroup(null)).toBe('unknown');
  });

  it('gives a drawable colour only for a lit bulb', () => {
    expect(lightCss(off)).toBeNull();
    expect(lightCss(null)).toBeNull();
    expect(lightCss(colour(240))).toBe('hsl(240 90% 50%)');
    expect(lightCss(warm)).toMatch(/^rgb\(/);
  });
});
