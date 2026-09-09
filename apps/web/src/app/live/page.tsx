'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Device, MotorPattern, Reading, TelemetryFrame } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { useStream } from '@/lib/useStream';
import { Nav } from '@/components/Nav';
import { StatusBar } from '@/components/StatusBar';
import { ChannelStrip } from '@/components/ChannelStrip';
import { EventList, type TimelineEvent } from '@/components/EventList';

// 'idle' is a reported motor state, not something you can ask for - the
// command contract excludes it.
type BuzzPattern = Exclude<MotorPattern, 'idle'>;
const BUZZ_PATTERNS: BuzzPattern[] = ['single', 'double', 'long', 'sos'];

function LiveView() {
  const router = useRouter();
  const params = useSearchParams();
  const deviceId = params.get('id');

  const [device, setDevice] = useState<Device | null>(null);
  const [seed, setSeed] = useState<TelemetryFrame[]>([]);
  const [storedEvents, setStoredEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [buzzing, setBuzzing] = useState<BuzzPattern | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login/');
      return;
    }
    if (!deviceId) return;

    void (async () => {
      try {
        const [d, readings, events] = await Promise.all([
          api.device(deviceId),
          api.readings(deviceId, 300).catch(() => [] as Reading[]),
          api.events(deviceId, 30).catch(() => []),
        ]);
        setDevice(d);
        setSeed(readings);
        setStoredEvents(
          events.map((e) => ({ kind: e.kind, value: e.value, at: e.recordedAt, seq: e.seq })),
        );
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [deviceId, router]);

  const { state, latest, history, events: liveEvents } = useStream(deviceId, seed);

  const series = useMemo(
    () => ({
      bpm: history.map((f) => f.ppg.bpmAvg || f.ppg.bpm),
      gsr: history.map((f) => f.gsr.raw),
      motion: history.map((f) => f.imu.mag),
    }),
    [history],
  );

  const timeline = useMemo<TimelineEvent[]>(
    () => [
      ...liveEvents.map((e) => ({ kind: e.kind, value: e.value, at: null, seq: e.seq })),
      ...storedEvents,
    ],
    [liveEvents, storedEvents],
  );

  const buzz = useCallback(
    async (pattern: BuzzPattern) => {
      if (!deviceId) return;
      setBuzzing(pattern);
      setError(null);
      try {
        await api.queueCommand(deviceId, { cmd: 'buzz', pattern });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setTimeout(() => setBuzzing(null), 800);
      }
    },
    [deviceId],
  );

  if (!deviceId) {
    return (
      <p className="text-muted">
        No device selected. <Link href="/devices/" className="text-motion">Pick one</Link>.
      </p>
    );
  }

  return (
    <main>
      <StatusBar
        deviceId={deviceId}
        deviceName={device?.name ?? deviceId}
        state={state}
        latest={latest}
        fw={device?.fw ?? null}
      />

      <div className="mt-2">
        <ChannelStrip
          name="Pulse"
          unit="bpm"
          value={latest ? latest.ppg.bpmAvg || latest.ppg.bpm : null}
          data={series.bpm}
          color="#FF5470"
          minSpan={12}
          offline={latest ? !latest.ppg.ok : false}
          note={
            latest && latest.ppg.ok && !latest.ppg.finger
              ? 'No finger on the sensor'
              : undefined
          }
        />
        <ChannelStrip
          name="Skin"
          unit="counts"
          value={latest ? latest.gsr.raw : null}
          data={series.gsr}
          color="#FFC24B"
          minSpan={150}
          offline={latest ? !latest.gsr.ok : false}
          note={latest?.gsr.ok ? `Baseline ${latest.gsr.base}` : undefined}
        />
        <ChannelStrip
          name="Motion"
          unit="g"
          precision={2}
          value={latest ? latest.imu.mag : null}
          data={series.motion}
          color="#4FD6C8"
          minSpan={0.4}
          offline={latest ? !latest.imu.ok : false}
          note={latest?.imu.ok ? `${latest.imu.tempC.toFixed(1)} °C on the board` : undefined}
        />
      </div>

      <section className="mt-8">
        <h2 className="font-medium">Buzz the node</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Queued for the bridge to deliver. The node vibrates when the phone or
          the USB bridge next drains the queue.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {BUZZ_PATTERNS.map((pattern) => (
            <button
              key={pattern}
              type="button"
              className="btn"
              disabled={buzzing !== null}
              onClick={() => void buzz(pattern)}
            >
              {buzzing === pattern ? 'Queued' : pattern}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between border-b border-rule pb-2">
          <h2 className="font-medium">Events</h2>
          <Link href={`/history/?id=${deviceId}`} className="text-sm text-muted hover:text-ink">
            Full history
          </Link>
        </div>
        <EventList events={timeline} />
      </section>

      {error && (
        <p className="mt-6 rounded border border-alarm/40 bg-alarm/10 px-3 py-2 text-sm text-alarm">
          {error}
        </p>
      )}
    </main>
  );
}

export default function LivePage() {
  return (
    <>
      <Nav />
      {/* useSearchParams needs a boundary when the page is statically exported. */}
      <Suspense fallback={<p className="text-muted">Loading</p>}>
        <LiveView />
      </Suspense>
    </>
  );
}
