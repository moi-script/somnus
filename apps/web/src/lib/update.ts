'use client';

import { useEffect, useState } from 'react';
import { isNative } from './platform';

/**
 * The APK is sideloaded, so nothing tells an installed copy that a newer one
 * exists. The app asks GitHub itself: the version baked into this bundle
 * (apps/mobile/package.json, via next.config) against the newest release tag.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

const RELEASES = 'https://github.com/moi-script/somnus/releases';
export const LATEST_APK = `${RELEASES}/latest/download/somnus.apk`;
const LATEST_API = 'https://api.github.com/repos/moi-script/somnus/releases/latest';

// Unauthenticated GitHub API calls are capped at 60 an hour per IP, which a
// phone on shared Wi-Fi could reach if every tab switch asked again.
const CACHE_KEY = 'somnus.update.latest';
const DISMISS_KEY = 'somnus.update.dismissed';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface Release {
  version: string;
  url: string;
}

/** Strict numeric compare of "v1.2.3" style tags; true when a is newer than b. */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function readStore<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the check simply runs again next time.
  }
}

async function latestRelease(): Promise<Release | null> {
  const cached = readStore<{ at: number; release: Release }>(CACHE_KEY);
  if (cached && Date.now() - cached.at < CHECK_EVERY_MS) return cached.release;

  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return cached?.release ?? null;
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!body.tag_name) return null;
    const release = { version: body.tag_name.replace(/^v/i, ''), url: body.html_url ?? RELEASES };
    writeStore(CACHE_KEY, { at: Date.now(), release });
    return release;
  } catch {
    // Offline is normal for this app; say nothing rather than nag.
    return cached?.release ?? null;
  }
}

/**
 * The newer release, or null when up to date, offline, or not running as the
 * installed app. On the website the download link is already always the
 * latest, so there is nothing to offer.
 */
export function useUpdate() {
  const [update, setUpdate] = useState<Release | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!isNative()) return;
    setDismissed(readStore<string>(DISMISS_KEY));
    let live = true;
    latestRelease().then((release) => {
      if (live && release && isNewer(release.version, APP_VERSION)) setUpdate(release);
    });
    return () => {
      live = false;
    };
  }, []);

  return {
    update,
    /** Hidden until a release newer than the dismissed one appears. */
    showBanner: update !== null && update.version !== dismissed,
    dismiss() {
      if (!update) return;
      writeStore(DISMISS_KEY, update.version);
      setDismissed(update.version);
    },
  };
}
