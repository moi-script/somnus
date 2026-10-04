'use client';

import { useEffect, useState } from 'react';
import { presenceSegments, toPresencePoints, type PresenceSegment, type RoomPresence } from '@lacs/contracts';
import { UNKNOWN_FILL } from '@/components/LightMix';
import { api } from './api';

export const PRESENCE_KINDS = {
  present: { label: 'In bed', fill: 'rgb(var(--sleep))' },
  empty: { label: 'Empty', fill: 'rgb(var(--line))' },
  none: { label: 'No data', fill: UNKNOWN_FILL },
};

/**
 * Presence over the last `minutes`. Refetched when the radar's live state
 * changes (so a change shows within a second) and every 30 s; the window
 * itself slides every 15 s.
 */
export function useRoomPresence(deviceId: string | null, minutes: 60 | 360 | 1440, present: boolean | null) {
  const [data, setData] = useState<RoomPresence | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    const load = () =>
      api
        .roomPresence(deviceId, minutes)
        .then((r) => !cancelled && setData(r))
        .catch(() => undefined);
    void load();
    const every = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(every);
    };
  }, [deviceId, minutes, present]);

  const to = now;
  const from = now - minutes * 60_000;
  const segments: PresenceSegment[] = data ? presenceSegments({ ...toPresencePoints(data), from, to, now }) : [];
  return { segments, from, to, loading: data === null };
}
