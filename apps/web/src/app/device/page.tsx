'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { MotorPattern } from '@lacs/contracts';
import { api } from '@/lib/api';
import { useDevice } from '@/lib/useDevice';
import { useStream } from '@/lib/useStream';
import { isNative } from '@/lib/platform';
import { AppShell } from '@/components/AppShell';
import { BluetoothIcon, ChevronIcon, ChipIcon, RadarIcon } from '@/components/Icons';

type BuzzPattern = Exclude<MotorPattern, 'idle'>;

const BUZZ: { pattern: BuzzPattern; label: string }[] = [
  { pattern: 'single', label: 'One tap' },
  { pattern: 'double', label: 'Two taps' },
  { pattern: 'long', label: 'Long' },
  { pattern: 'sos', label: 'Alert' },
];

export default function DevicePage() {
  const { bands, room, active, select, reload } = useDevice();
  const { state, latest } = useStream(active?.deviceId ?? null);
  const [native, setNative] = useState(false);

  const [newId, setNewId] = useState('');
  const [claimed, setClaimed] = useState<{ id: string; token: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setNative(isNative()), []);

  const add = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setMessage(null);
      try {
        const res = await api.claim(newId.trim());
        setClaimed({ id: res.device.deviceId, token: res.ingestToken });
        setNewId('');
        await reload();
      } catch (err) {
        setMessage((err as Error).message);
      }
    },
    [newId, reload],
  );

  const buzz = useCallback(
    async (pattern: BuzzPattern) => {
      if (!active) return;
      setBusy(true);
      setMessage(null);
      try {
        await api.queueCommand(active.deviceId, { cmd: 'buzz', pattern });
        setMessage('Sent. The band buzzes the next time your phone passes it along.');
      } catch (err) {
        setMessage((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [active],
  );

  const sensors = [
    { name: 'Pulse sensor', ok: latest?.ppg.ok, colour: 'bg-heart' },
    { name: 'Skin sensor', ok: latest?.gsr.ok, colour: 'bg-skin' },
    { name: 'Motion sensor', ok: latest?.imu.ok, colour: 'bg-motion' },
  ];

  return (
    <AppShell
      title="Device"
      subtitle="Your band, its sensors and how it is connected"
      deviceName={active?.name ?? null}
      connected={state === 'live'}
    >
      <div className="space-y-4">
        <section className="card px-6 py-6">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                state === 'live' ? 'bg-motion/12 text-motion' : 'bg-canvas text-muted'
              }`}
            >
              <BluetoothIcon />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{active?.name ?? 'No band added'}</p>
              <p className="text-sm text-muted">
                {state === 'live'
                  ? 'Sending data now'
                  : active?.lastSeenAt
                    ? `Last heard from ${new Date(active.lastSeenAt).toLocaleString()}`
                    : 'Has not reported yet'}
              </p>
            </div>
          </div>

          {native && (
            <Link href="/node/" className="btn-primary mt-5 inline-block">
              Connect over Bluetooth
            </Link>
          )}
          {!native && (
            <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
              Bluetooth pairing happens in the Android app. In a browser you can
              watch a band that is already sending, but not connect to one.
            </p>
          )}
        </section>

        {active && (
          <section className="card">
            <h2 className="px-6 pt-5 text-lg font-semibold">Sensors</h2>
            <ul className="mt-2 divide-y divide-line">
              {sensors.map((s) => (
                <li key={s.name} className="flex items-center gap-3 px-6 py-4">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${s.ok ? s.colour : 'bg-line'}`}
                  />
                  <span className="flex-1">{s.name}</span>
                  <span className="text-sm text-muted">
                    {s.ok === undefined ? 'no data' : s.ok ? 'working' : 'no answer'}
                  </span>
                </li>
              ))}
            </ul>
            <div className="px-6 pb-5 pt-2 text-sm text-muted">
              {latest?.imu.ok && (
                <p>
                  Circuit board is at {latest.imu.tempC.toFixed(1)} °C. This is the
                  board, not you.
                </p>
              )}
              {active.fw && <p className="mt-1">Firmware {active.fw}</p>}
            </div>
          </section>
        )}

        {active && (
          <section className="card px-6 py-6">
            <h2 className="text-lg font-semibold">Buzz the band</h2>
            <p className="mt-1 text-muted">
              Useful for checking the motor works, or finding the band when you
              have put it down somewhere.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {BUZZ.map(({ pattern, label }) => (
                <button
                  key={pattern}
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void buzz(pattern)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}

        {room && (
          <section className="card px-6 py-6">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                  room.online ? 'bg-sleep/15 text-sleep' : 'bg-canvas text-muted'
                }`}
              >
                <RadarIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{room.name}</p>
                <p className="text-sm text-muted">
                  {room.online
                    ? 'Room unit, reporting over WiFi'
                    : room.lastSeenAt
                      ? `Room unit, last heard from ${new Date(room.lastSeenAt).toLocaleString()}`
                      : 'Room unit, has not reported yet'}
                </p>
              </div>
            </div>
            <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
              The radar and bulb talk to the server over WiFi on their own, so
              no phone is needed. {room.fw && `Firmware ${room.fw}.`}
            </p>
            <Link href="/sleep/" className="btn mt-4 inline-block">
              Light controls and nights
            </Link>
          </section>
        )}

        {bands && bands.length > 1 && (
          <section className="card">
            <h2 className="px-6 pt-5 text-lg font-semibold">Your bands</h2>
            <ul className="mt-2 divide-y divide-line">
              {bands.map((d) => (
                <li key={d.deviceId}>
                  <button
                    type="button"
                    className="row"
                    onClick={() => select(d.deviceId)}
                  >
                    <ChipIcon
                      className={`h-5 w-5 ${
                        d.deviceId === active?.deviceId ? 'text-motion' : 'text-muted'
                      }`}
                    />
                    <span className="flex-1">
                      <span className="block font-medium">{d.name}</span>
                      <span className="text-sm text-muted">{d.deviceId}</span>
                    </span>
                    {d.deviceId === active?.deviceId && (
                      <span className="text-sm text-motion">Selected</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <div className="pb-3" />
          </section>
        )}

        <section className="card px-6 py-6">
          <h2 className="text-lg font-semibold">Add a band or room unit</h2>
          <p className="mt-1 text-muted">
            Switch it on and read the id from its first line of output. Bands
            start with lacs-, the room unit with room-.
          </p>
          <form onSubmit={add} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              className="field sm:flex-1"
              placeholder="lacs-7a3f21 or room-7c1a02"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              aria-label="Device id"
              required
            />
            <button type="submit" className="btn-primary">
              Add
            </button>
          </form>

          {claimed && (
            <div className="mt-5 rounded-2xl bg-canvas px-4 py-4">
              <p className="font-medium">Key for {claimed.id}</p>
              <p className="mt-1 text-sm text-muted">
                {claimed.id.startsWith('room-')
                  ? 'Shown once. Put it in the room unit’s secrets.h as API_DEVICE_TOKEN, then flash it again.'
                  : 'Shown once. The phone app keeps it for you. For the USB bridge, put it in .env as BRIDGE_DEVICE_TOKEN.'}
              </p>
              <code className="mt-3 block break-all rounded-xl bg-card px-3 py-2 text-sm">
                {claimed.token}
              </code>
            </div>
          )}
        </section>

        {message && (
          <p className="rounded-2xl bg-card px-4 py-3 text-sm shadow-soft">{message}</p>
        )}

        {active && (
          <Link
            href={`/history/?id=${active.deviceId}`}
            className="card row rounded-card"
          >
            <span className="flex-1 font-medium">Everything recorded so far</span>
            <ChevronIcon className="h-5 w-5 text-muted" />
          </Link>
        )}
      </div>
    </AppShell>
  );
}
