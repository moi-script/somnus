import type { ReactNode } from 'react';
import { TONE, type Tone } from './tone';

/** Progress ring with the label in the middle, glowing in its tone. */
export function Ring({
  value,
  tone,
  title,
  label,
  sublabel,
  badge,
}: {
  value: number;
  tone: Tone;
  title: string;
  label: string;
  sublabel?: string;
  badge?: ReactNode;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = TONE[tone].color;
  return (
    <div className="relative mx-auto h-52 w-52">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8" style={{ stroke: 'rgb(var(--line))' }} />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ stroke: color, filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xs text-muted">{title}</span>
        <span className="tabular text-3xl font-bold leading-tight">{label}</span>
        {sublabel && <span className="text-xs text-muted">{sublabel}</span>}
        {badge && <span className="mt-2">{badge}</span>}
      </div>
    </div>
  );
}
