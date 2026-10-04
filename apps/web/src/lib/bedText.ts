import { fmtClock, fmtDuration } from './format';

/** The line under the Bed presence strip; nothing is claimed until the window has loaded. */
export function presenceLine(loading: boolean, summary: { presentMs: number; exits: number }, label: string): string {
  if (loading) return `Loading the last ${label}…`;
  const left = summary.exits > 0 ? ` · left ${summary.exits} ${summary.exits === 1 ? 'time' : 'times'}` : '';
  return `In bed ${fmtDuration(summary.presentMs)} of the last ${label}${left}`;
}

/** Tonight's latest trip out of bed. */
export function bedExitLabel(loading: boolean, lastExitAt: number | null, tonightStart: number): string {
  if (loading) return '--';
  return lastExitAt !== null && lastExitAt >= tonightStart ? `Left ${fmtClock(lastExitAt)}` : 'Not detected';
}
