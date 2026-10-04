'use client';

import { useEffect, useState } from 'react';
import { isNative } from '@/lib/platform';
import { LATEST_APK, type Release } from '@/lib/update';
import { useInstallUpdate } from '@/lib/useInstallUpdate';

/**
 * "Somnus X is out". In the app, Update downloads with a progress line and
 * opens Android's installer itself; the browser stays as the fallback. On
 * the website it is just the download link.
 */
export function UpdateBanner({ update, onDismiss }: { update: Release; onDismiss: () => void }) {
  const [native, setNative] = useState(false);
  const { state, start } = useInstallUpdate(LATEST_APK);
  useEffect(() => setNative(isNative()), []);

  const busy = state.phase === 'downloading';
  const note =
    state.phase === 'downloading'
      ? state.label
      : state.phase === 'installing'
        ? 'Tap Update on the screen Android shows. Your readings stay on the phone.'
        : state.phase === 'error'
          ? state.message
          : 'Install it over this one. Your readings stay on the phone.';

  return (
    <div className="card mb-4 px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Somnus {update.version} is out</p>
          <p className={`text-sm ${state.phase === 'error' ? 'text-alarm' : 'text-muted'}`} aria-live="polite">
            {note}
          </p>
        </div>
        {native ? (
          <button type="button" className="btn-primary shrink-0 !py-2 text-sm" disabled={busy} onClick={() => void start()}>
            {busy ? 'Downloading…' : state.phase === 'error' ? 'Try again' : 'Update'}
          </button>
        ) : (
          <a href={LATEST_APK} className="btn-primary shrink-0 !py-2 text-sm">
            Download
          </a>
        )}
        {!busy && (
          <button type="button" onClick={onDismiss} aria-label="Not now" className="shrink-0 px-1 text-xl leading-none text-muted">
            ×
          </button>
        )}
      </div>
      {native && state.phase === 'error' && (
        <a href={LATEST_APK} className="mt-2 inline-block text-sm font-medium text-primary">
          Download in the browser instead
        </a>
      )}
    </div>
  );
}
