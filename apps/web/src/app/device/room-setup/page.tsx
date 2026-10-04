'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  SetupLost,
  SetupRefused,
  SetupStaleBond,
  SetupTimeout,
  describeResult,
  mergeNetworks,
  type SetupHello,
  type SetupNetwork,
  type SetupOutcome,
} from '@lacs/contracts';
import { API_URL, ApiError, api } from '@/lib/api';
import { isNative } from '@/lib/platform';
import { SubPage } from '@/components/SubPage';
import {
  ConnectingStep,
  FindStep,
  PasswordStep,
  ResultStep,
  WifiStep,
  type JoinStage,
} from '@/components/room-setup/Steps';
import type { SetupLink } from '@/lib/native/roomSetup';

type Step =
  | { name: 'find' }
  | { name: 'wifi' }
  | { name: 'password'; ssid: string; secure: boolean; hidden: boolean }
  | { name: 'connecting'; ssid: string; stage: JoinStage }
  | { name: 'result'; outcome: SetupOutcome };

/** Words for anything the Bluetooth side throws. */
async function errorText(err: unknown): Promise<string> {
  const { SetupPairingFailed } = await import('@/lib/native/roomSetup');
  if (err instanceof SetupStaleBond) {
    // The unit's memory was erased, but Android still thinks they are
    // paired, so every encrypted write fails.
    return 'The phone and the room unit no longer trust each other. In Android Bluetooth settings, forget Somnus-room-…, then search again.';
  }
  if (err instanceof SetupPairingFailed) {
    return 'Pairing did not finish. Tap Search again, and tap Pair when Android asks.';
  }
  if (err instanceof SetupLost) return 'The room unit disconnected. Search again.';
  if (err instanceof SetupTimeout) {
    return 'The room unit did not answer. Keep the phone close, and hold its BOOT button for 3 seconds if it is already online.';
  }
  if (err instanceof SetupRefused) {
    return err.reason === 'busy'
      ? 'The room unit is busy. Wait a few seconds and try again.'
      : 'The room unit did not understand the app. Update its firmware.';
  }
  const message = (err as Error)?.message ?? String(err);
  // Only the device picker is left to cancel; pairing is SetupPairingFailed.
  if (/cancel/i.test(message)) return 'No room unit was chosen.';
  return message;
}

