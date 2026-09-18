'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nightDateFor, type NightSummary } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { useDevice } from '@/lib/useDevice';
import { useRoom } from '@/lib/useRoom';
import { fmtClock, fmtDuration, nightLabel } from '@/lib/format';
import { AppShell } from '@/components/AppShell';
import { MetricTile } from '@/components/Metrics';
import { NightStrips } from '@/components/NightStrips';
import { GROUP_META, LightMix, NightBars } from '@/components/LightMix';
import { RoomNow } from '@/components/RoomNow';
import { BulbIcon, ChevronIcon, MoonIcon, RadarIcon, SparkIcon } from '@/components/Icons';

const SLEEP = '#7C6CF0';
const LIGHT = '#F5A524';

/**
 * The night to open on. Between 14:00 and 18:00 tonight has not started, so
 * that is still last night.
 */
function defaultNight(): string {
  const now = Date.now();
  const tz = new Date().getTimezoneOffset();
  const hour = new Date().getHours();
  if (hour >= 14 && hour < 18) return nightDateFor(now - 5 * 3_600_000, tz);
  return nightDateFor(now, tz);
}

export default function SleepPage() {
  const router = useRouter();
  const { room, active, devices } = useDevice();
  const live = useRoom(room?.deviceId ?? null);
  const [nights, setNights] = useState<NightSummary[] | null>(null);
  const [selected, setSelected] = useState<string>(defaultNight);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
  }, [router]);

  useEffect(() => {
    if (!room) return;
    api
      .nights(room.deviceId, 14)
      .then(setNights)
      .catch((err: Error) => setError(err.message));
  }, [room]);

  const index = nights?.findIndex((n) => n.date === selected) ?? -1;
  const night = index >= 0 ? nights![index]! : null;

  const label = nightLabel(selected);

  const noRoom = devices !== null && !room;

  return (
    <AppShell
      title="Sleep"
      subtitle={room ? label : 'Your room overnight'}
      deviceName={active?.name ?? null}
      connected={active?.online ?? false}
    >
      {noRoom && (
        <section className="card px-6 py-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sleep/15 text-sleep">
            <MoonIcon />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Add the room unit to see your nights</h2>
          <p className="mt-2 text-muted">
            The room unit is the radar by your bed and the bulb it controls. It
            notices when someone is in the room and what the light is doing, so
            each night shows how long you were in the room, how often it
            emptied, and what colour the light was.
          </p>
          <p className="mt-2 text-muted">
            It senses the room, not you, so it cannot tell sleep from lying
            awake.
          </p>
          <Link href="/device/" className="btn-primary mt-5 inline-block">
            Add the room unit
          </Link>
        </section>
      )}

      {room && (
        <div className="space-y-4">
          <RoomNow deviceId={room.deviceId} room={live} />

          <div className="flex items-center justify-between gap-2 pt-2">
            <button
              type="button"
              className="btn px-3"
              aria-label="Earlier night"
              disabled={!nights || index < 0 || index >= nights.length - 1}
              onClick={() => nights && setSelected(nights[index + 1]!.date)}
            >
              <ChevronIcon className="h-5 w-5 rotate-180" />
            </button>
            <h2 className="text-lg font-semibold">{label}</h2>
            <button
              type="button"
              className="btn px-3"
              aria-label="Later night"
              disabled={!nights || index <= 0}
              onClick={() => nights && setSelected(nights[index - 1]!.date)}
            >
              <ChevronIcon className="h-5 w-5" />
            </button>
          </div>

          {error && <p className="rounded-2xl bg-card px-4 py-3 text-sm shadow-soft">{error}</p>}
          {!nights && !error && <section className="card h-48 animate-pulse" />}

          {night && !night.recorded && (
            <section className="rounded-card border border-dashed border-line bg-card/60 px-6 py-8 text-center">
              <p className="text-lg font-semibold text-muted">No night recorded</p>
              <p className="mt-1 text-sm text-muted">
                The room unit saw less than an hour of someone in the room between
                18:00 and 14:00.
              </p>
            </section>
          )}

          {night?.recorded && night.stretch && <Night night={night} />}

          {nights && nights.some((n) => n.recorded) && (
            <section className="card px-6 py-6">
              <h2 className="text-lg font-semibold">Last two weeks</h2>
              <p className="mt-1 text-sm text-muted">
                Height is time in the room. Colour is what the light was doing.
              </p>
              <div className="mt-5">
                <NightBars nights={nights} selected={selected} onSelect={setSelected} />
              </div>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Night({ night }: { night: NightSummary }) {
  const stretch = night.stretch!;
  const { light } = night;
  const sources = Object.entries(light.changes.bySource).filter(([, n]) => n > 0);

  return (
    <>
      <section className="card px-6 py-6">
        <div className="flex items-center gap-2 text-muted">
          <MoonIcon className="h-5 w-5 text-sleep" />
          <span className="font-medium">In the room</span>
        </div>
        <p className="tabular mt-2 text-5xl font-bold leading-none">{fmtDuration(night.inRoomMs)}</p>
        <p className="mt-2 text-sm text-muted">
          {fmtClock(stretch.start)} to {fmtClock(stretch.end)} ·{' '}
          {night.emptiedCount === 0
            ? 'the room never emptied'
            : `the room emptied ${night.emptiedCount === 1 ? 'once' : `${night.emptiedCount} times`}`}
        </p>
        <div className="mt-6">
          <NightStrips night={night} />
        </div>
        {night.coverage < 0.9 && (
          <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
            The room unit was not reporting for {fmtDuration(night.inRoomMs * (1 - night.coverage))}{' '}
            of this night. Those stretches are hatched and left out, not guessed.
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-4">
        <MetricTile
          label="Longest undisturbed"
          value={fmtDuration(night.longestStretchMs)}
          color={SLEEP}
          icon={<RadarIcon className="h-5 w-5" />}
          note="Without the room emptying"
        />
        <MetricTile
          label="Light changes"
          value={String(light.changes.total)}
          color={LIGHT}
          icon={<BulbIcon className="h-5 w-5" />}
          note={
            sources.length === 0
              ? 'It stayed the same all night'
              : sources.map(([s, n]) => `${n} ${SOURCE_LABEL[s] ?? s}`).join(' · ')
          }
        />
        <MetricTile
          label="Consistency"
          value={`${Math.round((light.consistency?.share ?? 0) * 100)}%`}
          color={LIGHT}
          icon={<SparkIcon className="h-5 w-5" />}
          note={
            light.consistency
              ? `${GROUP_META[light.consistency.group].label.toLowerCase()}`
              : undefined
          }
        />
        <MetricTile
          label="Cool and blue light"
          value={light.coolOrBlueMs === 0 ? 'None' : fmtDuration(light.coolOrBlueMs)}
          color="#6C7BFF"
          icon={<BulbIcon className="h-5 w-5" />}
          note={light.coolOrBlueMs === 0 ? 'None this night' : 'Cool white or blue, this night'}
        />
      </div>

      <section className="card px-6 py-6">
        <h2 className="text-lg font-semibold">Light through the night</h2>
        <p className="mt-1 text-sm text-muted">
          {light.onWhilePresentMs > 0
            ? `On for ${fmtDuration(light.onWhilePresentMs)} while someone was in the room, at ${light.avgBrightness}% on average.`
            : 'Off the whole time someone was in the room.'}
        </p>
        <div className="mt-5">
          <LightMix night={night} />
        </div>
      </section>
    </>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  auto: 'by the radar',
  app: 'from the app',
  serial: 'from the computer',
  external: 'from Smart Life',
};
