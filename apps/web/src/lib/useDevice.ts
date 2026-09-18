'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Device } from '@lacs/contracts';
import { api, getToken } from './api';

const ACTIVE_KEY = 'lacs.activeDevice';

/**
 * The band every tab is looking at, and the room unit if there is one.
 *
 * `active` is only ever a band. Health, Exercise and the rest read heart rate
 * and motion from it, and a room unit has neither - so the two kinds are kept
 * apart here rather than every page having to check.
 *
 * The selection is kept in localStorage rather than the URL so switching tabs
 * does not lose it, and so the app reopens on whatever you were last watching.
 */
export function useDevice() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!getToken()) return;
    try {
      const list = await api.devices();
      setDevices(list);

      const bands = list.filter((d) => d.kind === 'band');
      const stored = window.localStorage.getItem(ACTIVE_KEY);
      const valid = stored && bands.some((d) => d.deviceId === stored) ? stored : null;
      setActiveId(valid ?? bands[0]?.deviceId ?? null);
    } catch (err) {
      setError((err as Error).message);
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const select = useCallback((deviceId: string) => {
    window.localStorage.setItem(ACTIVE_KEY, deviceId);
    setActiveId(deviceId);
  }, []);

  const bands = useMemo(() => devices?.filter((d) => d.kind === 'band') ?? null, [devices]);
  const room = devices?.find((d) => d.kind === 'room') ?? null;
  const active = bands?.find((d) => d.deviceId === activeId) ?? null;

  return { devices, bands, room, active, activeId, select, reload: load, error };
}
