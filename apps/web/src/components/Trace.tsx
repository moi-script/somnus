'use client';

interface TraceProps {
  data: number[];
  color: string;
  /** Fixed scale. Omit either bound to autoscale that end to the data. */
  min?: number;
  max?: number;
  /**
   * Smallest range the autoscale will zoom to.
   *
   * Without it, a resting signal fills the strip with amplified sensor noise
   * that reads as dramatic movement. With it, a still channel looks still and
   * a real response still fills the strip.
   */
  minSpan?: number;
  height?: number;
  label: string;
}

/**
 * A strip-chart trace.
 *
 * Hand-drawn SVG rather than a chart library: a trace is one polyline, and a
 * charting dependency would add weight to the APK to draw axes, legends and
 * tooltips that this screen deliberately does not have.
 */
export function Trace({ data, color, min, max, minSpan = 0, height = 64, label }: TraceProps) {
  const width = 1000; // viewBox units; the SVG scales to its container

  if (data.length < 2) {
    return (
      <div
        className="flex items-center text-sm text-muted"
        style={{ height }}
        role="img"
        aria-label={`${label}: waiting for data`}
      >
        Waiting for data
      </div>
    );
  }

  let lo = min ?? Math.min(...data);
  let hi = max ?? Math.max(...data);

  // Widen a too-narrow range around its midpoint, so a resting channel reads
  // as resting instead of as amplified noise. A flat signal must also never
  // divide by zero.
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = min ?? mid - minSpan / 2;
    hi = max ?? mid + minSpan / 2;
  }
  const span = hi - lo < 1e-6 ? 1 : hi - lo;

  const step = width / (data.length - 1);
  const points = data.map((value, i) => {
    const x = i * step;
    const y = height - ((value - lo) / span) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(2)}`;
  });

  const last = data[data.length - 1] ?? 0;
  const lastY = height - ((last - lo) / span) * (height - 6) - 3;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={`${label}: ${data.length} samples, latest ${last}`}
    >
      <polyline
        points={`0,${height} ${points.join(' ')} ${width},${height}`}
        fill={color}
        opacity={0.08}
        stroke="none"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {/* Leading edge, so the eye finds "now" immediately. */}
      <circle cx={width} cy={lastY} r={2.5} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
