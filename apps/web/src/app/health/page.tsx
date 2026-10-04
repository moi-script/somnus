'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SeriesPoint, StoredEvent } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { hrStatus, stressLevel } from '@/lib/levels';
import { useDevice } from '@/lib/useDevice';
import { startOfDay, useSeries } from '@/lib/useSeries';
import { useStream } from '@/lib/useStream';
import { useTabParam } from '@/lib/useTabParam';
import { AppShell } from '@/components/AppShell';
import { EventList } from '@/components/EventList';
import { DropIcon, HeartIcon, SparkIcon } from '@/components/Icons';
import { QuickCheck } from '@/components/QuickCheck';
import { ChartStatsRow, LineChart, type ChartPoint } from '@/components/ui/LineChart';
import { ListRow } from '@/components/ui/ListRow';
import { SectionCard } from '@/components/ui/SectionCard';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { StatusPill } from '@/components/ui/StatusPill';

const TABS = [
  { id: 'heart', label: 'Heart Rate' },
  { id: 'spo2', label: 'SpO₂' },
  { id: 'stress', label: 'Stress' },
  { id: 'history', label: 'History' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const TAB_IDS = TABS.map((t) => t.id);

function pointsOf(series: SeriesPoint[], key: 'bpm' | 'spo2' | 'gsr'): ChartPoint[] {
  return series.flatMap((p) => (p[key] === null ? [] : [{ t: Date.parse(p.at), v: p[key]! }]));
}

const STATUS_TONE = { Normal: 'good', Low: 'warn', High: 'bad', Medium: 'warn' } as const;

function HealthView() {
  const router = useRouter();
  const { active, bands } = useDevice();
  const [tab, setTab] = useTabParam<Tab>(TAB_IDS, 'heart');
  const { state, latest } = useStream(active?.deviceId ?? null);
  const today = useMemo(() => startOfDay(new Date()), []);
  const { points, loading } = useSeries(active?.deviceId ?? null, today, null);
  const [events, setEvents] = useState<StoredEvent[]>([]);

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
  }, [router]);

  useEffect(() => {
    if (!active) return;
    api.events(active.deviceId, 50).then(setEvents).catch(() => setEvents([]));
  }, [active]);

  if (bands !== null && bands.length === 0) {
    return (
      <SectionCard title="Add your band to get started">
        <p className="text-muted">Once the band is added and sending, heart rate, SpO₂ and stress show up here.</p>
        <Link href="/more/devices/" className="btn-primary mt-4 inline-block">
          Add a band
        </Link>
      </SectionCard>
    );
  }

  const live = state === 'live';
  const bpm = live && latest?.ppg.ok && latest.ppg.finger ? Math.round(latest.ppg.bpmAvg || latest.ppg.bpm) || null : null;
  const spo2 = live && latest?.ppg.spo2Valid && latest.ppg.spo2 ? latest.ppg.spo2 : null;
  const stress = live && latest?.gsr.ok ? stressLevel(latest.gsr.raw, latest.gsr.base) : null;
  const bpmPoints = pointsOf(points, 'bpm');
  const spo2Points = pointsOf(points, 'spo2');
  const gsrPoints = pointsOf(points, 'gsr');
  const chartFrom = today.getTime();
  const chartTo = Date.now();
  const empty = loading ? 'Loading…' : undefined;

  return (
    <div className="space-y-4">
      <SegmentedTabs tabs={[...TABS]} active={tab} onChange={setTab} />

      {tab === 'heart' && (
        <>
          <SectionCard
            title="Heart Rate"
            icon={<HeartIcon className="h-5 w-5 text-heart" />}
            action={hrStatus(bpm) && <StatusPill tone={STATUS_TONE[hrStatus(bpm)!]} label={hrStatus(bpm)!} />}
          >
            <p className="tabular text-4xl font-bold">
              {bpm ?? '--'} <span className="text-base font-medium text-muted">BPM</span>
            </p>
            <div className="mt-2">
              <ChartStatsRow values={bpmPoints.map((p) => p.v)} unit="BPM" />
            </div>
            <div className="mt-4">{empty ?? <LineChart points={bpmPoints} tone="heart" from={chartFrom} to={chartTo} label="Heart rate today" />}</div>
            <Link href="/health/heart/" className="mt-4 inline-block text-sm font-medium text-primary">
              View details
            </Link>
          </SectionCard>
          <QuickCheck live={live} latest={latest} />
        </>
      )}

      {tab === 'spo2' && (
        <SectionCard title="SpO₂" icon={<DropIcon className="h-5 w-5 text-oxygen" />} action={spo2 && <StatusPill tone={spo2 >= 95 ? 'good' : spo2 >= 90 ? 'warn' : 'bad'} label={spo2 >= 95 ? 'Normal' : 'Low'} />}>
          <p className="tabular text-4xl font-bold">
            {spo2 ?? '--'}
            <span className="text-base font-medium text-muted">%</span>
          </p>
          <div className="mt-2">
            <ChartStatsRow values={spo2Points.map((p) => p.v)} unit="%" />
          </div>
          <div className="mt-4">{empty ?? <LineChart points={spo2Points} tone="oxygen" from={chartFrom} to={chartTo} min={80} max={100} label="SpO2 today" />}</div>
          <p className="mt-3 text-xs text-muted">Only readings the band marked valid are shown.</p>
        </SectionCard>
      )}

      {tab === 'stress' && (
        <SectionCard title="Stress" icon={<SparkIcon className="h-5 w-5 text-stress" />} action={stress && <StatusPill tone={STATUS_TONE[stress]} label={stress} />}>
          <p className="text-4xl font-bold">{stress ?? '--'}</p>
          <div className="mt-4">{empty ?? <LineChart points={gsrPoints} tone="stress" from={chartFrom} to={chartTo} label="Skin response today" />}</div>
          <p className="mt-3 text-xs text-muted">Skin response (GSR) — an estimate of arousal, not a diagnosis.</p>
        </SectionCard>
      )}

      {tab === 'history' && (
        <>
          <SectionCard title="Recent events">
            <EventList events={events.map((e) => ({ kind: e.kind, value: e.value, at: e.recordedAt, seq: e.seq }))} />
          </SectionCard>
          {active && (
            <section className="card overflow-hidden">
              <ListRow icon={<SparkIcon className="h-5 w-5" />} tone="sleep" title="Full history" subtitle="Every reading and event" href={`/more/history/?id=${active.deviceId}`} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default function HealthPage() {
  return (
    <AppShell title="Health">
      <Suspense fallback={<p className="text-muted">Loading</p>}>
        <HealthView />
      </Suspense>
    </AppShell>
  );
}
