'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Device } from '@lacs/contracts';
import { api, getToken } from './api';

const ACTIVE_KEY = 'lacs.activeDevice';

/**
 * The device every tab is looking at.
 *
 * Kept in localStorage rather than the URL so switching tabs does not lose it,
 * and so the app reopens on whatever you were last watching.
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

      const stored = window.localStorage.getItem(ACTIVE_KEY);
      const valid = stored && list.some((d) => d.deviceId === stored) ? stored : null;
      setActiveId(valid ?? list[0]?.deviceId ?? null);
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

  const active = devices?.find((d) => d.deviceId === activeId) ?? null;

  return { devices, active, activeId, select, reload: load, error };
}
