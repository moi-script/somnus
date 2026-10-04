'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { forwardTarget } from '@/lib/forward';

/** An old address that moved. Keeps the installed 0.5.0 app and saved links working. */
export function Forward({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(forwardTarget(to, window.location.search));
  }, [router, to]);
  return <p className="p-6 text-muted">Moving you to the new page…</p>;
}
