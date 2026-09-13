import React from 'react';

/**
 * Small shared pieces for the console.
 *
 * Every section loads remote data, so each needs the same three states — loading,
 * failed, empty — and each needs the same way of saying "your role does not cover
 * this". Writing them once keeps a 403 from being rendered as a crash in one
 * section and a blank table in another.
 */

export const Money: React.FC<{ value: number; compact?: boolean }> = ({ value, compact }) => (
  <>
    {'₹'}
    {(Number(value) || 0).toLocaleString('en-IN', {
      maximumFractionDigits: compact ? 0 : 2,
      minimumFractionDigits: compact ? 0 : 2
    })}
  </>
);

export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: 'default' | 'brand' | 'good' | 'bad';
}> = ({ label, value, sub, tone = 'default' }) => (
  <div className={`stat-card stat-${tone}`}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {!!sub && <div className="stat-sub">{sub}</div>}
  </div>
);

export const StatusTag: React.FC<{ status: string }> = ({ status }) => {
  const s = String(status || '').toUpperCase();
  const tone = s.includes('DELIVER')
    ? 'good'
    : s.includes('CANCEL') || s.includes('REJECT') || s.includes('FAIL')
      ? 'bad'
      : s.includes('PENDING') || s.includes('OPEN') || s.includes('REVIEW')
        ? 'warn'
        : 'neutral';
  return <span className={`tag tag-${tone}`}>{s.replace(/_/g, ' ')}</span>;
};

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading' }) => (
  <div className="state-block">
    <div className="spinner" />
    <p>{label}…</p>
  </div>
);

export const Failed: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="state-block state-error">
    <p>{message}</p>
    {!!onRetry && (
      <button className="btn btn-ghost" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);

export const Empty: React.FC<{ title: string; body?: string }> = ({ title, body }) => (
  <div className="state-block">
    <p className="state-title">{title}</p>
    {!!body && <p className="state-body">{body}</p>}
  </div>
);

/** Shown where a section would be, when the signed-in role does not cover it. */
export const NoPermission: React.FC<{ section: string }> = ({ section }) => (
  <div className="state-block state-locked">
    <p className="state-title">You do not have access to {section}</p>
    <p className="state-body">
      Your administrator role does not include this permission. A Super Admin can grant it from Roles &amp;
      Access.
    </p>
  </div>
);

export const PageHeading: React.FC<{ title: string; sub?: string; actions?: React.ReactNode }> = ({
  title,
  sub,
  actions
}) => (
  <div className="page-heading">
    <div>
      <h1>{title}</h1>
      {!!sub && <p>{sub}</p>}
    </div>
    {!!actions && <div className="page-actions">{actions}</div>}
  </div>
);

/**
 * Wraps a section's async load so the three states are handled identically
 * everywhere, including a 403, which is an answer rather than a failure.
 */
export function useRemote<T>(loader: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [denied, setDenied] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const run = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      setData(await loader());
    } catch (err: any) {
      if (err?.name === 'PermissionError') setDenied(true);
      else setError(err?.message || 'Could not load this section.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  React.useEffect(() => {
    run();
  }, [run]);

  return { data, error, denied, loading, reload: run };
}
