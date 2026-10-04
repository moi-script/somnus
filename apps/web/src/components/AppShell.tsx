'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LATEST_APK, useUpdate } from '@/lib/update';
import { BedIcon, HeartIcon, HomeIcon, MenuIcon, MoonIcon } from './Icons';

const TABS = [
  { href: '/home/', label: 'Home', Icon: HomeIcon },
  { href: '/sleep/', label: 'Sleep', Icon: MoonIcon },
  { href: '/health/', label: 'Health', Icon: HeartIcon },
  { href: '/bed/', label: 'Bed', Icon: BedIcon },
  { href: '/more/', label: 'More', Icon: MenuIcon },
];

/**
 * Page frame for the five tabs. Tabs sit at the bottom on a phone where a
 * thumb reaches them, and along the top on wider screens. `action` is the
 * header's right side: a status pill, a settings button.
 */
export function AppShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { update, showBanner, dismiss } = useUpdate();

  return (
    <div className="min-h-screen pb-28 sm:pb-10">
      <header className="mx-auto max-w-3xl px-5 pt-6 sm:px-8 sm:pt-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>

        <nav className="mt-6 hidden gap-1 border-b border-line sm:flex">
          {TABS.map(({ href, label }) => {
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`-mb-px border-b-2 px-4 py-3 font-medium transition-colors ${
                  active ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
        {showBanner && update && (
          <div className="card mb-4 flex items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">Somnus {update.version} is out</p>
              <p className="text-sm text-muted">Install it over this one. Your readings stay on the phone.</p>
            </div>
            <a href={LATEST_APK} className="btn-primary shrink-0 !py-2 text-sm">
              Update
            </a>
            <button type="button" onClick={dismiss} aria-label="Not now" className="shrink-0 px-1 text-xl leading-none text-muted">
              ×
            </button>
          </div>
        )}
        {children}
      </main>

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
                  active ? 'text-primary' : 'text-muted'
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
