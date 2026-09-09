'use client';

import type { Flag } from '@lacs/contracts';

export interface TimelineEvent {
  kind: Flag;
  value: number;
  at: string | null;
  seq: number;
}

/** Same hue as the channel that raised it, so the colour identifies the source. */
const KIND: Record<Flag, { label: string; color: string; unit: string }> = {
  fall: { label: 'Impact or free fall', color: '#FF3B3B', unit: 'g' },
  gsr_spike: { label: 'Skin conductance spike', color: '#FFC24B', unit: 'counts' },
  no_finger: { label: 'Finger left the sensor', color: '#FF5470', unit: 'ms' },
};

function clockTime(at: string | null): string {
  if (!at) return 'just now';
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function EventList({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-sm text-muted">
        No events yet. The node raises one when it detects an impact, a skin
        conductance spike, or a finger leaving the pulse sensor.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-rule">
      {events.map((event) => {
        const kind = KIND[event.kind];
        return (
          <li
            key={`${event.seq}-${event.at ?? ''}`}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3"
          >
            <span className="tabular font-mono text-sm text-muted">{clockTime(event.at)}</span>
            <span className="flex-1" style={{ color: kind.color }}>
              {kind.label}
            </span>
            <span className="tabular font-mono text-sm">
              {event.value.toFixed(2)} {kind.unit}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
