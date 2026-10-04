'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TelemetryFrame } from '@lacs/contracts';

const CHECK_SECONDS = 15;

interface CheckResult {
  frames: number;
  cleanFrames: number;
  bpm: number | null;
  skinRise: number | null;
  stillness: number;
}

/** Fifteen seconds of holding still, and what the band managed to read. */
export function QuickCheck({ live, latest }: { live: boolean; latest: TelemetryFrame | null }) {
  const [checking, setChecking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState<CheckResult | null>(null);
  const captured = useRef<TelemetryFrame[]>([]);

  useEffect(() => {
    if (checking && latest) captured.current.push(latest);
  }, [checking, latest]);

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
        skinRise: skin.length && clean[0] ? Math.round(Math.max(...skin) - (clean[0].gsr.base ?? skin[0]!)) : null,
        stillness: motion.length ? Math.max(...motion.map((m) => Math.abs(m - 1))) : 0,
      });
    }, CHECK_SECONDS * 1000);
  }, []);

  return (
    <section className="card px-6 py-6">
      <h2 className="text-lg font-semibold">Quick check</h2>
      <p className="mt-1 text-muted">
        Hold still with a finger on the sensor for {CHECK_SECONDS} seconds and the band reports what it managed to read.
      </p>

      <button type="button" className="btn-primary mt-4" onClick={runCheck} disabled={checking || !live}>
        {checking ? `Reading, ${secondsLeft}s left` : 'Start check'}
      </button>

      {!live && !checking && (
        <p className="mt-3 text-sm text-muted">The band needs to be sending data before a check can run.</p>
      )}

      {result && (
        <dl className="mt-5 divide-y divide-line border-t border-line">
          <div className="flex justify-between py-3">
            <dt className="text-muted">Heart rate</dt>
            <dd className="tabular font-semibold">{result.bpm ? `${result.bpm} bpm` : 'not enough clean data'}</dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-muted">Skin response</dt>
            <dd className="tabular font-semibold">
              {result.skinRise === null ? 'no reading' : result.skinRise > 250 ? `rose ${result.skinRise}` : 'steady'}
            </dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-muted">How still you were</dt>
            <dd className="tabular font-semibold">
              {result.stillness < 0.15 ? 'very still' : result.stillness < 0.5 ? 'some movement' : 'too much movement'}
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
  );
}
