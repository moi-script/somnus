'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nightDateFor, type NightSummary } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { useDevice } from '@/lib/useDevice';
import { fmtClock, fmtDuration, nightLabel } from '@/lib/format';
import { AppShell } from '@/components/AppShell';
import { NightStrips } from '@/components/NightStrips';
import { LightMix, NightBars } from '@/components/LightMix';
import { ChevronIcon, ExitIcon, MoonIcon } from '@/components/Icons';
import { consistencyLabel, sleepGoalProgress } from '@/lib/levels';
import { readSleepTarget } from '@/lib/targets';
import { Ring } from '@/components/ui/Ring';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatTile } from '@/components/ui/StatTile';
import { StatusPill } from '@/components/ui/StatusPill';

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
  const [nights, setNights] = useState<NightSummary[] | null>(null);
  const [selected, setSelected] = useState<string>(defaultNight);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState(8);

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
    setGoal(readSleepTarget());
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
  const consistency = consistencyLabel(
    (nights ?? []).filter((n) => n.recorded && n.stretch).map((n) => n.stretch!.start),
  );

  return (
    <AppShell title="Sleep" subtitle={room ? label : 'Your nights'}>
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
          <Link href="/more/devices/room-setup/" className="btn-primary mt-5 inline-block">
            Add the room unit
          </Link>
        </section>
      )}

      {room && (
        <div className="space-y-4">
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

          {night?.recorded && night.stretch && <Night night={night} goal={goal} consistency={consistency} />}

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

function Night({
  night,
  goal,
  consistency,
}: {
  night: NightSummary;
  goal: number;
  consistency: 'Good' | 'Fair' | 'Irregular' | null;
}) {
  const stretch = night.stretch!;
  const progress = sleepGoalProgress(Math.round(night.inRoomMs / 60_000), goal);
  const badgeTone = progress.badge === 'Good' ? 'good' : progress.badge === 'Fair' ? 'warn' : 'bad';

  return (
    <>
      <section className="card px-6 py-6">
        <Ring
          value={progress.fraction}
          tone="good"
          title="Sleep Duration"
          label={fmtDuration(night.inRoomMs)}
          sublabel={`Goal: ${goal}h`}
          badge={<StatusPill tone={badgeTone} label={progress.badge} />}
        />
        <p className="mt-3 text-center text-xs text-muted">Time in the room, from the radar. It cannot tell sleep from lying awake.</p>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <StatTile icon={<MoonIcon className="h-5 w-5" />} tone="sleep" label="Sleep Start" value={fmtClock(stretch.start)} />
        <StatTile icon={<MoonIcon className="h-5 w-5" />} tone="skin" label="Sleep End" value={fmtClock(stretch.end)} />
        <StatTile icon={<MoonIcon className="h-5 w-5" />} tone="good" label="Sleep Consistency" value={consistency ?? '--'} status={consistency ? 'Last two weeks' : 'Needs 3 nights'} statusTone="muted" />
        <StatTile
          icon={<ExitIcon className="h-5 w-5" />}
          tone="heart"
          label="Bed Exits"
          value={night.emptiedCount === 0 ? 'None' : `${night.emptiedCount} ${night.emptiedCount === 1 ? 'time' : 'times'}`}
        />
      </div>

      <SectionCard title="Sleep Timeline">
        <NightStrips night={night} />
        {night.coverage < 0.9 && (
          <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
            The room unit was not reporting for {fmtDuration(night.inRoomMs * (1 - night.coverage))} of this night. Those
            stretches are hatched and left out, not guessed.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Light through the night">
        <p className="-mt-2 mb-4 text-sm text-muted">
          {night.light.onWhilePresentMs > 0
            ? `On for ${fmtDuration(night.light.onWhilePresentMs)} while someone was in the room, at ${night.light.avgBrightness}% on average.`
            : 'Off the whole time someone was in the room.'}
        </p>
        <LightMix night={night} />
      </SectionCard>
    </>
  );
}
