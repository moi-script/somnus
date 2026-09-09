'use client';

import { useRouter } from 'next/navigation';

/**
 * Frame for screens reached from a tab rather than being one: history, the
 * download page, Bluetooth pairing. A back arrow instead of the tab bar, so
 * it is obvious you have gone one level down.
 */
export function SubPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="min-h-screen">
      <header className="mx-auto max-w-3xl px-5 pt-6 sm:px-8 sm:pt-10">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="m14 6-6 6 6 6" />
          </svg>
          Back
        </button>
        <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </header>
      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-8">{children}</main>
    </div>
  );
}
