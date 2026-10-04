'use client';

import { useEffect, useState } from 'react';
import type { SeriesPoint } from '@lacs/contracts';
import { api } from './api';

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Five-minute means of the band's readings from `from` to `to` (or now, refreshed each minute). */
export function useSeries(deviceId: string | null, from: Date, to: Date | null) {
  const [points, setPoints] = useState<SeriesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const fromMs = from.getTime();
  const toMs = to?.getTime() ?? null;

  useEffect(() => {
    if (!deviceId) {
      // Nothing to wait for: the chart says there are no readings.
      setPoints([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = () =>
      api
        .readingSeries(deviceId, new Date(fromMs), new Date(toMs ?? Date.now()), 300)
        .then((p) => {
          if (cancelled) return;
          setPoints(p);
          setLoading(false);
        })
        .catch(() => !cancelled && setLoading(false));
    setLoading(true);
    void load();
    if (toMs !== null) return () => void (cancelled = true);
    const every = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(every);
    };
  }, [deviceId, fromMs, toMs]);

  return { points, loading };
}
