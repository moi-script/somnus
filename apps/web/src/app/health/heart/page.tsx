'use client';

import { useMemo, useState } from 'react';
import { hrStatus } from '@/lib/levels';
import { useDevice } from '@/lib/useDevice';
import { startOfDay, useSeries } from '@/lib/useSeries';
import { useStream } from '@/lib/useStream';
import { ChevronIcon } from '@/components/Icons';
import { SubPage } from '@/components/SubPage';
import { ChartStatsRow, LineChart } from '@/components/ui/LineChart';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatusPill } from '@/components/ui/StatusPill';

const DAY = 86_400_000;

export default function HeartDetailPage() {
  const { active } = useDevice();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const isToday = day.getTime() === startOfDay(new Date()).getTime();
  const end = useMemo(() => (isToday ? null : new Date(day.getTime() + DAY)), [day, isToday]);
  const { points, loading } = useSeries(active?.deviceId ?? null, day, end);
  const { state, latest } = useStream(active?.deviceId ?? null);

  const bpmPoints = points.flatMap((p) => (p.bpm === null ? [] : [{ t: Date.parse(p.at), v: p.bpm }]));
  const current =
    isToday && state === 'live' && latest?.ppg.ok && latest.ppg.finger ? Math.round(latest.ppg.bpmAvg || latest.ppg.bpm) || null : null;
  const status = hrStatus(current);

  return (
    <SubPage title="Heart Rate">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button type="button" className="btn px-3" aria-label="Previous day" onClick={() => setDay(new Date(day.getTime() - DAY))}>
            <ChevronIcon className="h-5 w-5 rotate-180" />
          </button>
          <span className="font-semibold">
            {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button type="button" className="btn px-3" aria-label="Next day" disabled={isToday} onClick={() => setDay(new Date(day.getTime() + DAY))}>
            <ChevronIcon className="h-5 w-5" />
          </button>
        </div>

        <SectionCard>
          <div className="text-center">
            <p className="tabular text-5xl font-bold">
              {current ?? '--'} <span className="text-lg font-medium text-muted">BPM</span>
            </p>
            <p className="text-sm text-muted">{isToday ? 'Current' : 'No live value for a past day'}</p>
            {status && (
              <div className="mt-2">
                <StatusPill tone={status === 'Normal' ? 'good' : status === 'Low' ? 'warn' : 'bad'} label={status} />
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-center">
            <ChartStatsRow values={bpmPoints.map((p) => p.v)} unit="BPM" />
          </div>
          <div className="mt-4">
            {loading ? (
              <p className="py-10 text-center text-sm text-muted">Loading…</p>
            ) : (
              <LineChart points={bpmPoints} tone="heart" from={day.getTime()} to={end ? end.getTime() : Date.now()} label="Heart rate for the day" />
            )}
          </div>
        </SectionCard>
      </div>
    </SubPage>
  );
}
