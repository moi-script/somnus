'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken, setToken } from '@/lib/api';
import { useDevice } from '@/lib/useDevice';
import { readTheme, setTheme, type Theme } from '@/lib/theme';
import { AppShell } from '@/components/AppShell';
import {
  ChevronIcon,
  HelpIcon,
  InfoIcon,
  LinkIcon,
  MailIcon,
  PaletteIcon,
  TargetIcon,
} from '@/components/Icons';

const TARGETS_KEY = 'lacs.targets';

interface Targets {
  steps: number;
  sleepHours: number;
}

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'soft', label: 'Soft', hint: 'Pale and bright' },
  { value: 'night', label: 'Night', hint: 'Easier in the dark' },
  { value: 'system', label: 'Match phone', hint: 'Follows your settings' },
];

export default function MePage() {
  const router = useRouter();
  const { active } = useDevice();
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [theme, setThemeState] = useState<Theme>('system');
  const [targets, setTargets] = useState<Targets>({ steps: 8000, sleepHours: 8 });
  const [panel, setPanel] = useState<'targets' | 'theme' | 'faq' | 'about' | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login/');
      return;
    }
    void api.me().then(setUser).catch(() => setUser(null));
    setThemeState(readTheme());
    const stored = window.localStorage.getItem(TARGETS_KEY);
    if (stored) {
      try {
        setTargets(JSON.parse(stored) as Targets);
      } catch {
        // Ignore a corrupted value and keep the defaults.
      }
    }
  }, [router]);

  const chooseTheme = useCallback((value: Theme) => {
    setTheme(value);
    setThemeState(value);
  }, []);

  const saveTargets = useCallback((next: Targets) => {
    setTargets(next);
    window.localStorage.setItem(TARGETS_KEY, JSON.stringify(next));
  }, []);

  const initials = user?.email.slice(0, 2).toUpperCase() ?? '··';

  return (
    <AppShell title="Me" deviceName={active?.name ?? null} connected={false}>
      <div className="space-y-4">
        <section className="card flex items-center gap-4 px-6 py-6">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-sleep/15 text-xl font-bold text-sleep">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">
              {user?.email.split('@')[0] ?? 'Signed out'}
            </p>
            <p className="truncate text-sm text-muted">{user?.email}</p>
            {user && (
              <p className="mt-0.5 truncate text-xs text-muted">ID {user.id}</p>
            )}
          </div>
        </section>

        <section className="card overflow-hidden">
          <button type="button" className="row" onClick={() => setPanel(panel === 'targets' ? null : 'targets')}>
            <TargetIcon className="h-5 w-5 text-motion" />
            <span className="flex-1 font-medium">Set your targets</span>
            <span className="text-sm text-muted">
              {targets.steps.toLocaleString()} steps
            </span>
            <ChevronIcon className="h-5 w-5 text-muted" />
          </button>

          {panel === 'targets' && (
            <div className="border-t border-line bg-canvas/50 px-5 py-5">
              <label className="block text-sm font-medium" htmlFor="steps">
                Steps a day
              </label>
              <input
                id="steps"
                type="number"
                min={1000}
                step={500}
                className="field mt-2"
                value={targets.steps}
                onChange={(e) =>
                  saveTargets({ ...targets, steps: Number(e.target.value) })
                }
              />
              <label className="mt-4 block text-sm font-medium" htmlFor="sleep">
                Hours of sleep
              </label>
              <input
                id="sleep"
                type="number"
                min={4}
                max={12}
                step={0.5}
                className="field mt-2"
                value={targets.sleepHours}
                onChange={(e) =>
                  saveTargets({ ...targets, sleepHours: Number(e.target.value) })
                }
              />
              <p className="mt-3 text-sm text-muted">
                Saved on this device. Nothing measures steps or sleep yet, so
                these sit here until the band can count them.
              </p>
            </div>
          )}

          <button type="button" className="row border-t border-line" onClick={() => setPanel(panel === 'theme' ? null : 'theme')}>
            <PaletteIcon className="h-5 w-5 text-sleep" />
            <span className="flex-1 font-medium">Theme style</span>
            <span className="text-sm capitalize text-muted">
              {THEMES.find((t) => t.value === theme)?.label}
            </span>
            <ChevronIcon className="h-5 w-5 text-muted" />
          </button>

          {panel === 'theme' && (
            <div className="grid gap-2 border-t border-line bg-canvas/50 px-5 py-5 sm:grid-cols-3">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => chooseTheme(t.value)}
                  className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                    theme === t.value
                      ? 'border-motion bg-card'
                      : 'border-line bg-card/60 hover:bg-card'
                  }`}
                >
                  <span className="block font-medium">{t.label}</span>
                  <span className="text-sm text-muted">{t.hint}</span>
                </button>
              ))}
            </div>
          )}

          <div className="row border-t border-line opacity-70">
            <LinkIcon className="h-5 w-5 text-muted" />
            <span className="flex-1">
              <span className="block font-medium">Health Connect</span>
              <span className="text-sm text-muted">
                Android's health store. Not wired up yet.
              </span>
            </span>
          </div>
        </section>

        <section className="card overflow-hidden">
          <button type="button" className="row" onClick={() => setPanel(panel === 'faq' ? null : 'faq')}>
            <HelpIcon className="h-5 w-5 text-muted" />
            <span className="flex-1 font-medium">Questions</span>
            <ChevronIcon className="h-5 w-5 text-muted" />
          </button>

          {panel === 'faq' && (
            <dl className="space-y-4 border-t border-line bg-canvas/50 px-5 py-5 text-sm">
              <div>
                <dt className="font-medium">Why do some readings say Not measured?</dt>
                <dd className="mt-1 text-muted">
                  The band has three sensors: pulse, skin response and motion.
                  Anything outside that has nowhere to come from, so the app
                  says so instead of showing a number nobody measured.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Why is my heart rate blank?</dt>
                <dd className="mt-1 text-muted">
                  The sensor needs skin contact and a few seconds of stillness.
                  Rest a fingertip on it without pressing hard.
                </dd>
              </div>
              <div>
                <dt className="font-medium">What happens with no signal?</dt>
                <dd className="mt-1 text-muted">
                  Your phone keeps the readings and sends them once it can. You
                  can walk out of range without losing anything.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Is this a medical device?</dt>
                <dd className="mt-1 text-muted">
                  No. It is a research project. Do not use it to make decisions
                  about anyone's health.
                </dd>
              </div>
            </dl>
          )}

          <a
            className="row border-t border-line"
            href="mailto:nugalmoises62@gmail.com?subject=Somnus%20feedback"
          >
            <MailIcon className="h-5 w-5 text-muted" />
            <span className="flex-1 font-medium">Send feedback</span>
            <ChevronIcon className="h-5 w-5 text-muted" />
          </a>

          <button type="button" className="row border-t border-line" onClick={() => setPanel(panel === 'about' ? null : 'about')}>
            <InfoIcon className="h-5 w-5 text-muted" />
            <span className="flex-1 font-medium">About</span>
            <ChevronIcon className="h-5 w-5 text-muted" />
          </button>

          {panel === 'about' && (
            <div className="border-t border-line bg-canvas/50 px-5 py-5 text-sm text-muted">
              <p>
                Somnus reads a pulse sensor, a skin response sensor and an
                accelerometer from a small board worn on the body, and keeps the
                readings on your phone until they can be uploaded.
              </p>
              <p className="mt-3">
                Built as a thesis project. Not a medical device, and not tested
                for accuracy against one.
              </p>
              {active?.fw && <p className="mt-3">Band firmware {active.fw}</p>}
            </div>
          )}
        </section>

        <Link href="/download/" className="card row rounded-card">
          <span className="flex-1 font-medium">Get the Android app</span>
          <ChevronIcon className="h-5 w-5 text-muted" />
        </Link>

        <button
          type="button"
          className="w-full rounded-card bg-card px-5 py-4 font-medium text-alarm shadow-soft"
          onClick={() => {
            setToken(null);
            window.location.href = '/login/';
          }}
        >
          Sign out
        </button>
      </div>
    </AppShell>
  );
}
