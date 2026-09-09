'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BluetoothIcon,
  ChipIcon,
  HeartIcon,
  PersonIcon,
  RunIcon,
} from './Icons';

const TABS = [
  { href: '/health/', label: 'Health', Icon: HeartIcon },
  { href: '/exercise/', label: 'Exercise', Icon: RunIcon },
  { href: '/device/', label: 'Device', Icon: ChipIcon },
  { href: '/me/', label: 'Me', Icon: PersonIcon },
];

interface AppShellProps {
  title: string;
  subtitle?: string;
  /** Null when no node has been added yet. */
  deviceName?: string | null;
  connected?: boolean;
  children: React.ReactNode;
}

/**
 * Page frame: a header that always answers "is the band connected", and the
 * tab bar. Tabs sit at the bottom on a phone where a thumb reaches them, and
 * move to the top on wider screens where the bottom edge is far away.
 */
export function AppShell({
  title,
  subtitle,
  deviceName,
  connected = false,
  children,
}: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen pb-28 sm:pb-10">
      <header className="mx-auto max-w-3xl px-5 pt-6 sm:px-8 sm:pt-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
          </div>

          <Link
            href="/device/"
            className="flex shrink-0 items-center gap-2 rounded-pill bg-card px-3 py-2 shadow-soft"
          >
            <BluetoothIcon
              className={`h-4 w-4 ${connected ? 'text-motion' : 'text-muted'}`}
            />
            <span className="max-w-[9rem] truncate text-sm font-medium">
              {deviceName ?? 'No band yet'}
            </span>
            <span
              className={`h-2 w-2 rounded-full ${connected ? 'bg-motion' : 'bg-line'}`}
              aria-label={connected ? 'Connected' : 'Not connected'}
            />
          </Link>
        </div>

        {/* Wide screens: tabs under the header, where they read as navigation. */}
        <nav className="mt-6 hidden gap-1 border-b border-line sm:flex">
          {TABS.map(({ href, label }) => {
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`-mb-px border-b-2 px-4 py-3 font-medium transition-colors ${
                  active
                    ? 'border-ink text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-8">{children}</main>

      {/* Phones: thumb-reachable bar pinned to the bottom. */}
      <nav className="fixed inset-x-0 bottom-0 border-t border-line bg-card/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-3xl">
          {TABS.map(({ href, label, Icon }) => {
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-1 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs font-medium transition-colors ${
                  active ? 'text-ink' : 'text-muted'
                }`}
              >
                <Icon className={`h-6 w-6 ${active ? '' : 'opacity-70'}`} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
