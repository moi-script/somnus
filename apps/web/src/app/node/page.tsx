'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { SubPage } from '@/components/SubPage';
import { isNative } from '@/lib/platform';
import {
  disconnect,
  getSession,
  pair,
  resetError,
  subscribe,
} from '@/lib/native/session';

/**
 * The phone-only screen: pair with the node over Bluetooth and watch the
 * buffer drain. Hidden in a browser, where none of it can work.
 *
 * The connection itself lives in lib/native/session, so going back from here
 * leaves the band connected and uploading.
 */
export default function NodePage() {
  const [native, setNative] = useState<boolean | null>(null);
  const { status, stats, lastFrame } = useSyncExternalStore(subscribe, getSession, getSession);
  const [token, setTokenValue] = useState('');

  useEffect(() => {
    setNative(isNative());
    void (async () => {
      const { deviceToken } = await import('@/lib/native/sync');
      setTokenValue(deviceToken() ?? '');
    })();
  }, []);

  if (native === null) return null;

  if (!native) {
    return (
      <SubPage title="Connect over Bluetooth">
        <div className="max-w-prose">
          <p className="mt-3 text-muted">
            Bluetooth pairing only works in the Android app. In a browser you
            can watch a band that is already sending on the{' '}
            <Link href="/device/" className="text-motion">
              Device
            </Link>{' '}
            tab, or{' '}
            <Link href="/download/" className="text-motion">
              install the app
            </Link>
            .
          </p>
        </div>
      </SubPage>
    );
  }

  return (
    <SubPage title="Connect over Bluetooth">
      <div className="max-w-prose">

        {status.state === 'idle' && (
          <>
            <p className="mt-3 text-muted">
              Power up the node and keep it within a few metres. Android will
              show a list of nearby nodes to pick from.
            </p>
            <label htmlFor="token" className="mt-6 mb-1 block text-sm text-muted">
              Ingest token
            </label>
            <input
              id="token"
              className="field font-mono text-sm"
              placeholder="lacs-7a3f21.abc123"
              value={token}
              onChange={(e) => setTokenValue(e.target.value)}
            />
            <p className="mt-1 text-sm text-muted">
              Shown once when you add the node on the Device tab.
            </p>
            <button type="button" className="btn-primary mt-4" onClick={() => void pair(token)}>
              Find my node
            </button>
          </>
        )}

        {status.state === 'scanning' && <p className="mt-4 text-muted">Looking for nodes</p>}
        {status.state === 'connecting' && (
          <p className="mt-4 text-muted">Connecting to {status.name}</p>
        )}

        {status.state === 'connected' && (
          <section className="mt-6">
            <p className="text-motion">Connected to {status.name}</p>

            <dl className="mt-6 divide-y divide-line border-y border-line">
              <div className="flex justify-between py-3">
                <dt className="text-muted">Waiting to upload</dt>
                <dd className="tabular font-mono">{stats?.buffered ?? 0}</dd>
              </div>
              <div className="flex justify-between py-3">
                <dt className="text-muted">Uploaded this session</dt>
                <dd className="tabular font-mono">{stats?.uploaded ?? 0}</dd>
              </div>
              <div className="flex justify-between py-3">
                <dt className="text-muted">Last frame</dt>
                <dd className="tabular font-mono">
                  {lastFrame ? `${lastFrame.t} #${lastFrame.seq}` : 'none yet'}
                </dd>
              </div>
            </dl>

            {stats?.lastError && (
              <p className="mt-4 rounded-2xl border border-skin/40 bg-skin/5 px-3 py-2 text-sm text-skin">
                {stats.lastError}
              </p>
            )}

            <p className="mt-4 text-sm text-muted">
              Readings are saved on this phone first, then uploaded. You can
              leave Wi-Fi range and nothing is lost.
            </p>

            <button type="button" className="btn mt-6" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </section>
        )}

        {status.state === 'error' && (
          <>
            <p className="mt-4 rounded-2xl border border-alarm/30 bg-alarm/10 px-3 py-2 text-sm text-alarm">
              {status.message}
            </p>
            <button type="button" className="btn mt-4" onClick={resetError}>
              Try again
            </button>
          </>
        )}
      </div>
    </SubPage>
  );
}
