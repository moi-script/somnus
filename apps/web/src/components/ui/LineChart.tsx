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
