'use client';

import { Trace } from './Trace';

interface ChannelStripProps {
  name: string;
  unit: string;
  value: number | null;
  precision?: number;
  data: number[];
  color: string;
  min?: number;
  max?: number;
  minSpan?: number;
  /** Sensor is not answering on the bus. */
  offline?: boolean;
  note?: string;
}

/**
 * One sensor channel: name and current value on the left, live trace filling
 * the rest. Stacked strips separated by rules, the way a bedside monitor
 * stacks its channels, rather than chopped into identical cards.
 */
export function ChannelStrip({
  name,
  unit,
  value,
  precision = 0,
  data,
  color,
  min,
  max,
  minSpan,
  offline = false,
  note,
}: ChannelStripProps) {
  return (
    <section className="border-b border-rule py-4 sm:py-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex shrink-0 items-baseline gap-3 sm:w-44 sm:flex-col sm:items-start sm:gap-0">
          <h2 className="font-medium" style={{ color }}>
            {name}
          </h2>
          <div className="flex items-baseline gap-1.5">
            <span className="tabular font-mono text-3xl leading-none sm:text-4xl">
              {offline || value === null ? '––' : value.toFixed(precision)}
            </span>
            <span className="text-sm text-muted">{unit}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {offline ? (
            <p className="flex h-16 items-center text-sm text-muted">
              Sensor not responding on the bus
            </p>
          ) : (
            <Trace data={data} color={color} min={min} max={max} minSpan={minSpan} label={name} />
          )}
        </div>
      </div>
      {note && !offline && <p className="mt-1 text-sm text-muted">{note}</p>}
    </section>
  );
}
