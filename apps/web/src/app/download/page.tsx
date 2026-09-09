'use client';

import { useEffect, useState } from 'react';
import { SubPage } from '@/components/SubPage';

/**
 * The install is genuinely a sequence, and Android genuinely interrupts it
 * with a warning, so the steps are numbered and the warning is stated plainly
 * rather than hidden. A user who is not expecting "this file might be harmful"
 * assumes the app is broken and stops.
 */
const STEPS = [
  {
    title: 'Download the file',
    body: 'Your browser will ask you to confirm, then the file lands in your Downloads folder.',
  },
  {
    title: 'Open it and allow this source',
    body: 'Android blocks apps that did not come from the Play Store. It offers a Settings shortcut - turn on "Allow from this source" for your browser, then come back.',
  },
  {
    title: 'Install and grant Bluetooth',
    body: 'On first launch the app asks for Bluetooth and location. Android needs both to scan for nearby devices, even though the app never uses your location.',
  },
];

export default function DownloadPage() {
  const [android, setAndroid] = useState(false);

  useEffect(() => {
    setAndroid(/android/i.test(navigator.userAgent));
  }, []);

  return (
    <SubPage title="Get the Android app">
      <div className="max-w-2xl">
        <p className="text-muted">
          The phone is the link between the sensor node and the server. It
          connects to the node over Bluetooth, keeps a local copy of every
          reading, and uploads them whenever it has a network. Out of range of
          Wi-Fi, it keeps recording and syncs later.
        </p>

        <a href="/downloads/somnus.apk" download className="btn-primary mt-6 inline-block">
          Download the app
        </a>

        {!android && (
          <p className="mt-3 text-sm text-muted">
            You are not on Android. The file will download, but it only installs
            on an Android phone.
          </p>
        )}

        <section className="mt-10">
          <h2 className="font-medium">Installing outside the Play Store</h2>
          <ol className="mt-4 space-y-5">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="tabular shrink-0 font-mono text-sm text-motion">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10 border-t border-line pt-6">
          <h2 className="font-medium">Why the warning appears</h2>
          <p className="mt-2 text-sm text-muted">
            Android shows it for every app installed from outside the Play
            Store, regardless of what the app does. It is a statement about
            where the file came from, not about whether it is safe.
          </p>
        </section>

        <section className="mt-8 border-t border-line pt-6">
          <h2 className="font-medium">Permissions the app asks for</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-ink">Bluetooth</dt>
              <dd className="text-muted">Finding and connecting to the sensor node.</dd>
            </div>
            <div>
              <dt className="text-ink">Location</dt>
              <dd className="text-muted">
                Required by Android 11 and earlier to scan for Bluetooth devices.
                The app never reads your position.
              </dd>
            </div>
            <div>
              <dt className="text-ink">Network</dt>
              <dd className="text-muted">Uploading buffered readings to the server.</dd>
            </div>
          </dl>
        </section>
      </div>
    </SubPage>
  );
}
