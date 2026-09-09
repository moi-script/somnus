'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Reading, StoredEvent } from '@lacs/contracts';
import { api } from '@/lib/api';
import { SubPage } from '@/components/SubPage';
import { Trace } from '@/components/Trace';
import { EventList } from '@/components/EventList';

const RANGES = [
  { label: 'Last 200', limit: 200 },
  { label: 'Last 500', limit: 500 },
  { label: 'Last 1000', limit: 1000 },
];

function summarise(values: number[]) {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: sum / values.length,
  };
}

function HistoryView() {
  const params = useSearchParams();
  const deviceId = params.get('id');
  const [limit, setLimit] = useState(200);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!deviceId) return;
    setLoading(true);
    void (async () => {
      const [r, e] = await Promise.all([
        api.readings(deviceId, limit).catch(() => [] as Reading[]),
        api.events(deviceId, 100).catch(() => [] as StoredEvent[]),
      ]);
      setReadings(r);
      setEvents(e);
      setLoading(false);
    })();
  }, [deviceId, limit]);

  const series = useMemo(
    () => ({
      bpm: readings.map((r) => r.ppg.bpmAvg || r.ppg.bpm),
      gsr: readings.map((r) => r.gsr.raw),
      motion: readings.map((r) => r.imu.mag),
    }),
    [readings],
  );

  const span = useMemo(() => {
    if (readings.length === 0) return null;
    const first = readings[0]?.recordedAt;
    const last = readings[readings.length - 1]?.recordedAt;
    if (!first || !last) return null;
    return `${new Date(first).toLocaleString()} to ${new Date(last).toLocaleTimeString()}`;
  }, [readings]);

  if (!deviceId) {
    return (
      <p className="text-muted">
        No device selected. <Link href="/device/" className="text-motion">Pick one</Link>.
      </p>
    );
  }

  const channels = [
    { name: 'Pulse', unit: 'bpm', color: '#FF6B8A', data: series.bpm, precision: 0, minSpan: 12 },
    { name: 'Skin', unit: 'counts', color: '#F5A524', data: series.gsr, precision: 0, minSpan: 150 },
    { name: 'Motion', unit: 'g', color: '#2ED3C6', data: series.motion, precision: 2, minSpan: 0.4 },
  ];

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-4">
        <p className="text-sm text-muted">{deviceId}</p>
        <div className="flex gap-2">
          {RANGES.map((range) => (
            <button
              key={range.limit}
              type="button"
              className={
                range.limit === limit
                  ? 'rounded-pill border border-motion px-3 py-1 text-sm text-motion'
                  : 'rounded border border-line px-3 py-1 text-sm text-muted hover:text-ink'
              }
              onClick={() => setLimit(range.limit)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="mt-6 text-muted">Loading</p>}

      {!loading && readings.length === 0 && (
        <p className="mt-6 max-w-prose text-muted">
          Nothing recorded yet. Start the USB bridge or connect the phone app,
          and readings will appear here.
        </p>
      )}

      {!loading && readings.length > 0 && (
        <>
          <p className="mt-4 text-sm text-muted">
            {readings.length} readings, {span}
          </p>

          <div className="mt-4">
            {channels.map((channel) => {
              const stats = summarise(channel.data);
              return (
                <section key={channel.name} className="border-b border-line py-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <h2 className="font-medium" style={{ color: channel.color }}>
                      {channel.name}
                    </h2>
                    {stats && (
                      <p className="tabular text-sm text-muted">
                        min {stats.min.toFixed(channel.precision)} · mean{' '}
                        {stats.mean.toFixed(channel.precision)} · max{' '}
                        {stats.max.toFixed(channel.precision)} {channel.unit}
                      </p>
                    )}
                  </div>
                  <div className="mt-3">
                    <Trace
                      data={channel.data}
                      color={channel.color}
                      minSpan={channel.minSpan}
                      height={110}
                      label={channel.name}
                    />
                  </div>
                </section>
              );
            })}
          </div>

          <section className="mt-8">
            <h2 className="border-b border-line pb-2 font-medium">Events</h2>
            <EventList
              events={events.map((e) => ({
                kind: e.kind,
                value: e.value,
                at: e.recordedAt,
                seq: e.seq,
              }))}
            />
          </section>
        </>
      )}
    </main>
  );
}

export default function HistoryPage() {
  return (
    <SubPage title="History" subtitle="Everything the band has recorded">
      <Suspense fallback={<p className="text-muted">Loading</p>}>
        <HistoryView />
      </Suspense>
    </SubPage>
  );
}
