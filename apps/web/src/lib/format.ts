const MIN = 60_000;

/** "7 h 42 m", "38 min", "under a minute". Never a bare number of seconds. */
export function fmtDuration(ms: number): string {
  const minutes = Math.round(ms / MIN);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/** 24-hour clock in the viewer's zone: "22:51". */
export function fmtClock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** "Wed 17 Sep" for a night labelled 2026-09-17. */
export function fmtNightDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Nights are labelled by their evening, so today's date is the night that
 * starts (or started) this evening and yesterday's is last night.
 */
export function nightLabel(date: string): string {
  if (date === localDate(0)) return 'Tonight so far';
  if (date === localDate(-1)) return 'Last night';
  return fmtNightDate(date);
}

/** "14 min ago", "3 h ago". */
export function fmtAgo(at: number, now = Date.now()): string {
  const ms = Math.max(0, now - at);
  if (ms < MIN) return 'just now';
  return `${fmtDuration(ms)} ago`;
}
