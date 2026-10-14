import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../services/api';
import { AppFooter } from '../components/layout/AppFooter';

export function LoginPage() {
  const { login, status, expired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status === 'authenticated')
    return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <p className="text-center text-2xl font-semibold tracking-[0.3em] text-paper-50">
            PRAMAAN
          </p>
          <p className="mt-1 text-center text-xs text-paper-200/80">
            Cryptographic proof-of-presence review · academic prototype
          </p>
          <form
            onSubmit={submit}
            className="mt-8 rounded-lg bg-white p-6 shadow-xl"
            aria-labelledby="login-title"
          >
            <h1 id="login-title" className="text-base font-semibold text-ink-950">
              Supervisor sign-in
            </h1>
            {expired && (
              <p role="status" className="mt-3 rounded bg-amber-50 p-2 text-sm text-signal-warn">
                Your session expired. Please sign in again.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-signal-bad">
                {error}
              </p>
            )}
            <label className="mt-4 block text-sm font-medium text-ink-900" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              className="input mt-1 w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label className="mt-3 block text-sm font-medium text-ink-900" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="input mt-1 w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="mt-4 text-xs text-ink-700">
              Officer accounts sign in on registered duty devices, not here.
            </p>
          </form>
        </div>
      </main>
      <div className="bg-paper-50">
        <AppFooter />
      </div>
    </div>
  );
}
