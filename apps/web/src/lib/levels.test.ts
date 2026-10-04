import { describe, expect, it } from 'vitest';
import {
  chartStats,
  consistencyLabel,
  greeting,
  isSleepingNow,
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

describe('isSleepingNow', () => {
  const MIN = 60_000;
  const now = 1_000_000_000;

  it('needs a reporting unit, someone present, and a stretch still running', () => {
    expect(isSleepingNow({ online: true, present: true, stretchEnd: now - 2 * MIN, now })).toBe(true);
  });

  it('does not count someone in the room hours after last night ended', () => {
    expect(isSleepingNow({ online: true, present: true, stretchEnd: now - 5 * 60 * MIN, now })).toBe(false);
  });

  it('does not trust an offline unit or an empty room', () => {
    expect(isSleepingNow({ online: false, present: true, stretchEnd: now, now })).toBe(false);
    expect(isSleepingNow({ online: true, present: false, stretchEnd: now, now })).toBe(false);
    expect(isSleepingNow({ online: true, present: true, stretchEnd: null, now })).toBe(false);
  });
});
