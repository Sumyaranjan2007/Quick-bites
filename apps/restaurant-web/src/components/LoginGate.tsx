import React, { useState } from 'react';
import { Store } from 'lucide-react';
import { login } from '../api';
import { getSession } from '../lib/session';

/**
 * Stands in front of the kitchen console until the partner signs in. The portal
 * previously had no sign-in step — it authenticated itself with credentials baked into
 * the bundle, so opening the URL exposed a live restaurant's orders and menu.
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
          <Store size={28} />
          <div>
            <h1>Quick Bites Partner</h1>
            <p>Sign in to manage your kitchen</p>
          </div>
        </div>

        <label htmlFor="partner-email">Registered email</label>
        <input
          id="partner-email"
          type="email"
          value={email}
          autoComplete="username"
          required
          onChange={e => setEmail(e.target.value)}
        />

        <label htmlFor="partner-password">Password</label>
        <input
          id="partner-password"
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
