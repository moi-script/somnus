'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { lightCss, type Command } from '@lacs/contracts';
import { api } from '@/lib/api';
import { fmtAgo } from '@/lib/format';
import type { RoomData } from '@/lib/useRoom';
import { BulbIcon, RadarIcon } from './Icons';
import { GROUP_META, Swatch } from './LightMix';

type LightCmd = Extract<Command, { cmd: 'light' }>;

const PRESETS: { label: string; command: LightCmd }[] = [
  { label: 'Warm night', command: { cmd: 'light', on: true, bright: 15, temp: 0 } },
  { label: 'Reading', command: { cmd: 'light', on: true, bright: 70, temp: 40 } },
  { label: 'Amber', command: { cmd: 'light', on: true, color: { h: 30, s: 100, v: 25 } } },
  { label: 'Red', command: { cmd: 'light', on: true, color: { h: 0, s: 100, v: 15 } } },
  { label: 'Off', command: { cmd: 'light', on: false } },
];

/** The room unit polls every 5 s; well past that and it is probably offline. */
const ANSWER_TIMEOUT_MS = 30_000;

/**
 * What the room looks like this minute, and the controls for its light.
 *
 * Commands go through the same queue as the band's; the room unit collects
 * them over WiFi and answers with an ack frame, which is what flips the
 * message from "sent" to "done".
 */
export function RoomNow({ deviceId, room }: { deviceId: string; room: RoomData }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<{ cmd: string; since: number } | null>(null);
  const asked = useRef(false);

  const send = useCallback(
    async (command: Command) => {
      setMessage('Sent, waiting for the room unit…');
      const since = Date.now();
      pending.current = { cmd: command.cmd, since };
      try {
        await api.queueCommand(deviceId, command);
      } catch (err) {
        pending.current = null;
        setMessage((err as Error).message);
        return;
      }
      setTimeout(() => {
        if (pending.current?.since === since) {
          pending.current = null;
          setMessage(
            'No answer yet. The room unit checks for commands every few seconds, so it may be offline.',
          );
        }
      }, ANSWER_TIMEOUT_MS);
    },
    [deviceId],
  );

  useEffect(() => {
    const ack = room.lastAck;
    const waiting = pending.current;
    if (!ack || !waiting || ack.cmd !== waiting.cmd || ack.at < waiting.since) return;
    pending.current = null;
    setMessage(ack.ok ? 'Done.' : `The room unit could not do that${ack.detail ? `: ${ack.detail}` : '.'}`);
  }, [room.lastAck]);

  // Auto mode is only reported in status frames. Ask once, quietly.
  useEffect(() => {
    if (asked.current || !room.online || room.auto !== null) return;
    asked.current = true;
    void api.queueCommand(deviceId, { cmd: 'status' }).catch(() => undefined);
  }, [deviceId, room.online, room.auto]);

  const light = room.light;
  const css = lightCss(light);
  const brightness = light?.on
    ? light.mode === 'colour'
      ? (light.color?.v ?? 100)
      : (light.bright ?? 100)
    : null;

  return (
    <section className="card px-6 py-6">
      <div className="flex items-start gap-4">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
            room.online && room.present ? 'bg-sleep/15 text-sleep' : 'bg-canvas text-muted'
          }`}
        >
          <RadarIcon />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {!room.online
              ? room.lastHeardAt
                ? 'Room unit is offline'
                : 'Waiting for the room unit'
              : room.present
                ? "Someone's in the room"
                : 'The room is empty'}
          </p>
          <p className="text-sm text-muted">
            {room.lastHeardAt
              ? room.online
                ? 'Live from the radar'
                : `Last heard ${fmtAgo(room.lastHeardAt)}`
              : 'It has not reported yet. Check its WiFi and key.'}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-2xl bg-canvas px-4 py-3">
        <Swatch
          className="h-8 w-8"
          fill={css ?? GROUP_META.off.color}
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {!light ? 'Light state unknown' : light.on ? describe(light) : 'Light is off'}
          </p>
          <p className="text-sm text-muted">
            {brightness !== null && `${brightness}% · `}
            {room.auto === null ? 'Radar control unknown' : room.auto ? 'Radar is switching it' : 'Radar control is off'}
          </p>
        </div>
        <button
          type="button"
          className="btn inline-flex shrink-0 items-center px-4"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <BulbIcon className="h-5 w-5" />
          <span className="ml-1.5">{open ? 'Close' : 'Light'}</span>
        </button>
      </div>

      {open && (
        <LightControls
          key={light?.at ?? 0}
          light={light}
          auto={room.auto}
          onSend={(c) => void send(c)}
        />
      )}

      {message && <p className="mt-4 text-sm text-muted">{message}</p>}
    </section>
  );
}

function describe(light: NonNullable<RoomData['light']>): string {
  if (light.mode === 'colour') {
    const h = light.color?.h ?? 0;
    if (h <= 45 || h >= 330) return 'Red or amber light';
    if (h >= 75 && h <= 165) return 'Green light';
    if (h >= 180 && h <= 300) return 'Blue or violet light';
    return 'Coloured light';
  }
  const t = light.temp ?? 0;
  return t <= 30 ? 'Warm white light' : t >= 70 ? 'Cool white light' : 'Neutral white light';
}

function LightControls({
  light,
  auto,
  onSend,
}: {
  light: RoomData['light'];
  auto: boolean | null;
  onSend: (command: Command) => void;
}) {
  const white = light?.mode === 'white';
  const [bright, setBright] = useState(white ? (light?.bright ?? 50) : 50);
  const [temp, setTemp] = useState(white ? (light?.temp ?? 20) : 20);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sliders send once they settle, not on every pixel of a drag.
  const commit = (next: { bright: number; temp: number }) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => onSend({ cmd: 'light', on: true, bright: next.bright, temp: next.temp }),
      500,
    );
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="mt-5 space-y-5 border-t border-line pt-5">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="btn" onClick={() => onSend(p.command)}>
            {p.label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="flex justify-between text-sm font-medium">
          Brightness <span className="tabular text-muted">{bright}%</span>
        </span>
        <input
          type="range"
          min={1}
          max={100}
          value={bright}
          onChange={(e) => {
            const v = Number(e.target.value);
            setBright(v);
            commit({ bright: v, temp });
          }}
          className="mt-2 w-full accent-[rgb(var(--sleep))]"
        />
      </label>

      <label className="block">
        <span className="flex justify-between text-sm font-medium">
          Warm to cool <span className="tabular text-muted">{temp}</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={temp}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTemp(v);
            commit({ bright, temp: v });
          }}
          className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-pill"
          style={{ background: 'linear-gradient(90deg, #FFA957, #FFECD2, #D2E4FF)' }}
        />
      </label>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Radar controls the light</p>
          <p className="text-sm text-muted">On when someone comes in, off 30 s after the room empties.</p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-pill bg-canvas p-1">
          {[true, false].map((on) => (
            <button
              key={String(on)}
              type="button"
              aria-pressed={auto === on}
              onClick={() => onSend({ cmd: 'auto', on })}
              className={`rounded-pill px-3 py-1.5 text-sm font-medium ${
                auto === on ? 'bg-card text-ink shadow-soft' : 'text-muted'
              }`}
            >
              {on ? 'On' : 'Off'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
