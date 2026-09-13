import React from 'react';
import { adminGet, adminSend } from '../../lib/adminApi';
import { Loading, Failed, Empty, NoPermission, PageHeading, StatusTag, Money, useRemote } from './primitives';

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * Returns and refunds.
 *
 * A case moves REQUESTED → PROCESSING → APPROVED/REJECTED → REFUNDED, and the
 * money only moves on the last step. The amount is shown and editable before
 * refunding because a partial refund — the missing side dish rather than the
 * whole order — is the common case, and getting it wrong takes real money from
 * a restaurant or gives it away.
 */
export const RefundsSection: React.FC = () => {
  const [status, setStatus] = React.useState('REQUESTED');
  const query = status === 'ALL' ? '' : `?status=${status}`;
  const { data, error, denied, loading, reload } = useRemote<any>(
    () => adminGet<any>(`/admin/refund-requests${query}`),
    [query]
  );

  const [open, setOpen] = React.useState<any | null>(null);
  const [amount, setAmount] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const start = (request: any) => {
    setOpen(request);
    setAmount(String(request.requestedAmount ?? request.amount ?? ''));
    setNote('');
    setActionError(null);
  };

  const decide = async (action: 'PROCESSING' | 'APPROVE' | 'REJECT' | 'REFUND') => {
    if (!open) return;
    if ((action === 'REJECT' || action === 'REFUND') && note.trim().length < 4) {
      setActionError('Record why — the customer and the restaurant both see this decision.');
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      await adminSend(`/admin/refund-requests/${open.id}/decision`, 'POST', {
        action,
        amount: action === 'REFUND' || action === 'APPROVE' ? Number(amount) || undefined : undefined,
        note: note.trim() || undefined
      });
      setOpen(null);
      reload();
    } catch (err: any) {
      setActionError(err?.message || 'Could not record that decision.');
    } finally {
      setBusy(false);
    }
  };

  if (denied) return <NoPermission section="returns and refunds" />;

  const requests = data?.requests || [];
  const counts = data?.counts || {};

  return (
    <>
      <PageHeading
        title="Returns and refunds"
        sub={
          counts.requested !== undefined
            ? `${counts.requested} waiting · ${counts.processing} in progress · ${counts.refunded} refunded`
            : undefined
        }
        actions={
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="REQUESTED">Waiting</option>
            <option value="PROCESSING">In progress</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="REFUNDED">Refunded</option>
            <option value="ALL">All</option>
          </select>
        }
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <Failed message={error} onRetry={reload} />
      ) : !requests.length ? (
        <Empty
          title={status === 'REQUESTED' ? 'Nothing waiting' : 'No cases'}
          body="Returns raised by customers or riders appear here for a decision."
        />
      ) : (
        <div className="card-list">
          {requests.map((r: any) => (
            <article className="review-card" key={r.id}>
              <header>
                <div>
                  <h3>{r.orderNumber || r.orderId}</h3>
                  <p className="muted">
                    {r.raisedByName || r.customerName || r.userId} · {when(r.createdAt || r.raisedAt)}
                  </p>
                </div>
                <StatusTag status={r.status} />
              </header>

              <p className="review-price">
                <Money value={r.requestedAmount ?? r.amount ?? 0} />
              </p>
              <p className="review-desc">{r.reason || r.description}</p>

              {!!r.resolutionNote && <p className="muted small">Decision: {r.resolutionNote}</p>}
              {typeof r.refundedAmount === 'number' && r.refundedAmount > 0 && (
                <p className="muted small">
                  Refunded <Money value={r.refundedAmount} /> on {when(r.refundedAt)}
                </p>
              )}

              {!['REFUNDED', 'REJECTED'].includes(r.status) && (
                <footer>
                  <button className="btn btn-primary" onClick={() => start(r)}>
                    Decide
                  </button>
                </footer>
              )}
            </article>
          ))}
        </div>
      )}

      {!!open && (
        <div className="drawer-backdrop" onClick={() => !busy && setOpen(null)}>
          <aside className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>{open.orderNumber || 'Refund case'}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(null)} disabled={busy}>
                Close
              </button>
            </div>
            <div className="drawer-body">
              <StatusTag status={open.status} />
              <p className="review-desc">{open.reason || open.description}</p>

              {!!actionError && <div className="inline-error">{actionError}</div>}

              <label className="field">
                <span>Amount to refund (₹)</span>
                <input
                  className="input"
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
                <small className="muted">
                  A partial refund is normal — refund only what the customer did not receive.
                </small>
              </label>

              <label className="field">
                <span>Decision note</span>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="What was agreed, and why."
                  value={note}
                  onChange={e => setNote(e.target.value)}
                />
              </label>

              {open.status === 'REQUESTED' && (
                <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => decide('PROCESSING')}>
                  Mark as being looked into
                </button>
              )}

              <button
                className="btn btn-primary btn-block"
                disabled={busy}
                onClick={() => decide('REFUND')}
                style={{ marginTop: 8 }}
              >
                {busy ? 'Working…' : 'Refund this amount'}
              </button>

              <hr className="rule" />

              <button className="btn btn-danger btn-block" disabled={busy} onClick={() => decide('REJECT')}>
                Reject the claim
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};
