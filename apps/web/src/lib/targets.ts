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
