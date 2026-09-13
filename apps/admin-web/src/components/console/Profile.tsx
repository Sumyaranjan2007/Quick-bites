import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { API_BASE, type AdminAccess } from '../../lib/adminApi';
import { apiFetch } from '../../lib/apiFetch';
import { authHeaders } from '../../lib/session';
import { PageHeading } from './primitives';

/**
 * The operator's own account.
 *
 * Changing a password requires the current one even though the caller is already
 * signed in — an unattended console on a desk should not be enough to lock its
 * owner out. That rule lives on the server; this screen simply asks for it.
 */
export const ProfileSection: React.FC<{ access: AdminAccess | null }> = ({ access }) => {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (next.length < 8) {
      setError('Choose a password of at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('The new password and its confirmation do not match.');
      return;
    }
    if (next === current) {
      setError('The new password must be different from the current one.');
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || payload?.success === false) {
        setError(payload?.error?.message || payload?.error || 'Your password could not be changed.');
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch {
      setError('Could not reach Quick Bites. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeading title="Your account" sub={access?.user.email} />

      <section className="panel">
        <h2>Who you are</h2>
        <dl className="kv">
          <div><dt>Name</dt><dd>{access?.user.fullName}</dd></div>
          <div><dt>Email</dt><dd>{access?.user.email}</dd></div>
          <div>
            <dt>Role</dt>
            <dd>{access?.isSuperAdmin ? 'Super Admin' : access?.role?.name || access?.user.role}</dd>
          </div>
          <div>
            <dt>Permissions</dt>
            <dd>
              {access?.isSuperAdmin ? 'Every permission' : `${access?.permissions.length ?? 0} granted`}
            </dd>
          </div>
        </dl>

        {!access?.isSuperAdmin && !!access?.permissions.length && (
          <details className="perm-details">
            <summary>See what your role covers</summary>
            <ul className="perm-list">
              {access.permissions.map(p => (
                <li key={p} className="mono small">
                  {p}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="panel" style={{ maxWidth: 460 }}>
        <h2>Change your password</h2>

        {done && <div className="inline-ok">Your password has been changed.</div>}
        {!!error && <div className="inline-error">{error}</div>}

        <form onSubmit={submit}>
          <label className="field">
            <span>Current password</span>
            <div className="password-wrap">
              <input
                className="input"
                type={show ? 'text' : 'password'}
                value={current}
                autoComplete="current-password"
                onChange={e => setCurrent(e.target.value)}
                required
              />
            </div>
          </label>

          <label className="field">
            <span>New password</span>
            <div className="password-wrap">
              <input
                className="input"
                type={show ? 'text' : 'password'}
                value={next}
                autoComplete="new-password"
                onChange={e => setNext(e.target.value)}
                required
              />
              <button
                type="button"
                className="password-eye"
                onClick={() => setShow(s => !s)}
                aria-label={show ? 'Hide passwords' : 'Show passwords'}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          <label className="field">
            <span>Confirm new password</span>
            <div className="password-wrap">
              <input
                className="input"
                type={show ? 'text' : 'password'}
                value={confirm}
                autoComplete="new-password"
                onChange={e => setConfirm(e.target.value)}
                required
              />
            </div>
          </label>

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>
    </>
  );
};
