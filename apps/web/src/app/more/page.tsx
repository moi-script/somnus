'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';
import { useDevice } from '@/lib/useDevice';
import { AppShell } from '@/components/AppShell';
import { ListRow } from '@/components/ui/ListRow';
import { ChipIcon, GearIcon, SparkIcon } from '@/components/Icons';

export default function MorePage() {
  const router = useRouter();
  const { active } = useDevice();

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
  }, [router]);

  return (
    <AppShell
      title="More"
      action={
        <Link href="/more/settings/" aria-label="App Settings" className="rounded-full p-2 text-muted hover:text-ink">
          <GearIcon className="h-6 w-6" />
        </Link>
      }
    >
      <section className="card overflow-hidden">
        <h2 className="px-5 pt-5 text-sm font-semibold text-muted">Settings</h2>
        <div className="mt-2 divide-y divide-line">
          <ListRow
            icon={<ChipIcon className="h-5 w-5" />}
            tone="primary"
            title="Device Management"
            subtitle="Band, room unit and Bluetooth"
            href="/more/devices/"
          />
          <ListRow
            icon={<SparkIcon className="h-5 w-5" />}
            tone="sleep"
            title="History"
            subtitle="Everything the band recorded"
            href={active ? `/more/history/?id=${active.deviceId}` : '/more/history/'}
          />
          <ListRow
            icon={<GearIcon className="h-5 w-5" />}
            tone="muted"
            title="App Settings"
            subtitle="Appearance, sleep target, account"
            href="/more/settings/"
          />
        </div>
      </section>
    </AppShell>
  );
}
