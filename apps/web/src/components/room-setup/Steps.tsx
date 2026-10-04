'use client';

import { useEffect, useState } from 'react';
import {
  joinProblem,
  signalBars,
  type SetupHello,
  type SetupNetwork,
  type SetupOutcome,
} from '@lacs/contracts';

export type JoinStage = 'claim' | 'send' | 'join' | 'server';

export function FindStep({ busy, onSearch }: { busy: boolean; onSearch: () => void }) {
  return (
    <section className="card px-6 py-6">
      <h2 className="text-lg font-semibold">Find the room unit</h2>
      <p className="mt-2 text-muted">
        Keep the phone near the room unit. A new unit, or one without Wi-Fi, is ready on its own.
        If it is already online, hold its BOOT button for 3 seconds first.
      </p>
      <p className="mt-2 text-muted">
        The first time, Android asks to pair with Somnus-room-…. Tap Pair: it encrypts the link
        that carries your Wi-Fi password.
      </p>
      <button type="button" className="btn-primary mt-5" onClick={onSearch} disabled={busy}>
        {busy ? 'Connecting…' : 'Search'}
      </button>
    </section>
  );
}

function Bars({ rssi }: { rssi: number }) {
  const bars = signalBars(rssi);
  return (
    <span className="flex items-end gap-0.5" aria-label={`Signal ${bars} of 4`}>
      {[1, 2, 3, 4].map((b) => (
        <span
          key={b}
          className={`w-1 rounded-sm ${b <= bars ? 'bg-ink' : 'bg-line'}`}
          style={{ height: 4 + b * 3 }}
        />
      ))}
    </span>
  );
}

function Lock() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-label="Password protected"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function WifiStep({
  hello,
  networks,
  scanning,
  onRescan,
  onPick,
}: {
  hello: SetupHello;
  networks: SetupNetwork[];
  scanning: boolean;
  onRescan: () => void;
  onPick: (ssid: string, secure: boolean, hidden: boolean) => void;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="px-6 pt-6">
        <h2 className="text-lg font-semibold">Choose a Wi-Fi network</h2>
        <p className="mt-1 text-sm text-muted">
          Connected to {hello.id} · {hello.wifi ? `currently on ${hello.wifi}` : 'not on Wi-Fi'}
        </p>
        <p className="mt-1 text-sm text-muted">Only 2.4 GHz networks the unit can hear are listed.</p>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {networks.map((n) => (
          <li key={n.ssid}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-6 py-4 text-left"
              onClick={() => onPick(n.ssid, n.secure, false)}
            >
              <Bars rssi={n.rssi} />
              <span className="flex-1 truncate font-medium">{n.ssid}</span>
              {n.secure && <Lock />}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="w-full px-6 py-4 text-left font-medium text-muted"
            onClick={() => onPick('', true, true)}
          >
            Other network…
          </button>
        </li>
      </ul>
      <div className="flex items-center justify-between px-6 py-4">
        <span className="text-sm text-muted">
          {scanning ? 'Looking for networks…' : `${networks.length} found`}
        </span>
        <button type="button" className="btn" onClick={onRescan} disabled={scanning}>
          Rescan
        </button>
      </div>
    </section>
  );
}

export function PasswordStep({
  ssid: initialSsid,
  secure,
  hidden,
  onBack,
  onSubmit,
}: {
  ssid: string;
  secure: boolean;
  hidden: boolean;
  onBack: () => void;
  onSubmit: (ssid: string, password: string) => void;
}) {
  const [ssid, setSsid] = useState(initialSsid);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const issue = joinProblem(ssid, secure ? password : '');
    setProblem(issue);
    if (!issue) onSubmit(ssid, secure ? password : '');
  };

  return (
    <form className="card space-y-4 px-6 py-6" onSubmit={submit}>
      <h2 className="text-lg font-semibold">{hidden ? 'Other network' : ssid}</h2>
      {hidden && (
        <input
          className="field w-full"
          placeholder="Network name"
          value={ssid}
          onChange={(e) => setSsid(e.target.value)}
          aria-label="Network name"
          autoFocus
        />
      )}
      {secure && (
        <div className="flex gap-2">
          <input
            className="field flex-1"
            type={show ? 'text' : 'password'}
            placeholder="Wi-Fi password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Wi-Fi password"
            autoFocus={!hidden}
          />
          <button type="button" className="btn" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
      )}
      {!secure && <p className="text-muted">This network has no password.</p>}
      {problem && <p className="text-sm text-alarm">{problem}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <button type="submit" className="btn-primary flex-1">
          Connect
        </button>
      </div>
    </form>
  );
}

const STAGES: { stage: JoinStage; label: (ssid: string) => string }[] = [
  { stage: 'claim', label: () => 'Adding to your account' },
  { stage: 'send', label: () => 'Sending to the room unit' },
  { stage: 'join', label: (ssid) => `Joining ${ssid}` },
  { stage: 'server', label: () => 'Checking the server' },
];

export function ConnectingStep({ ssid, stage }: { ssid: string; stage: JoinStage }) {
  const current = STAGES.findIndex((s) => s.stage === stage);
  const [slow, setSlow] = useState(false);

  // A sleeping Render instance takes up to a minute; say so instead of looking stuck.
  useEffect(() => {
    setSlow(false);
    if (stage !== 'server') return;
    const timer = setTimeout(() => setSlow(true), 5_000);
    return () => clearTimeout(timer);
  }, [stage]);

  return (
    <section className="card px-6 py-6">
      <h2 className="text-lg font-semibold">Connecting…</h2>
      <ol className="mt-4 space-y-3">
        {STAGES.map((s, i) => (
          <li key={s.stage} className={`flex items-center gap-3 ${i > current ? 'text-muted' : ''}`}>
            <span className="w-5 text-center">{i < current ? '✓' : i === current ? '•' : ''}</span>
            {s.label(ssid)}
          </li>
        ))}
      </ol>
      {slow && (
        <p className="mt-4 text-sm text-muted">Waking the server… this can take up to a minute.</p>
      )}
    </section>
  );
}

export function ResultStep({
  outcome,
  onRetry,
  onDone,
}: {
  outcome: SetupOutcome;
  onRetry: () => void;
  onDone: () => void;
}) {
  return (
    <section className="card px-6 py-6">
      <h2 className="text-lg font-semibold">
        {outcome.ok ? '✓ ' : ''}
        {outcome.title}
      </h2>
      <p className="mt-2 text-muted">{outcome.detail}</p>
      <div className="mt-5 flex gap-2">
        {outcome.backTo && (
          <button type="button" className="btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className={outcome.backTo ? 'btn' : 'btn-primary'} onClick={onDone}>
          {outcome.ok ? 'Go to Sleep' : 'Done'}
        </button>
      </div>
    </section>
  );
}
