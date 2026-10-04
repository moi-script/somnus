import type { ReactNode } from 'react';
import { IconDisc } from './IconDisc';
import { TONE, type Tone } from './tone';

/** Icon, label, one big value and a short status, as in the mockups' tiles. */
export function StatTile({
  icon,
  tone,
  label,
  value,
  unit,
  status,
  statusTone,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: string;
  unit?: string;
  status?: string | null;
  statusTone?: Tone;
}) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <IconDisc icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="truncate text-xs text-muted">{label}</p>
        <p className="tabular truncate text-lg font-bold leading-tight">
          {value}
          {unit && <span className="ml-1 text-xs font-medium text-muted">{unit}</span>}
        </p>
        {status && <p className={`truncate text-xs font-medium ${TONE[statusTone ?? tone].text}`}>{status}</p>}
      </div>
    </div>
  );
}
