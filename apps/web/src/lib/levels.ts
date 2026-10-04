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
