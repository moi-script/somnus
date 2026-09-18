'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { NightSummary, Reading, StoredEvent, TelemetryFrame } from '@lacs/contracts';
import { fmtDuration, nightLabel } from '@/lib/format';
import { api, getToken } from '@/lib/api';
import { useDevice } from '@/lib/useDevice';
import { useStream } from '@/lib/useStream';
import { AppShell } from '@/components/AppShell';
import { HeroMetric, MetricTile, PendingTile } from '@/components/Metrics';
import {
  DropIcon,
  HeartIcon,
  MoonIcon,
  PulseIcon,
  SparkIcon,
  StepsIcon,
  ThermometerIcon,
} from '@/components/Icons';

const CHECK_SECONDS = 15;

interface CheckResult {
  frames: number;
  cleanFrames: number;
  bpm: number | null;
  skinRise: number | null;
  stillness: number;
}

export default function HealthPage() {
  const router = useRouter();
  const { active, bands, room } = useDevice();
  const [lastNight, setLastNight] = useState<NightSummary | null>(null);

  // The newest night with anything in it. Tonight in progress usually has
  // nothing yet, so look one further back too.
  useEffect(() => {
    if (!room) return;
    api
      .nights(room.deviceId, 2)
      .then((nights) => setLastNight(nights.find((n) => n.recorded) ?? null))
      .catch(() => setLastNight(null));
  }, [room]);
  const [seed, setSeed] = useState<TelemetryFrame[]>([]);
  const [events, setEvents] = useState<StoredEvent[]>([]);

  const [checking, setChecking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState<CheckResult | null>(null);
  const captured = useRef<TelemetryFrame[]>([]);

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
  }, [router]);

  useEffect(() => {
    if (!active) return;
    void (async () => {
      const [readings, evts] = await Promise.all([
        api.readings(active.deviceId, 300).catch(() => [] as Reading[]),
        api.events(active.deviceId, 8).catch(() => [] as StoredEvent[]),
      ]);
      setSeed(readings);
      setEvents(evts);
    })();
  }, [active]);

  const { state, latest, history } = useStream(active?.deviceId ?? null, seed);

  useEffect(() => {
    if (checking && latest) captured.current.push(latest);
  }, [checking, latest]);

  const series = useMemo(
    () => ({
      bpm: history.map((f) => f.ppg.bpmAvg || f.ppg.bpm).filter((v) => v > 0),
      skin: history.map((f) => f.gsr.raw),
      motion: history.map((f) => f.imu.mag),
      spo2: history
        .filter((f) => f.ppg.spo2Valid && typeof f.ppg.spo2 === 'number')
        .map((f) => f.ppg.spo2 as number),
      steps: history.flatMap((f) => (f.steps ? [f.steps.count] : [])),
    }),
    [history],
  );

  const runCheck = useCallback(() => {
    captured.current = [];
    setResult(null);
    setChecking(true);
    setSecondsLeft(CHECK_SECONDS);

    const tick = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    setTimeout(() => {
      clearInterval(tick);
      setChecking(false);
      setSecondsLeft(0);

      const frames = captured.current;
      const clean = frames.filter((f) => f.ppg.ok && f.ppg.finger && f.imu.ok && f.gsr.ok);
      const beats = clean.map((f) => f.ppg.bpmAvg || f.ppg.bpm).filter((v) => v > 0);
      const skin = clean.map((f) => f.gsr.raw);
      const motion = clean.map((f) => f.imu.mag);

      setResult({
        frames: frames.length,
        cleanFrames: clean.length,
        bpm: beats.length ? Math.round(beats.reduce((a, b) => a + b, 0) / beats.length) : null,
        skinRise:
          skin.length && clean[0]
            ? Math.round(Math.max(...skin) - (clean[0].gsr.base ?? skin[0]!))
            : null,
        stillness: motion.length
          ? Math.max(...motion.map((m) => Math.abs(m - 1)))
          : 0,
      });
    }, CHECK_SECONDS * 1000);
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const noDevice = bands !== null && bands.length === 0;

  return (
    <AppShell
      title="Health"
      subtitle={today}
      deviceName={active?.name ?? null}
      connected={state === 'live'}
    >
      {noDevice && (
        <section className="card px-6 py-6">
          <h2 className="text-lg font-semibold">Add your band to get started</h2>
          <p className="mt-2 text-muted">
            Switch the node on and read the id from its first line, something
            like lacs-7a3f21. Once it is added, readings show up here.
          </p>
          <Link href="/device/" className="btn-primary mt-4 inline-block">
            Add a band
          </Link>
        </section>
      )}

      {!noDevice && (
        <div className="space-y-4">
          <HeroMetric
            label="Heart rate"
            value={
              latest && latest.ppg.ok && (latest.ppg.bpmAvg || latest.ppg.bpm)
                ? String(Math.round(latest.ppg.bpmAvg || latest.ppg.bpm))
                : '--'
            }
            unit="bpm"
            color="#FF6B8A"
            data={series.bpm}
            minSpan={12}
            icon={<HeartIcon className="h-5 w-5" />}
            note={
              !latest
                ? 'Waiting for the band'
                : !latest.ppg.ok
                  ? 'The pulse sensor is not answering'
                  : !latest.ppg.finger
                    ? 'Rest a finger on the sensor and hold still'
                    : undefined
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <MetricTile
              label="Skin response"
              value={latest?.gsr.ok ? String(latest.gsr.raw) : '--'}
              color="#F5A524"
              icon={<SparkIcon className="h-5 w-5" />}
              data={series.skin}
              minSpan={150}
              note={
                latest?.gsr.ok
                  ? `Settled around ${latest.gsr.base}`
                  : 'The skin sensor is not answering'
              }
            />
            <MetricTile
              label="Movement"
              value={latest?.imu.ok ? latest.imu.mag.toFixed(2) : '--'}
              unit="g"
              color="#2ED3C6"
              icon={<PulseIcon className="h-5 w-5" />}
              data={series.motion}
              minSpan={0.4}
              note={
                latest?.imu.ok
                  ? latest.imu.mag > 1.3
                    ? 'Moving'
                    : 'Still'
                  : 'The motion sensor is not answering'
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {latest?.ppg.spo2Valid === undefined ? (
              <PendingTile
                label="Blood oxygen"
                color="#4C9AFF"
                icon={<DropIcon className="h-5 w-5" />}
                reason="This band's firmware is too old to work it out. Update the band to read it."
              />
            ) : (
              <MetricTile
                label="Blood oxygen"
                value={
                  latest.ppg.spo2Valid && latest.ppg.spo2 ? String(latest.ppg.spo2) : '--'
                }
                unit="%"
                color="#4C9AFF"
                icon={<DropIcon className="h-5 w-5" />}
                data={series.spo2}
                minSpan={6}
                note={
                  latest.ppg.spo2Valid
                    ? undefined
                    : latest.ppg.finger
                      ? 'Working it out. Keep your finger still.'
                      : 'Rest a finger on the sensor'
                }
              />
            )}

            {!latest?.steps ? (
              <PendingTile
                label="Steps"
                color="#7C6CF0"
                icon={<StepsIcon className="h-5 w-5" />}
                reason="This band's firmware is too old to count them. Update the band to see steps."
              />
            ) : (
              <MetricTile
                label="Steps"
                value={latest.steps.count.toLocaleString()}
                color="#7C6CF0"
                icon={<StepsIcon className="h-5 w-5" />}
                data={series.steps}
                note={
                  latest.steps.cadence > 0
                    ? `Walking, ${latest.steps.cadence} a minute`
                    : 'Counted since the band was switched on'
                }
              />
            )}
            {lastNight?.recorded ? (
              <Link href="/sleep/" className="block">
                <MetricTile
                  label="Sleep"
                  value={fmtDuration(lastNight.inRoomMs)}
                  color="#7C6CF0"
                  icon={<MoonIcon className="h-5 w-5" />}
                  note={`in the room, ${nightLabel(lastNight.date).toLowerCase()}`}
                />
              </Link>
            ) : (
              <PendingTile
                label="Sleep"
                color="#7C6CF0"
                icon={<MoonIcon className="h-5 w-5" />}
                reason={
                  room
                    ? 'The room unit has not recorded a night yet. It needs an hour or more of someone in the room between 18:00 and 14:00.'
                    : 'Add the room unit by your bed to see how long you were in the room each night.'
                }
              />
            )}
            <PendingTile
              label="Body temperature"
              color="#FF9A62"
              icon={<ThermometerIcon className="h-5 w-5" />}
              reason="The band can only read the temperature of its own circuit board, which is not your temperature. This needs a sensor that touches skin."
            />
          </div>

          <section className="card px-6 py-6">
            <h2 className="text-lg font-semibold">Quick check</h2>
            <p className="mt-1 text-muted">
              Hold still with a finger on the sensor for {CHECK_SECONDS} seconds
              and the band reports what it managed to read.
            </p>

            <button
              type="button"
              className="btn-primary mt-4"
              onClick={runCheck}
              disabled={checking || state !== 'live'}
            >
              {checking ? `Reading, ${secondsLeft}s left` : 'Start check'}
            </button>

            {state !== 'live' && !checking && (
              <p className="mt-3 text-sm text-muted">
                The band needs to be sending data before a check can run.
              </p>
            )}

            {result && (
              <dl className="mt-5 divide-y divide-line border-t border-line">
                <div className="flex justify-between py-3">
                  <dt className="text-muted">Heart rate</dt>
                  <dd className="tabular font-semibold">
                    {result.bpm ? `${result.bpm} bpm` : 'not enough clean data'}
                  </dd>
                </div>
                <div className="flex justify-between py-3">
                  <dt className="text-muted">Skin response</dt>
                  <dd className="tabular font-semibold">
                    {result.skinRise === null
                      ? 'no reading'
                      : result.skinRise > 250
                        ? `rose ${result.skinRise}`
                        : 'steady'}
                  </dd>
                </div>
                <div className="flex justify-between py-3">
                  <dt className="text-muted">How still you were</dt>
                  <dd className="tabular font-semibold">
                    {result.stillness < 0.15
                      ? 'very still'
                      : result.stillness < 0.5
                        ? 'some movement'
                        : 'too much movement'}
                  </dd>
                </div>
                <div className="flex justify-between py-3">
                  <dt className="text-muted">Usable readings</dt>
                  <dd className="tabular font-semibold">
                    {result.cleanFrames} of {result.frames}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          {events.length > 0 && (
            <section className="card">
              <div className="flex items-baseline justify-between px-6 pt-5">
                <h2 className="text-lg font-semibold">Recent</h2>
                <Link
                  href={`/history/?id=${active?.deviceId ?? ''}`}
                  className="text-sm font-medium text-muted hover:text-ink"
                >
                  See all
                </Link>
              </div>
              <ul className="mt-2 divide-y divide-line">
                {events.slice(0, 5).map((e) => (
                  <li key={e.seq} className="flex items-baseline gap-4 px-6 py-3">
                    <span className="tabular text-sm text-muted">
                      {new Date(e.recordedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="flex-1">
                      {e.kind === 'fall'
                        ? 'A knock or a fall'
                        : e.kind === 'gsr_spike'
                          ? 'Skin response jumped'
                          : 'Finger came off the sensor'}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="pb-3" />
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}
