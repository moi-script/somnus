'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import type { Command } from '@lacs/contracts';
import { useDevice } from '@/lib/useDevice';
import { useLightCommand } from '@/lib/useLightCommand';
import { useRoom } from '@/lib/useRoom';
import { useTabParam } from '@/lib/useTabParam';
import { PowerIcon } from '@/components/Icons';
import { SubPage } from '@/components/SubPage';
import { ColorWheel } from '@/components/ui/ColorWheel';
import { SectionCard } from '@/components/ui/SectionCard';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';

type LightCmd = Extract<Command, { cmd: 'light' }>;

const SWATCHES: { label: string; css: string; command: LightCmd }[] = [
  { label: 'Warm night', css: '#FFA957', command: { cmd: 'light', on: true, bright: 15, temp: 0 } },
  { label: 'Reading', css: '#FFECD2', command: { cmd: 'light', on: true, bright: 70, temp: 40 } },
  { label: 'Amber', css: 'hsl(30 100% 50%)', command: { cmd: 'light', on: true, color: { h: 30, s: 100, v: 25 } } },
  { label: 'Red', css: 'hsl(0 100% 50%)', command: { cmd: 'light', on: true, color: { h: 0, s: 100, v: 15 } } },
  { label: 'Blue', css: 'hsl(230 100% 55%)', command: { cmd: 'light', on: true, color: { h: 230, s: 100, v: 30 } } },
];

function LightingView() {
  const { room } = useDevice();
  const live = useRoom(room?.deviceId ?? null);
  const { send, message } = useLightCommand(room?.deviceId ?? null, live.lastAck);
  const [tab, setTab] = useTabParam(['manual', 'adaptive'] as const, 'manual');
  const colour = live.light?.mode === 'colour' ? live.light.color : null;
  const [hue, setHue] = useState(colour?.h ?? 30);
  const [sat, setSat] = useState(colour?.s ?? 100);
  const [bright, setBright] = useState(colour?.v ?? live.light?.bright ?? 50);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the bulb when its state arrives or changes elsewhere.
  useEffect(() => {
    if (!live.light) return;
    if (live.light.mode === 'colour' && live.light.color) {
      setHue(live.light.color.h);
      setSat(live.light.color.s);
      setBright(live.light.color.v);
    } else if (live.light.bright) {
      setBright(live.light.bright);
    }
  }, [live.light]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const sendBrightness = (v: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void send(
        live.light?.mode === 'colour'
          ? { cmd: 'light', on: true, color: { h: hue, s: sat, v } }
          : { cmd: 'light', on: true, bright: v, temp: live.light?.temp ?? 20 },
      );
    }, 500);
  };

  const on = live.light?.on ?? false;

  return (
    <div className="space-y-4">
      <SegmentedTabs
        tabs={[
          { id: 'manual', label: 'Manual' },
          { id: 'adaptive', label: 'Adaptive Radar' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'manual' && (
        <SectionCard>
          <ColorWheel
            hue={hue}
            sat={sat}
            onChange={(h, s) => {
              setHue(h);
              setSat(s);
            }}
            onCommit={(h, s) => void send({ cmd: 'light', on: true, color: { h, s, v: Math.max(1, bright) } })}
          />

          <label className="mt-6 block">
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
                sendBrightness(v);
              }}
              className="mt-2 w-full accent-[rgb(var(--primary))]"
            />
          </label>

          <div className="mt-5 flex justify-between gap-2">
            {SWATCHES.map((s) => (
              <button
                key={s.label}
                type="button"
                aria-label={s.label}
                title={s.label}
                className="h-10 w-10 rounded-full border-2 border-line"
                style={{ background: s.css }}
                onClick={() => void send(s.command)}
              />
            ))}
          </div>

          <button
            type="button"
            className={`mx-auto mt-6 flex items-center gap-2 rounded-pill border px-6 py-3 font-semibold ${
              on ? 'border-good text-good' : 'border-line text-muted'
            }`}
            onClick={() => void send({ cmd: 'light', on: !on })}
          >
            <PowerIcon className="h-5 w-5" />
            {on ? 'Turn Off' : 'Turn On'}
          </button>
        </SectionCard>
      )}

      {tab === 'adaptive' && (
        <SectionCard title="Adaptive Radar Mode">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted">On when someone comes in, off 30 s after the room empties.</p>
            <button
              type="button"
              role="switch"
              aria-checked={live.auto === true}
              aria-label="Adaptive Radar Mode"
              onClick={() => void send({ cmd: 'auto', on: !(live.auto === true) })}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${live.auto ? 'bg-good' : 'bg-line'}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${live.auto ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
          {live.auto === null && <p className="mt-3 text-xs text-muted">Asking the bed unit whether it is on…</p>}
        </SectionCard>
      )}

      {message && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}

export default function LightingPage() {
  return (
    <SubPage title="Lighting Control">
      <Suspense fallback={<p className="text-muted">Loading</p>}>
        <LightingView />
      </Suspense>
    </SubPage>
  );
}
