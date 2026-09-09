'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? '/health/' : '/login/');
  }, [router]);

  return <p className="text-muted">Loading</p>;
}
