'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { setToken } from '@/lib/api';

const LINKS = [
  { href: '/devices/', label: 'Devices' },
  { href: '/download/', label: 'Get the app' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="mb-8 flex items-center justify-between border-b border-rule pb-4">
      <div className="flex items-baseline gap-6">
        <Link href="/devices/" className="font-medium tracking-tight">
          LACS
        </Link>
        {LINKS.map((link) => {
          const active = pathname?.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={active ? 'text-motion' : 'text-muted hover:text-ink'}
            >
              {link.label}
            </Link>
          );
        })}
      </div>

      <button
        type="button"
        className="text-sm text-muted hover:text-ink"
        onClick={() => {
          setToken(null);
          window.location.href = '/login/';
        }}
      >
        Sign out
      </button>
    </nav>
  );
}
