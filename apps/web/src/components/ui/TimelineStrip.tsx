import { fmtClock } from '@/lib/format';

export interface StripSegment {
  from: number;
  to: number;
  kind: string;
  /** Overrides the kind's fill, e.g. the bulb's real colour. */
  fill?: string;
  opacity?: number;
  title?: string;
}

/** One horizontal band of coloured spans over time, with an axis and legend. */
export function TimelineStrip({
  segments,
  kinds,
  from,
  to,
  axis = true,
  legend = true,
  label,
}: {
  segments: StripSegment[];
  kinds: Record<string, { label: string; fill: string }>;
  from: number;
  to: number;
  axis?: boolean;
  legend?: boolean;
  label?: string;
}) {
  const span = to - from || 1;
  const pct = (t: number) => `${((t - from) / span) * 100}%`;
  const ticks = [from + span / 3, from + (2 * span) / 3];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {label && <span className="w-10 shrink-0 text-xs font-medium text-muted">{label}</span>}
        <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-canvas" role="img" aria-label={label ?? 'Timeline'}>
          {segments.map((s) => (
            <div
              key={`${s.from}-${s.kind}`}
              className="absolute inset-y-0"
              style={{
                left: pct(s.from),
                width: `${((s.to - s.from) / span) * 100}%`,
                background: s.fill ?? kinds[s.kind]?.fill ?? 'transparent',
                opacity: s.opacity ?? 1,
              }}
              title={s.title ?? kinds[s.kind]?.label}
            />
          ))}
        </div>
      </div>
      {axis && (
        <div className={`relative h-4 text-[11px] text-muted ${label ? 'ml-[3.25rem]' : ''}`}>
          <span className="tabular absolute left-0">{fmtClock(from)}</span>
          {ticks.map((t) => (
            <span key={t} className="tabular absolute -translate-x-1/2" style={{ left: pct(t) }}>
              {fmtClock(t)}
            </span>
          ))}
          <span className="tabular absolute right-0">{fmtClock(to)}</span>
        </div>
      )}
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {Object.entries(kinds).map(([kind, k]) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: k.fill }} />
              {k.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
