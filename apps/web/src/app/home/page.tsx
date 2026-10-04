'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { NightSummary } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { fmtDuration } from '@/lib/format';
import { greeting, hrStatus, movementLevel, sleepGoalProgress, stressLevel } from '@/lib/levels';
import { readSleepTarget } from '@/lib/targets';
import { useDevice } from '@/lib/useDevice';
import { useLightCommand } from '@/lib/useLightCommand';
import { useRoom } from '@/lib/useRoom';
import { PRESENCE_KINDS, useRoomPresence } from '@/lib/useRoomPresence';
import { useStream } from '@/lib/useStream';
import { AppShell } from '@/components/AppShell';
import { BedIcon, BulbIcon, DropIcon, HeartIcon, MoonIcon, SparkIcon, WalkIcon, BluetoothIcon } from '@/components/Icons';
import { IconDisc } from '@/components/ui/IconDisc';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatTile } from '@/components/ui/StatTile';
import { StatusPill } from '@/components/ui/StatusPill';
import { TimelineStrip } from '@/components/ui/TimelineStrip';

export default function HomePage() {
  const router = useRouter();
  const { active, room } = useDevice();
  const live = useRoom(room?.deviceId ?? null);
  const { state, latest, history } = useStream(active?.deviceId ?? null);
  const presence = useRoomPresence(room?.deviceId ?? null, 360, live.present);
  const light = useLightCommand(room?.deviceId ?? null, live.lastAck);
  const [nights, setNights] = useState<NightSummary[] | null>(null);
  const [goal, setGoal] = useState(8);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
    setGoal(readSleepTarget());
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, [router]);

  useEffect(() => {
    if (!room) return;
    api.nights(room.deviceId, 2).then(setNights).catch(() => setNights([]));
  }, [room]);

  const bandLive = state === 'live' && latest !== null;
  const bpm = bandLive && latest.ppg.ok && latest.ppg.finger ? Math.round(latest.ppg.bpmAvg || latest.ppg.bpm) : null;
  const spo2 = bandLive && latest.ppg.spo2Valid && latest.ppg.spo2 ? latest.ppg.spo2 : null;
  const stress = bandLive && latest.gsr.ok ? stressLevel(latest.gsr.raw, latest.gsr.base) : null;
  const movement = useMemo(
    () => (bandLive ? movementLevel(history.slice(-50).filter((f) => f.imu.ok).map((f) => f.imu.mag)) : null),
    [bandLive, history],
  );

  // Tonight while someone is in the room, otherwise the newest recorded night.
  const tonight = nights?.[0];
  const sleeping = live.present === true && tonight?.stretch;
  const shown = sleeping ? tonight : nights?.find((n) => n.recorded);
  const minutes = shown ? Math.round(shown.inRoomMs / 60_000) : 0;
  const progress = sleepGoalProgress(minutes, goal);

  const fourHoursAgo = presence.to - 4 * 3_600_000;
  const lastFour = presence.segments
    .filter((s) => s.to > fourHoursAgo)
    .map((s) => ({ ...s, from: Math.max(s.from, fourHoursAgo) }));

  return (
    <AppShell
      title={greeting(now)}
      subtitle={now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Link href="/sleep/" className="card block p-4">
            <IconDisc icon={<MoonIcon className="h-5 w-5" />} tone="sleep" />
            <p className="mt-3 text-xs text-muted">{sleeping ? 'Sleeping' : 'Last night'}</p>
            <p className="tabular text-2xl font-bold">{shown ? fmtDuration(shown.inRoomMs) : '--'}</p>
            {shown && <p className="text-xs text-muted">Sleep quality: <span className="font-semibold text-good">{progress.badge}</span></p>}
          </Link>
          <Link href="/bed/" className="card block p-4">
            <IconDisc icon={<BedIcon className="h-5 w-5" />} tone="good" />
            <p className="mt-3 text-xs text-muted">Bed status</p>
            <p className="text-2xl font-bold">
              {!room ? '--' : !live.online ? 'Offline' : live.present ? 'Occupied' : 'Empty'}
            </p>
          </Link>
        </div>

        <div className="card grid grid-cols-2 divide-x divide-line">
          <div className="flex items-center gap-3 p-4">
            <BluetoothIcon className={`h-5 w-5 ${bandLive ? 'text-good' : 'text-muted'}`} />
            <div>
              <p className="text-sm font-medium">Wristband</p>
              <StatusPill tone={bandLive ? 'good' : 'idle'} label={active ? (bandLive ? 'Connected' : 'Not sending') : 'Not added'} />
            </div>
          </div>
          <div className="flex items-center gap-3 p-4">
            <BedIcon className={`h-5 w-5 ${live.online ? 'text-good' : 'text-muted'}`} />
            <div>
              <p className="text-sm font-medium">Bed Unit</p>
              <StatusPill tone={live.online ? 'good' : 'idle'} label={room ? (live.online ? 'Connected' : 'Offline') : 'Not added'} />
            </div>
          </div>
        </div>

        <h2 className="pt-2 font-semibold">Live Health</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatTile icon={<HeartIcon className="h-5 w-5" />} tone="heart" label="Heart Rate" value={bpm ? String(bpm) : '--'} unit={bpm ? 'BPM' : undefined} status={hrStatus(bpm)} />
          <StatTile icon={<DropIcon className="h-5 w-5" />} tone="oxygen" label="SpO₂" value={spo2 ? `${spo2}%` : '--'} />
          <StatTile icon={<SparkIcon className="h-5 w-5" />} tone="stress" label="Stress" value={stress ?? '--'} />
          <StatTile icon={<WalkIcon className="h-5 w-5" />} tone="motion" label="Movement" value={movement ?? '--'} />
        </div>

        {room && (
          <SectionCard title="Sleep Activity" action={<span className="text-xs text-muted">Last 4 hours</span>}>
            <TimelineStrip segments={lastFour} kinds={PRESENCE_KINDS} from={fourHoursAgo} to={presence.to} />
          </SectionCard>
        )}

        {room && (
          <>
            <h2 className="pt-2 font-semibold">Quick Controls</h2>
            <div className="grid grid-cols-3 gap-4">
              <button
                type="button"
                className="card flex flex-col items-center gap-2 p-4"
                disabled={!live.online}
                onClick={() => void light.send({ cmd: 'light', on: !(live.light?.on ?? false) })}
              >
                <IconDisc icon={<BulbIcon className="h-5 w-5" />} tone="skin" />
                <span className="text-sm font-medium">Light</span>
                <span className={`text-xs font-semibold ${live.light?.on ? 'text-good' : 'text-muted'}`}>
                  {live.light ? (live.light.on ? 'ON' : 'OFF') : '--'}
                </span>
              </button>
            </div>
            {light.message && <p className="text-sm text-muted">{light.message}</p>}
          </>
        )}
      </div>
    </AppShell>
  );
}
