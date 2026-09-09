'use client';

import type { TelemetryFrame } from '@lacs/contracts';
import type { StreamState } from '@/lib/useStream';

const STATE_COPY: Record<StreamState, { text: string; color: string }> = {
  connecting: { text: 'Connecting', color: '#7D9AA6' },
  live: { text: 'Live', color: '#4FD6C8' },
  offline: { text: 'No connection', color: '#FF3B3B' },
};

interface StatusBarProps {
  deviceId: string;
  deviceName: string;
  state: StreamState;
  latest: TelemetryFrame | null;
  fw: string | null;
}

/**
 * The line that answers "is this thing working" before any number is read.
 * Sensor health comes straight from each frame's `ok` field, so a Grove cable
 * pulled out of the board shows here within one frame.
 */
export function StatusBar({ deviceId, deviceName, state, latest, fw }: StatusBarProps) {
  const status = STATE_COPY[state];

  const sensors = [
    { name: 'Pulse', ok: latest?.ppg.ok, color: '#FF5470' },
    { name: 'Skin', ok: latest?.gsr.ok, color: '#FFC24B' },
    { name: 'Motion', ok: latest?.imu.ok, color: '#4FD6C8' },
  ];
  const online = sensors.filter((s) => s.ok).length;

  return (
    <header className="border-b border-rule pb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-medium">{deviceName}</h1>
          <span className="font-mono text-sm text-muted">{deviceId}</span>
          {fw && <span className="text-sm text-muted">firmware {fw}</span>}
        </div>

        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: status.color }}
            aria-hidden
          />
          <span className="text-sm" style={{ color: status.color }}>
            {status.text}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {sensors.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-sm">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: s.ok ? s.color : '#17323D' }}
              aria-hidden
            />
            <span style={{ color: s.ok ? undefined : '#7D9AA6' }}>{s.name}</span>
          </span>
        ))}
        <span className="text-sm text-muted">{online} of 3 sensors reporting</span>
        {latest?.motor.on && (
          <span className="text-sm text-skin">Motor running: {latest.motor.pattern}</span>
        )}
      </div>
    </header>
  );
}
