'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The open tab, kept in ?tab= so Back and reloads land on it.
 * Callers must sit inside <Suspense> (useSearchParams in a static export).
 */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T): [T, (t: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('tab');
  const tab = raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback((t: T) => router.replace(`${pathname}?tab=${t}`, { scroll: false }), [router, pathname]);
  return [tab, set];
}