export default function RoomSetupPage() {
  const router = useRouter();
  const [native, setNative] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>({ name: 'find' });
  const [hello, setHello] = useState<SetupHello | null>(null);
  const [networks, setNetworks] = useState<SetupNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const link = useRef<SetupLink | null>(null);
  const last = useRef<{ ssid: string; password: string } | null>(null);

  useEffect(() => setNative(isNative()), []);
  useEffect(
    () => () => {
      void link.current?.close();
    },
    [],
  );

  const lost = useCallback(() => {
    link.current = null;
    setStep({ name: 'find' });
    setMessage('The room unit disconnected. Search again.');
  }, []);

  const scan = useCallback(async () => {
    const current = link.current;
    if (!current) return;
    setNetworks([]);
    setScanning(true);
    setMessage(null);
    try {
      await current.scan((n) => setNetworks((list) => mergeNetworks(list, n)));
    } catch (err) {
      // A link that has since dropped already sent the wizard back to Find.
      if (link.current === current) setMessage(await errorText(err));
    } finally {
      setScanning(false);
    }
  }, []);

  const search = useCallback(async () => {
    setMessage(null);
    setBusy(true);
    try {
      const { ensureEnabled } = await import('@/lib/native/ble');
      if (!(await ensureEnabled())) {
        setMessage('Bluetooth is needed to set up the room unit. Tap Search to try again.');
        return;
      }
      const { findRoomUnit, openSetup } = await import('@/lib/native/roomSetup');
      const device = await findRoomUnit();
      link.current = await openSetup(device, lost);
      setHello(await link.current.hello());
      setStep({ name: 'wifi' });
      void scan();
    } catch (err) {
      await link.current?.close();
      link.current = null;
      setMessage(await errorText(err));
    } finally {
      setBusy(false);
    }
  }, [lost, scan]);

  const join = useCallback(
    async (ssid: string, password: string) => {
      const current = link.current;
      if (!current || !hello) return;
      last.current = { ssid, password };
      setMessage(null);

      // Claiming mints a new key and kills the old one, so it happens only
      // now, right before the unit is handed the new key.
      setStep({ name: 'connecting', ssid, stage: 'claim' });
      let key: string;
      try {
        key = (await api.claim(hello.id)).ingestToken;
      } catch (err) {
        const taken = err instanceof ApiError && err.status === 409;
        setStep({
          name: 'result',
          outcome: taken
            ? {
                ok: false,
                title: 'This room unit belongs to another account',
                detail: 'Remove it from that account first, then set it up again.',
                backTo: null,
              }
            : {
                ok: false,
                title: 'Could not add the room unit',
                detail: (err as Error).message,
                backTo: 'retry',
              },
        });
        return;
      }

      setStep({ name: 'connecting', ssid, stage: 'send' });
      try {
        const result = await current.join({ ssid, password, server: API_URL, key }, (stage) =>
          setStep({ name: 'connecting', ssid, stage }),
        );
        if (link.current !== current) return;
        const outcome = describeResult(result);
        setStep({ name: 'result', outcome });
        if (outcome.ok) {
          // The unit closes Bluetooth itself a moment later.
          await current.close();
          link.current = null;
        }
      } catch (err) {
        // A link that has since dropped already sent the wizard back to Find;
        // a late failure from it must not pull the user out of a new attempt.
        if (link.current !== current) return;
        setStep({
          name: 'result',
          outcome: {
            ok: false,
            title: 'No answer from the room unit',
            detail: await errorText(err),
            backTo: 'retry',
          },
        });
      }
    },
    [hello],
  );

  const retry = useCallback(
    (outcome: SetupOutcome) => {
      const prev = last.current;
      if (!link.current) {
        setStep({ name: 'find' });
        return;
      }
      if (outcome.backTo === 'wifi' || !prev) {
        setStep({ name: 'wifi' });
        void scan();
      } else if (outcome.backTo === 'password') {
        setStep({ name: 'password', ssid: prev.ssid, secure: true, hidden: false });
      } else {
        void join(prev.ssid, prev.password);
      }
    },
    [join, scan],
  );

  if (native === false) {
    return (
      <SubPage title="Set up the room unit">
        <section className="card px-6 py-6">
          <h2 className="text-lg font-semibold">Needs the Android app</h2>
          <p className="mt-2 text-muted">
            Setting up over Bluetooth only works in the Somnus app on Android.
          </p>
          <p className="mt-2 text-muted">
            Without it: on your phone, join the Wi-Fi network Somnus-room-… that the unit opens,
            then follow the page that appears.
          </p>
          <Link href="/download/" className="btn-primary mt-5 inline-block">
            Get the Android app
          </Link>
        </section>
      </SubPage>
    );
  }

  return (
    <SubPage title="Set up the room unit" subtitle="Wi-Fi, over Bluetooth">
      <div className="space-y-4">
        {step.name === 'find' && <FindStep busy={busy} onSearch={() => void search()} />}
        {step.name === 'wifi' && hello && (
          <WifiStep
            hello={hello}
            networks={networks}
            scanning={scanning}
            onRescan={() => void scan()}
            onPick={(ssid, secure, hidden) => setStep({ name: 'password', ssid, secure, hidden })}
          />
        )}
        {step.name === 'password' && (
          <PasswordStep
            ssid={step.ssid}
            secure={step.secure}
            hidden={step.hidden}
            onBack={() => setStep({ name: 'wifi' })}
            onSubmit={(ssid, password) => void join(ssid, password)}
          />
        )}
        {step.name === 'connecting' && <ConnectingStep ssid={step.ssid} stage={step.stage} />}
        {step.name === 'result' && (
          <ResultStep
            outcome={step.outcome}
            onRetry={() => retry(step.outcome)}
            onDone={() => router.push(step.outcome.ok ? '/sleep/' : '/device/')}
          />
        )}
        {message && (
          <p className="rounded-2xl bg-card px-4 py-3 text-sm shadow-soft">{message}</p>
        )}
      </div>
    </SubPage>
  );
}
