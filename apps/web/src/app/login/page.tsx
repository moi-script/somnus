'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken } from '@/lib/api';
import { signupProblem } from '@/lib/signup';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';

type Mode = 'login' | 'register';

const MODES: { id: Mode; label: string }[] = [
  { id: 'login', label: 'Sign in' },
  { id: 'register', label: 'Create account' },
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'register') {
      const problem = signupProblem(password, confirm);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    try {
      const res = mode === 'login' ? await api.login(email, password) : await api.register(email, password);
      setToken(res.token);
      router.push('/home/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    setConfirm('');
    setError(null);
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icon.png" alt="" className="mx-auto h-16 w-16 rounded-2xl shadow-glow" />
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Somnus</h1>
          <p className="mt-1 text-muted">Sleep, heart and room, in one place</p>
        </div>

        <section className="card px-5 py-6">
          <SegmentedTabs tabs={MODES} active={mode} onChange={switchMode} />

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm text-muted">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm text-muted">
                Password
              </label>
              <div className="flex gap-2">
                <input
                  id="password"
                  type={show ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="field flex-1"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" className="btn shrink-0" onClick={() => setShow((s) => !s)}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              {mode === 'register' && <p className="mt-1 text-sm text-muted">At least 8 characters.</p>}
            </div>

            {mode === 'register' && (
              <div>
                <label htmlFor="confirm" className="mb-1 block text-sm text-muted">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type={show ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  className="field"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
            )}

            {error && (
              <p className="rounded-2xl border border-alarm/30 bg-alarm/10 px-3 py-2 text-sm text-alarm" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy
                ? mode === 'login'
                  ? 'Signing in…'
                  : 'Creating account…'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </form>
        </section>

        <p className="mt-6 text-center text-xs text-muted">
          A research project, not a medical device.
        </p>
      </div>
    </main>
  );
}
