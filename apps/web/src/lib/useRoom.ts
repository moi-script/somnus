'use client';

import { useEffect, useState } from 'react';
import type { Frame, LightSource, LightState } from '@lacs/contracts';
import { api, streamUrl } from './api';

/** The unit sends a presence heartbeat every 60 s; past this it is offline. */
const ONLINE_MS = 90_000;

export type RoomLight = LightState & { source: LightSource; at: number };

export interface RoomAck {
  cmd: string;
  ok: boolean;
  detail: string | null;
  at: number;
}

export interface RoomData {
  /** Heard from within the last 90 s. */
  online: boolean;
  /** null until the unit has ever reported presence. */
  present: boolean | null;
  lastHeardAt: number | null;
  light: RoomLight | null;
  lastAck: RoomAck | null;
  /** Radar switching the light. null until a status frame has said. */
  auto: boolean | null;
}

/**
 * What the room unit sees right now.
 *
 * Seeded from the newest stored frames so the card is not blank for the
 * minute before the next heartbeat, then kept current over SSE.
 */
export function useRoom(deviceId: string | null): RoomData {
  const [present, setPresent] = useState<boolean | null>(null);
  const [lastHeardAt, setLastHeardAt] = useState<number | null>(null);
  const [light, setLight] = useState<RoomLight | null>(null);
  const [lastAck, setLastAck] = useState<RoomAck | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Re-evaluate "online" as time passes, even when nothing arrives.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;

    void api
      .roomLatest(deviceId)
      .then((latest) => {
        if (cancelled) return;
        if (latest.presence) {
          setPresent(latest.presence.present);
          setLastHeardAt(Date.parse(latest.presence.at));
        }
        if (latest.light) {
          const at = Date.parse(latest.light.at);
          setLight({ ...latest.light.state, source: latest.light.source, at });
          setLastHeardAt((prev) => Math.max(prev ?? 0, at));
        }
      })
      .catch(() => undefined);

    const source = new EventSource(streamUrl(deviceId));
    const read = (e: Event) => JSON.parse((e as MessageEvent).data) as Frame;
    const heard = () => {
      const t = Date.now();
      setLastHeardAt(t);
      setNow(t);
    };

    source.addEventListener('presence', (e) => {
      const frame = read(e);
      if (frame.t !== 'presence') return;
      heard();
      setPresent(frame.present);
    });

    source.addEventListener('light', (e) => {
      const frame = read(e);
      if (frame.t !== 'light') return;
      heard();
      const { on, mode, bright, temp, color, source: by } = frame;
      setLight({ on, mode, bright, temp, color, source: by, at: Date.now() });
    });

    source.addEventListener('ack', (e) => {
      const frame = read(e);
      if (frame.t !== 'ack') return;
      heard();
      setLastAck({ cmd: frame.cmd, ok: frame.ok, detail: frame.detail ?? null, at: Date.now() });
    });

    source.addEventListener('status', (e) => {
      const frame = read(e);
      if (frame.t !== 'status') return;
      heard();
      if ('auto' in frame.config) setAuto(frame.config.auto);
    });

    return () => {
      cancelled = true;
      source.close();
    };
  }, [deviceId]);

  return {
    online: lastHeardAt !== null && now - lastHeardAt < ONLINE_MS,
    present,
    lastHeardAt,
    light,
    lastAck,
    auto,
  };
}
