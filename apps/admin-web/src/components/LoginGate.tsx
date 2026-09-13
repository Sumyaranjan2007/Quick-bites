import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { login } from '../api';
import { getSession } from '../lib/session';

/**
 * Stands in front of the console until someone signs in. The portal previously had no
 * sign-in step at all — it authenticated itself with credentials baked into the bundle,
 * so opening the URL was enough to reach every admin action.
 */
export const LoginGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSessionState] = useState(() => getSession());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setSessionState(await login(email.trim(), password));
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-gate">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <ShieldCheck size={28} />
          <div>
            <h1>Quick Bites Admin</h1>
            <p>Operations console — authorised staff only</p>
          </div>
        </div>

        <label htmlFor="admin-email">Work email</label>
        <input
          id="admin-email"
          type="email"
          value={email}
          autoComplete="username"
          required
          onChange={e => setEmail(e.target.value)}
        />

        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          value={password}
          autoComplete="current-password"
          required
          onChange={e => setPassword(e.target.value)}
        />

        {error && <div className="login-error" role="alert">{error}</div>}

        <button type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};
