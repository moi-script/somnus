'use client';

import { LIGHT_GROUPS, type LightGroup, type NightSummary } from '@lacs/contracts';
import { fmtDuration, fmtNightDate } from '@/lib/format';

/**
 * One colour per light group, close to what the bulb looks like. "Off" is a
 * fixed deep blue-grey in both themes: a dark room should read as dark
 * whether the page is light or not.
 */
export const GROUP_META: Record<LightGroup, { label: string; color: string }> = {
  off: { label: 'Off', color: '#252B3B' },
  warm: { label: 'Warm white', color: '#FFB36B' },
  neutral: { label: 'Neutral white', color: '#FFE3BD' },
  cool: { label: 'Cool white', color: '#C9DDFF' },
  red_amber: { label: 'Red or amber', color: '#FF7A45' },
  green: { label: 'Green', color: '#4FD18B' },
  blue_violet: { label: 'Blue or violet', color: '#6C7BFF' },
  other: { label: 'Other colour', color: '#C79BFF' },
  unknown: { label: 'No light data', color: 'transparent' },
};

/** Diagonal hatching for time nothing was reported. Not a colour that could pass for data. */
export const UNKNOWN_FILL =
  'repeating-linear-gradient(135deg, rgb(var(--line)) 0 4px, transparent 4px 8px)';

export function groupFill(group: LightGroup): string {
  return group === 'unknown' ? UNKNOWN_FILL : GROUP_META[group].color;
}

export function Swatch({ fill, className = 'h-3 w-3' }: { fill: string; className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ring-1 ring-line ${className}`}
      style={{ background: fill }}
    />
  );
}

/** How the night divided between light colours: one bar, then a legend with times. */
export function LightMix({ night }: { night: NightSummary }) {
  const total = night.inRoomMs;
  const groups = LIGHT_GROUPS.filter((g) => night.light.groupMs[g] > 0).sort(
    (a, b) => night.light.groupMs[b] - night.light.groupMs[a],
  );

  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-pill bg-canvas">
        {groups.map((g) => (
          <div
            key={g}
            style={{
              width: `${(night.light.groupMs[g] / total) * 100}%`,
              background: groupFill(g),
            }}
            title={GROUP_META[g].label}
          />
        ))}
      </div>
      <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {groups.map((g) => (
          <li key={g} className="flex items-center gap-2 text-sm">
            <Swatch fill={groupFill(g)} />
            <span className="flex-1">{GROUP_META[g].label}</span>
            <span className="tabular text-muted">
              {fmtDuration(night.light.groupMs[g])} ·{' '}
              {Math.round((night.light.groupMs[g] / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Recent nights side by side. Height is time in the room; the fill shows
 * that night's light mix, so a run of consistent nights looks consistent.
 */
export function NightBars({
  nights,
  selected,
  onSelect,
}: {
  nights: NightSummary[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  const ordered = [...nights].reverse();
  const tallest = Math.max(10 * 3_600_000, ...ordered.map((n) => n.inRoomMs));

  return (
    <div className="flex h-40 items-end gap-1.5">
      {ordered.map((n) => {
        const groups = LIGHT_GROUPS.filter((g) => n.light.groupMs[g] > 0);
        const isSelected = n.date === selected;
        return (
          <button
            key={n.date}
            type="button"
            onClick={() => onSelect(n.date)}
            className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5"
            aria-label={`${fmtNightDate(n.date)}: ${
              n.recorded ? `${fmtDuration(n.inRoomMs)} in the room` : 'no night recorded'
            }`}
            aria-pressed={isSelected}
          >
            {n.recorded ? (
              <div
                className={`flex w-full flex-col-reverse overflow-hidden rounded-lg transition-opacity ${
                  isSelected ? 'ring-2 ring-sleep ring-offset-2 ring-offset-card' : 'opacity-80 group-hover:opacity-100'
                }`}
                style={{ height: `${Math.max(6, (n.inRoomMs / tallest) * 100)}%` }}
              >
                {groups.map((g) => (
                  <div
                    key={g}
                    style={{
                      height: `${(n.light.groupMs[g] / n.inRoomMs) * 100}%`,
                      background: groupFill(g),
                    }}
                  />
                ))}
              </div>
            ) : (
              <div
                className={`h-1.5 w-full rounded-pill border border-dashed ${
                  isSelected ? 'border-sleep' : 'border-line'
                }`}
              />
            )}
            <span className={`text-[11px] ${isSelected ? 'font-semibold text-ink' : 'text-muted'}`}>
              {new Date(`${n.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
