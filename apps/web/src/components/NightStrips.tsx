'use client';

import type { NightSummary } from '@lacs/contracts';
import { fmtClock } from '@/lib/format';
import { GROUP_META, UNKNOWN_FILL } from './LightMix';

const HOUR = 3_600_000;

/**
 * The night as two aligned strips: when someone was in the room, and what the
 * light was doing, painted in the bulb's real colour. Dimmer light draws
 * fainter, so a 10% amber glow does not look like a floodlight.
 */
export function NightStrips({ night }: { night: NightSummary }) {
  const stretch = night.stretch;
  if (!stretch) return null;
  const span = stretch.end - stretch.start;
  const pos = (from: number, to: number) => ({
    left: `${((from - stretch.start) / span) * 100}%`,
    width: `${((to - from) / span) * 100}%`,
  });

  // Whole hours inside the stretch, thinned so labels never collide.
  const firstHour = Math.ceil(stretch.start / HOUR) * HOUR;
  const hours: number[] = [];
  for (let t = firstHour; t < stretch.end; t += HOUR) hours.push(t);
  const every = Math.max(1, Math.ceil(hours.length / 4));
  const edge = span * 0.1;
  const ticks = hours.filter(
    (t, i) => i % every === 0 && t - stretch.start > edge && stretch.end - t > edge,
  );

  return (
    <div className="space-y-2">
      <Row label="Room">
        {night.presence.map((p) => (
          <div
            key={`${p.from}-${p.state}`}
            className="absolute inset-y-0"
            style={{
              ...pos(p.from, p.to),
              background:
                p.state === 'present'
                  ? 'rgb(var(--sleep))'
                  : p.state === 'unknown'
                    ? UNKNOWN_FILL
                    : 'transparent',
            }}
            title={p.state === 'present' ? 'In the room' : p.state === 'absent' ? 'Room empty' : 'No data'}
          />
        ))}
      </Row>

      <Row label="Light">
        {night.light.timeline.map((l) => (
          <div
            key={`${l.from}-${l.group}`}
            className="absolute inset-y-0"
            style={{
              ...pos(l.from, l.to),
              background: l.group === 'unknown' ? UNKNOWN_FILL : (l.css ?? GROUP_META.off.color),
              opacity: l.bright === null ? 1 : 0.35 + (0.65 * l.bright) / 100,
            }}
            title={GROUP_META[l.group].label + (l.bright ? `, ${l.bright}%` : '')}
          />
        ))}
      </Row>

      <div className="relative ml-12 h-4 text-[11px] text-muted">
        <span className="tabular absolute left-0">{fmtClock(stretch.start)}</span>
        {ticks.map((t) => (
          <span
            key={t}
            className="tabular absolute -translate-x-1/2"
            style={{ left: `${((t - stretch.start) / span) * 100}%` }}
          >
            {fmtClock(t)}
          </span>
        ))}
        <span className="tabular absolute right-0">{fmtClock(stretch.end)}</span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 shrink-0 text-xs font-medium text-muted">{label}</span>
      <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-canvas">{children}</div>
    </div>
  );
}
