'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { lightCss, nightDateFor, nightWindow, presenceSummary } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { fmtClock, fmtDuration } from '@/lib/format';
import { bedExitLabel, presenceLine } from '@/lib/bedText';
import { lightModeOf } from '@/lib/lightControl';
import { movementLevel } from '@/lib/levels';
import { useDevice } from '@/lib/useDevice';
import { useLightCommand } from '@/lib/useLightCommand';
import { useRoom } from '@/lib/useRoom';
import { PRESENCE_KINDS, useRoomPresence } from '@/lib/useRoomPresence';
import { useStream } from '@/lib/useStream';
import { AppShell } from '@/components/AppShell';
import { BedIcon, BulbIcon, ExitIcon, RadarIcon, WalkIcon } from '@/components/Icons';
import { GROUP_META, Swatch } from '@/components/LightMix';
import { ListRow } from '@/components/ui/ListRow';
import { SectionCard } from '@/components/ui/SectionCard';
import { SegmentedTabs, SegmentedToggle } from '@/components/ui/SegmentedTabs';
import { StatTile } from '@/components/ui/StatTile';
import { StatusPill } from '@/components/ui/StatusPill';
import { TimelineStrip } from '@/components/ui/TimelineStrip';

const WINDOWS = [
  { id: '60', label: '1 h' },
  { id: '360', label: '6 h' },
  { id: '1440', label: '24 h' },
] as const;

export default function BedPage() {
  const router = useRouter();
  const { room, active, devices } = useDevice();
  const live = useRoom(room?.deviceId ?? null);
  const { state, history } = useStream(active?.deviceId ?? null);
  const [win, setWin] = useState<'60' | '360' | '1440'>('60');
  const graph = useRoomPresence(room?.deviceId ?? null, Number(win) as 60 | 360 | 1440, live.present);
  const day = useRoomPresence(room?.deviceId ?? null, 1440, live.present);
  const light = useLightCommand(room?.deviceId ?? null, live.lastAck);
  const asked = useRef(false);

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
  }, [router]);

  // Auto mode is only reported in status frames. Ask once, quietly.
  useEffect(() => {
    if (!room || asked.current || !live.online || live.auto !== null) return;
    asked.current = true;
    void api.queueCommand(room.deviceId, { cmd: 'status' }).catch(() => undefined);
  }, [room, live.online, live.auto]);

  const summary = presenceSummary(graph.segments);
  const tz = new Date().getTimezoneOffset();
  const tonight = nightWindow(nightDateFor(Date.now(), tz), tz);
  const lastExit = presenceSummary(day.segments).lastExitAt;
  const bandLive = state === 'live';
  const movement = useMemo(
    () => (bandLive ? movementLevel(history.slice(-50).filter((f) => f.imu.ok).map((f) => f.imu.mag)) : null),
    [bandLive, history],
  );
  const css = lightCss(live.light);
  const brightness = live.light?.on ? (live.light.mode === 'colour' ? live.light.color?.v ?? 100 : live.light.bright ?? 100) : null;

  if (devices !== null && !room) {
    return (
      <AppShell title="Bed">
        <SectionCard title="Add the bed unit">
          <p className="text-muted">The bed unit is the radar by your bed and the bulb it controls. Set it up from the app over Bluetooth.</p>
          <Link href="/more/devices/room-setup/" className="btn-primary mt-4 inline-block">
            Set up the bed unit
          </Link>
        </SectionCard>
      </AppShell>
    );
  }

  // A unit that has stopped reporting cannot say who is in bed now.
  const present = live.online ? live.present : null;
  return (
    <AppShell title="Bed" action={<StatusPill tone={live.online ? 'good' : 'idle'} label={live.online ? 'Connected' : 'Offline'} />}>
      <div className="space-y-4">
        <SectionCard title="Bed Unit Status">
          <div className="grid grid-cols-2 gap-3">
            <StatTile stacked icon={<BedIcon className="h-5 w-5" />} tone="good" label="Occupancy" value={present === null ? '--' : present ? 'Occupied' : 'Empty'} />
            <StatTile stacked icon={<RadarIcon className="h-5 w-5" />} tone="primary" label="Presence" value={present === null ? '--' : present ? 'Detected' : 'Not detected'} />
            <StatTile stacked icon={<ExitIcon className="h-5 w-5" />} tone="heart" label="Bed Exit" value={bedExitLabel(day.loading, lastExit, tonight.start)} />
            {movement && <StatTile stacked icon={<WalkIcon className="h-5 w-5" />} tone="motion" label="Movement" value={movement} status="from wristband" statusTone="muted" />}
          </div>
        </SectionCard>

        <SectionCard title="Presence" action={<div className="w-40"><SegmentedTabs tabs={[...WINDOWS]} active={win} onChange={setWin} /></div>}>
          <TimelineStrip segments={graph.segments} kinds={PRESENCE_KINDS} from={graph.from} to={graph.to} />
          <p className="mt-3 text-sm text-muted">
            {presenceLine(graph.loading, summary, WINDOWS.find((w) => w.id === win)!.label)}
          </p>
        </SectionCard>

        <section className="card overflow-hidden">
          <h2 className="px-5 pt-5 font-semibold">Radar Monitoring</h2>
          <div className="mt-2">
            <ListRow
              icon={<BedIcon className="h-5 w-5" />}
              tone="good"
              title="Presence / Occupancy"
              subtitle={present === null ? (live.online ? 'Waiting for the radar' : 'Bed unit offline') : present ? 'Person in bed' : 'No one in bed'}
            />
          </div>
        </section>

        <SectionCard title="Smart Lighting" action={<Link href="/bed/lighting/" className="text-sm font-medium text-primary">Lighting control</Link>}>
          <div className="flex items-center gap-3">
            <Swatch className="h-9 w-9" fill={css ?? GROUP_META.off.color} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{!live.light ? 'Light state unknown' : live.light.on ? 'Light is on' : 'Light is off'}</p>
              {brightness !== null && <p className="text-sm text-muted">{brightness}%</p>}
            </div>
            <BulbIcon className="h-5 w-5 text-skin" />
          </div>
          <p className="mb-2 mt-4 text-sm text-muted">Lighting Mode</p>
          <SegmentedToggle
            tabs={[
              { id: 'manual', label: 'Manual' },
              { id: 'adaptive', label: 'Adaptive Radar' },
            ]}
            active={lightModeOf(live.online, live.auto)}
            onChange={(id) => live.online && void light.send({ cmd: 'auto', on: id === 'adaptive' })}
          />
          {light.message && <p className="mt-3 text-sm text-muted">{light.message}</p>}
        </SectionCard>
      </div>
    </AppShell>
  );
}
