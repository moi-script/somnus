'use client';

import { useEffect, useRef, useState } from 'react';
import type { EventFrame, Frame, TelemetryFrame } from '@lacs/contracts';
import { streamUrl } from './api';

export type StreamState = 'connecting' | 'live' | 'offline';

/** Roughly a minute of trace at 5 Hz - enough to see a pattern, cheap to keep. */
const HISTORY = 300;

interface StreamData {
  state: StreamState;
  latest: TelemetryFrame | null;
  history: TelemetryFrame[];
  events: EventFrame[];
}

/**
 * Live telemetry over SSE.
 *
 * The browser reconnects EventSource on its own, so this does not retry by
 * hand; it only reports the state so the UI can say what is happening rather
 * than silently showing stale numbers.
 */
export function useStream(deviceId: string | null, seed: TelemetryFrame[] = []): StreamData {
  const [state, setState] = useState<StreamState>('connecting');
  const [latest, setLatest] = useState<TelemetryFrame | null>(null);
  const [history, setHistory] = useState<TelemetryFrame[]>([]);
  const [events, setEvents] = useState<EventFrame[]>([]);
  const seeded = useRef(false);

  // Seed the trace from stored readings so the chart is not empty for the
  // first few seconds after a page load.
  useEffect(() => {
    if (seeded.current || seed.length === 0) return;
    seeded.current = true;
    setHistory(seed.slice(-HISTORY));
    setLatest(seed[seed.length - 1] ?? null);
  }, [seed]);

  useEffect(() => {
    if (!deviceId) return;

    const source = new EventSource(streamUrl(deviceId));

    source.onopen = () => setState('live');
    source.onerror = () => setState('offline');

    source.addEventListener('telemetry', (e) => {
      setState('live');
      const frame = JSON.parse((e as MessageEvent).data) as Frame;
      if (frame.t !== 'telemetry') return;
      setLatest(frame);
      setHistory((prev) => [...prev, frame].slice(-HISTORY));
    });

    source.addEventListener('event', (e) => {
      const frame = JSON.parse((e as MessageEvent).data) as Frame;
      if (frame.t !== 'event') return;
      setEvents((prev) => [frame, ...prev].slice(0, 50));
    });

    return () => source.close();
  }, [deviceId]);

  return { state, latest, history, events };
}
