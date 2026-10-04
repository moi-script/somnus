'use client';

import type { NightSummary } from '@lacs/contracts';
import { GROUP_META, UNKNOWN_FILL } from './LightMix';
import { TimelineStrip } from './ui/TimelineStrip';

const ROOM_KINDS = {
  present: { label: 'In the room', fill: 'rgb(var(--sleep))' },
  absent: { label: 'Room empty', fill: 'rgb(var(--line))' },
  unknown: { label: 'No data', fill: UNKNOWN_FILL },
};

/**
 * The night as two aligned strips: when someone was in the room, and what the
 * light was doing, painted in the bulb's real colour. Dimmer light draws
 * fainter, so a 10% amber glow does not look like a floodlight.
 */
export function NightStrips({ night }: { night: NightSummary }) {
  const stretch = night.stretch;
  if (!stretch) return null;
  return (
    <div className="space-y-3">
      <TimelineStrip
        label="Room"
        from={stretch.start}
        to={stretch.end}
        kinds={ROOM_KINDS}
        axis={false}
        segments={night.presence.map((p) => ({ from: p.from, to: p.to, kind: p.state }))}
      />
      <TimelineStrip
        label="Light"
        from={stretch.start}
        to={stretch.end}
        kinds={{}}
        legend={false}
        segments={night.light.timeline.map((l) => ({
          from: l.from,
          to: l.to,
          kind: l.group,
          fill: l.group === 'unknown' ? UNKNOWN_FILL : (l.css ?? GROUP_META.off.color),
          opacity: l.bright === null ? 1 : 0.35 + (0.65 * l.bright) / 100,
          title: GROUP_META[l.group].label + (l.bright ? `, ${l.bright}%` : ''),
        }))}
      />
    </div>
  );
}
