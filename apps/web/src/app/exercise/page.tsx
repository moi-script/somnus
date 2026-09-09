'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TelemetryFrame } from '@lacs/contracts';
import { useDevice } from '@/lib/useDevice';
import { useStream } from '@/lib/useStream';
import { AppShell } from '@/components/AppShell';
import { Wave } from '@/components/Metrics';
import { HeartIcon, PulseIcon, RunIcon } from '@/components/Icons';

interface Session {
  startedAt: number;
  frames: TelemetryFrame[];
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function ExercisePage() {
  const { active } = useDevice();
  const { state, latest } = useStream(active?.deviceId ?? null);

  const [session, setSession] = useState<Session | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState<Session | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Frames arrive on their own schedule; collect them into the open session.
  useEffect(() => {
    if (!session || !latest) return;
    setSession((s) => (s ? { ...s, frames: [...s.frames, latest] } : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  const start = useCallback(() => {
    setFinished(null);
    setSession({ startedAt: Date.now(), frames: [] });
    setElapsed(0);
    timer.current = setInterval(() => setElapsed(Date.now()), 1000);
  }, []);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setFinished(session);
    setSession(null);
  }, [session]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const live = session;
  const beats = (live ?? finished)?.frames.map((f) => f.ppg.bpmAvg || f.ppg.bpm).filter((v) => v > 0) ?? [];
  const motion = (live ?? finished)?.frames.map((f) => f.imu.mag) ?? [];
  const avgBpm = beats.length ? Math.round(beats.reduce((a, b) => a + b, 0) / beats.length) : null;
  const peakBpm = beats.length ? Math.max(...beats) : null;
  const duration = live ? elapsed - live.startedAt : finished ? finished.frames.length * 200 : 0;

  return (
    <AppShell
      title="Exercise"
      subtitle="Record a session and see what the band picked up"
      deviceName={active?.name ?? null}
      connected={state === 'live'}
    >
      <div className="space-y-4">
        <section className="card px-6 py-7 text-center">
          <div className="flex items-center justify-center gap-2 text-muted">
            <RunIcon className="h-5 w-5 text-motion" />
            <span className="font-medium">Session</span>
          </div>

          <p className="tabular mt-3 text-5xl font-bold leading-none">
            {formatDuration(duration)}
          </p>

          {live ? (
            <>
              <p className="mt-2 text-muted">
                {live.frames.length} readings so far
              </p>
              <button type="button" className="btn mt-5" onClick={stop}>
                Finish
              </button>
            </>
          ) : (
            <>
              <p className="mt-2 text-muted">
                {state === 'live'
                  ? 'Wear the band, then start when you are ready.'
                  : 'Connect the band first and this will wake up.'}
              </p>
              <button
                type="button"
                onClick={start}
                disabled={state !== 'live'}
                className="mt-5 h-24 w-24 rounded-full bg-ink text-xl font-bold text-white transition-transform active:scale-95 disabled:opacity-30"
              >
                GO
              </button>
            </>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="card px-5 pt-5">
            <div className="flex items-center gap-2 text-muted">
              <HeartIcon className="h-5 w-5 text-heart" />
              <span className="text-sm font-medium">Average heart rate</span>
            </div>
            <p className="tabular mt-2 text-3xl font-bold leading-none">
              {avgBpm ?? '--'}
              <span className="ml-1.5 text-sm font-normal text-muted">bpm</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {peakBpm ? `Peaked at ${Math.round(peakBpm)}` : 'No beats recorded yet'}
            </p>
            <div className="mt-3">
              <Wave data={beats} color="#FF6B8A" height={44} minSpan={12} />
            </div>
          </section>

          <section className="card px-5 pt-5">
            <div className="flex items-center gap-2 text-muted">
              <PulseIcon className="h-5 w-5 text-motion" />
              <span className="text-sm font-medium">Movement</span>
            </div>
            <p className="tabular mt-2 text-3xl font-bold leading-none">
              {motion.length ? Math.max(...motion).toFixed(2) : '--'}
              <span className="ml-1.5 text-sm font-normal text-muted">g peak</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {motion.length ? `${motion.length} samples` : 'Nothing recorded yet'}
            </p>
            <div className="mt-3">
              <Wave data={motion} color="#2ED3C6" height={44} minSpan={0.4} />
            </div>
          </section>
        </div>

        <section className="rounded-card border border-dashed border-line bg-card/60 px-6 py-5">
          <h2 className="font-semibold">Calories</h2>
          <p className="mt-1 text-muted">
            Working these out needs step counting on the band and your height
            and weight. Neither is in place, and a number invented without them
            would only look convincing.
          </p>
        </section>

        {finished && (
          <p className="text-center text-sm text-muted">
            This session was not saved. Sessions are kept in memory for now, so
            they disappear when you leave the tab.
          </p>
        )}
      </div>
    </AppShell>
  );
}
