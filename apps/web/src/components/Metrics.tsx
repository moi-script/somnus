'use client';

import type { ReactNode } from 'react';

/**
 * A soft sparkline.
 *
 * Smoothed with quadratic segments rather than straight joins, because sharp
 * corners fight the rest of the interface. Still hand-drawn SVG: a chart
 * library would add weight to the APK to draw axes this design does not have.
 */
export function Wave({
  data,
  color,
  height = 56,
  minSpan = 0,
}: {
  data: number[];
  color: string;
  height?: number;
  minSpan?: number;
}) {
  const width = 600;
  if (data.length < 2) return <div style={{ height }} />;

  let lo = Math.min(...data);
  let hi = Math.max(...data);
  // Keep a resting signal looking calm instead of magnifying its noise.
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const span = hi - lo < 1e-6 ? 1 : hi - lo;

  const step = width / (data.length - 1);
  const points = data.map((v, i) => ({
    x: i * step,
    y: height - ((v - lo) / span) * (height - 8) - 4,
  }));

  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const midX = (prev.x + curr.x) / 2;
    d += ` Q ${prev.x} ${prev.y} ${midX} ${(prev.y + curr.y) / 2}`;
  }
  const id = `fade-${color.replace('#', '')}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${id})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The one number worth reading first. */
export function HeroMetric({
  label,
  value,
  unit,
  color,
  data,
  minSpan,
  note,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
  data: number[];
  minSpan?: number;
  note?: string;
  icon: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-start justify-between px-6 pt-6">
        <div>
          <div className="flex items-center gap-2 text-muted">
            <span style={{ color }}>{icon}</span>
            <span className="font-medium">{label}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular text-5xl font-bold leading-none">{value}</span>
            <span className="text-lg text-muted">{unit}</span>
          </div>
          {note && <p className="mt-2 text-sm text-muted">{note}</p>}
        </div>
      </div>
      <div className="mt-4">
        <Wave data={data} color={color} height={72} minSpan={minSpan} />
      </div>
    </section>
  );
}

/** A metric with real numbers behind it. */
export function MetricTile({
  label,
  value,
  unit,
  color,
  icon,
  data,
  minSpan,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  color: string;
  icon: ReactNode;
  data?: number[];
  minSpan?: number;
  note?: string;
}) {
  return (
    <section className="card flex flex-col overflow-hidden">
      <div className="px-5 pt-5">
        <div className="flex items-center gap-2 text-muted">
          <span style={{ color }}>{icon}</span>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="tabular text-3xl font-bold leading-none">{value}</span>
          {unit && <span className="text-sm text-muted">{unit}</span>}
        </div>
        {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      </div>
      {data && data.length > 1 && (
        <div className="mt-3">
          <Wave data={data} color={color} height={44} minSpan={minSpan} />
        </div>
      )}
      {(!data || data.length < 2) && <div className="pb-5" />}
    </section>
  );
}

/**
 * A metric the hardware cannot report yet.
 *
 * Deliberately not a zero or a dash that could pass for a reading. It says
 * what is missing and what would fix it, because a health number nobody
 * measured is worse than an empty space.
 */
export function PendingTile({
  label,
  color,
  icon,
  reason,
}: {
  label: string;
  color: string;
  icon: ReactNode;
  reason: string;
}) {
  return (
    <section className="rounded-card border border-dashed border-line bg-card/60 px-5 py-5">
      <div className="flex items-center gap-2 text-muted">
        <span className="opacity-60" style={{ color }}>
          {icon}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-muted/70">Not measured</p>
      <p className="mt-1 text-sm text-muted">{reason}</p>
    </section>
  );
}
