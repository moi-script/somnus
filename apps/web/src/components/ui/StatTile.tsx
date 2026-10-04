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
  stacked = false,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: string;
  unit?: string;
  status?: string | null;
  statusTone?: Tone;
  /** Icon above the text, for narrow tiles inside a card (as on the Bed tab). */
  stacked?: boolean;
}) {
  return (
    <div className={`card flex gap-3 p-4 ${stacked ? 'flex-col items-start' : 'items-center'}`}>
      <IconDisc icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="text-xs leading-tight text-muted">{label}</p>
        <p className={`tabular font-bold leading-tight ${stacked ? 'text-base' : 'truncate text-lg'}`}>
          {value}
          {unit && <span className="ml-1 text-xs font-medium text-muted">{unit}</span>}
        </p>
        {status && <p className={`text-xs font-medium leading-tight ${TONE[statusTone ?? tone].text}`}>{status}</p>}
      </div>
    </div>
  );
}
