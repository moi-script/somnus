'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { setToken } from '@/lib/api';
import { isNative } from '@/lib/platform';

const WEB_LINKS = [
  { href: '/devices/', label: 'Devices' },
  { href: '/download/', label: 'Get the app' },
];

// Inside the app, pairing replaces the download link - you already have it.
const NATIVE_LINKS = [
  { href: '/devices/', label: 'Devices' },
  { href: '/node/', label: 'Pair a node' },
];

export function Nav() {
  const pathname = usePathname();
  const [links, setLinks] = useState(WEB_LINKS);

  useEffect(() => {
    if (isNative()) setLinks(NATIVE_LINKS);
  }, []);

  return (
    <nav className="mb-8 flex items-center justify-between border-b border-rule pb-4">
      <div className="flex items-baseline gap-6">
        <Link href="/devices/" className="font-medium tracking-tight">
          LACS
        </Link>
        {links.map((link) => {
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
