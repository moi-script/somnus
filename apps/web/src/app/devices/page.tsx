'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Device } from '@lacs/contracts';
import { api, getToken } from '@/lib/api';
import { Nav } from '@/components/Nav';
import { isNative } from '@/lib/platform';

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('');
  const [claimed, setClaimed] = useState<{ deviceId: string; token: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await api.devices());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login/');
      return;
    }
    void load();
  }, [load, router]);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.claim(deviceId.trim(), name.trim() || undefined);
      setClaimed({ deviceId: res.device.deviceId, token: res.ingestToken });
      setDeviceId('');
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <Nav />
      <main>
        <h1 className="text-2xl font-medium tracking-tight">Devices</h1>

        {devices === null && !error && <p className="mt-4 text-muted">Loading</p>}

        {devices?.length === 0 && (
          <p className="mt-4 max-w-prose text-muted">
            No nodes yet. Power up the XIAO, read its id from the boot line in
            the serial monitor, and add it below.
          </p>
        )}

        {devices && devices.length > 0 && (
          <ul className="mt-6 divide-y divide-rule border-y border-rule">
            {devices.map((device) => (
              <li key={device.deviceId}>
                <Link
                  href={`/live/?id=${device.deviceId}`}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4 hover:text-motion"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: device.online ? '#4FD6C8' : '#17323D' }}
                    aria-hidden
                  />
                  <span className="font-medium">{device.name}</span>
                  <span className="font-mono text-sm text-muted">{device.deviceId}</span>
                  <span className="flex-1" />
                  <span className="text-sm text-muted">
                    {device.online
                      ? 'Reporting now'
                      : device.lastSeenAt
                        ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}`
                        : 'Never reported'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-10 max-w-md">
          <h2 className="font-medium">Add a node</h2>
          <p className="mt-1 text-sm text-muted">
            The id is printed on the boot line: <span className="font-mono">lacs-7a3f21</span>.
          </p>

          <form onSubmit={claim} className="mt-4 space-y-3">
            <input
              className="field font-mono"
              placeholder="lacs-7a3f21"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              required
              aria-label="Device id"
            />
            <input
              className="field"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Device name"
            />
            <button type="submit" className="btn">
              Add node
            </button>
          </form>
        </section>

        {claimed && (
          <section className="mt-8 max-w-2xl rounded border border-skin/40 bg-skin/5 p-4">
            <h2 className="font-medium text-skin">Ingest token for {claimed.deviceId}</h2>
            <p className="mt-1 text-sm">
              This is shown once and never again. The phone app stores it
              automatically. For the USB bridge, put it in{' '}
              <span className="font-mono">.env</span> as{' '}
              <span className="font-mono">BRIDGE_DEVICE_TOKEN</span>.
            </p>
            <code className="mt-3 block break-all rounded bg-ground p-3 font-mono text-sm">
              {claimed.token}
            </code>
            {!isNative() && (
              <button
                type="button"
                className="btn mt-3"
                onClick={() => void navigator.clipboard.writeText(claimed.token)}
              >
                Copy token
              </button>
            )}
          </section>
        )}

        {error && (
          <p className="mt-6 rounded border border-alarm/40 bg-alarm/10 px-3 py-2 text-sm text-alarm">
            {error}
          </p>
        )}
      </main>
    </>
  );
}
