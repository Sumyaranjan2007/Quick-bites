import React from 'react';
import { fetchMenuRequests, reviewMenuRequest, fetchDocuments, adminSend } from '../../lib/adminApi';
import { Loading, Failed, Empty, NoPermission, PageHeading, StatusTag, Money, useRemote } from './primitives';

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * Partner menu requests.
 *
 * Approving writes the dish onto the live menu, so the reviewer can correct the
 * values first — a mispriced submission is fixed here rather than bounced back
 * and retyped. Rejecting requires a reason, because the partner has to know what
 * to change.
 */
export const MenuApprovals: React.FC = () => {
  const [status, setStatus] = React.useState('PENDING');
  const { data, error, denied, loading, reload } = useRemote<any>(() => fetchMenuRequests(status), [status]);

  const [editing, setEditing] = React.useState<any | null>(null);
  const [overrides, setOverrides] = React.useState<Record<string, any>>({});
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const open = (req: any) => {
    setEditing(req);
    setOverrides({ ...req.payload });
    setReason('');
    setActionError(null);
  };

  const decide = async (action: 'APPROVE' | 'REJECT') => {
    if (!editing) return;
    if (action === 'REJECT' && reason.trim().length < 4) {
      setActionError('Tell the partner why, so they can correct it.');
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      const changed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== (editing.payload as any)[k]) changed[k] = k === 'price' ? Number(v) : v;
      }
      await reviewMenuRequest(editing.id, {
        action,
        rejectionReason: action === 'REJECT' ? reason.trim() : undefined,
        overrides: action === 'APPROVE' && Object.keys(changed).length ? changed : undefined
      });
      setEditing(null);
      reload();
    } catch (err: any) {
      setActionError(err?.message || 'Could not record that decision.');
    } finally {
      setBusy(false);
    }
  };

  if (denied) return <NoPermission section="menu approvals" />;

  const requests = data?.requests || [];

  return (
    <>
      <PageHeading
        title="Menu approvals"
        sub="Partner requests to add or change a dish"
        actions={
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="PENDING">Awaiting review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
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
          title={status === 'PENDING' ? 'Nothing waiting' : 'No requests'}
          body={status === 'PENDING' ? 'Partner menu requests appear here for review.' : undefined}
        />
      ) : (
        <div className="card-list">
          {requests.map((r: any) => (
            <article className="review-card" key={r.id}>
              <header>
                <div>
                  <h3>{r.payload.name}</h3>
                  <p className="muted">
                    {r.restaurantName || r.restaurantId} · {r.payload.categoryName} ·{' '}
                    {r.payload.isVeg ? 'Veg' : 'Non-veg'}
                  </p>
                </div>
                <StatusTag status={r.status} />
              </header>

              <p className="review-price">
                <Money value={r.payload.price} />
              </p>
              {!!r.payload.description && <p className="review-desc">{r.payload.description}</p>}
              <p className="muted small">Submitted {when(r.submittedAt)}</p>

              {r.status === 'REJECTED' && !!r.rejectionReason && (
                <p className="reject-note">Rejected: {r.rejectionReason}</p>
              )}

              {r.status === 'PENDING' && (
                <footer>
                  <button className="btn btn-primary" onClick={() => open(r)}>
                    Review
                  </button>
                </footer>
              )}
            </article>
          ))}
        </div>
      )}

      {!!editing && (
        <div className="drawer-backdrop" onClick={() => !busy && setEditing(null)}>
          <aside className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>Review dish</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} disabled={busy}>
                Close
              </button>
            </div>
            <div className="drawer-body">
              <p className="muted">
                Correct anything that is wrong before approving. What you save here is what goes on the menu.
              </p>

              {!!actionError && <div className="inline-error">{actionError}</div>}

              <label className="field">
                <span>Name</span>
                <input
                  className="input"
                  value={overrides.name ?? ''}
                  onChange={e => setOverrides(o => ({ ...o, name: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Menu section</span>
                <input
                  className="input"
                  value={overrides.categoryName ?? ''}
                  onChange={e => setOverrides(o => ({ ...o, categoryName: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Price (₹)</span>
                <input
                  className="input"
                  type="number"
                  value={overrides.price ?? ''}
                  onChange={e => setOverrides(o => ({ ...o, price: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea
                  className="input"
                  rows={3}
                  value={overrides.description ?? ''}
                  onChange={e => setOverrides(o => ({ ...o, description: e.target.value }))}
                />
              </label>
              <label className="field field-inline">
                <input
                  type="checkbox"
                  checked={Boolean(overrides.isVeg)}
                  onChange={e => setOverrides(o => ({ ...o, isVeg: e.target.checked }))}
                />
                <span>Vegetarian</span>
              </label>

              <button className="btn btn-primary btn-block" disabled={busy} onClick={() => decide('APPROVE')}>
                {busy ? 'Saving…' : 'Approve and publish'}
              </button>

              <hr className="rule" />

              <label className="field">
                <span>Reason for rejection</span>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="The licence photo is unreadable / this price looks like a typo"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </label>
              <button className="btn btn-danger btn-block" disabled={busy} onClick={() => decide('REJECT')}>
                Reject
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};

/** Restaurant and rider verification documents awaiting a decision. */
export const DocumentReview: React.FC = () => {
  const [status, setStatus] = React.useState('PENDING');
  const { data, error, denied, loading, reload } = useRemote<any>(() => fetchDocuments(status), [status]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const decide = async (documentId: string, decision: 'APPROVE' | 'REJECT') => {
    let rejectionReason: string | undefined;
    if (decision === 'REJECT') {
      const entered = window.prompt('Why is this being rejected? The partner sees this.');
      if (!entered || entered.trim().length < 4) return;
      rejectionReason = entered.trim();
    }

    setBusyId(documentId);
    setActionError(null);
    try {
      // The server takes `action`, not a status — verified against the handler.
      await adminSend('/admin/documents/review', 'POST', {
        documentId,
        action: decision,
        rejectionReason
      });
      reload();
    } catch (err: any) {
      setActionError(err?.message || 'Could not record that decision.');
    } finally {
      setBusyId(null);
    }
  };

  if (denied) return <NoPermission section="documents" />;

  const documents = data?.documents || [];

  return (
    <>
      <PageHeading
        title="Documents"
        sub="Restaurant and rider verification"
        actions={
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="PENDING">Awaiting review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="ALL">All</option>
          </select>
        }
      />

      {!!actionError && <div className="inline-error">{actionError}</div>}

      {loading ? (
        <Loading />
      ) : error ? (
        <Failed message={error} onRetry={reload} />
      ) : !documents.length ? (
        <Empty title="Nothing waiting" body="Submitted documents appear here for verification." />
      ) : (
        <div className="card-list">
          {documents.map((d: any) => (
            <article className="review-card" key={d.id}>
              <header>
                <div>
                  <h3>{d.entityName || d.entityId}</h3>
                  <p className="muted">
                    {String(d.documentType).replace(/_/g, ' ')} ·{' '}
                    {d.entityType === 'RESTAURANT' ? 'Restaurant' : 'Delivery rider'}
                  </p>
                </div>
                <StatusTag status={d.status} />
              </header>

              <dl className="kv">
                <div>
                  <dt>Number</dt>
                  <dd className="mono">
                    {d.documentNumber || <span className="warn-text">not provided — read it from the file</span>}
                  </dd>
                </div>
                <div><dt>Submitted</dt><dd>{when(d.submittedAt)}</dd></div>
                {!!d.entityCity && <div><dt>City</dt><dd>{d.entityCity}</dd></div>}
                {!!d.entityPhone && <div><dt>Phone</dt><dd>{d.entityPhone}</dd></div>}
                <div>
                  <dt>File</dt>
                  <dd>
                    {/*
                      THE DOCUMENT ITSELF, not a description of it.

                      This printed `fileUrl` as monospace text. That was almost
                      readable while partners were sending a sentence about an
                      email — and became a wall of base64 the moment the apps
                      started sending the actual photograph, which is roughly
                      half a megabyte of it. A reviewer approving a food licence
                      has to be able to READ the licence.
                    */}
                    {!d.fileUrl ? (
                      <span className="warn-text">no file attached</span>
                    ) : /^(data:image\/|https?:\/\/)/.test(d.fileUrl) ? (
                      <a href={d.fileUrl} target="_blank" rel="noreferrer noopener">
                        <img className="doc-scan" src={d.fileUrl} alt={`${d.documentType} submitted for review`} />
                      </a>
                    ) : (
                      // Anything else predates the upload control and is prose
                      // somebody typed. Say so, rather than rendering a broken
                      // image and leaving the reviewer to guess.
                      <span className="warn-text">
                        No photograph — the partner sent a note: &ldquo;{String(d.fileUrl).slice(0, 120)}&rdquo;
                      </span>
                    )}
                  </dd>
                </div>
              </dl>

              {d.status === 'REJECTED' && !!d.rejectionReason && (
                <p className="reject-note">Rejected: {d.rejectionReason}</p>
              )}

              {d.status === 'PENDING' && (
                <footer>
                  <button
                    className="btn btn-ghost"
                    disabled={busyId === d.id}
                    onClick={() => decide(d.id, 'REJECT')}
                  >
                    Reject
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busyId === d.id}
                    onClick={() => decide(d.id, 'APPROVE')}
                  >
                    {busyId === d.id ? 'Saving…' : 'Approve'}
                  </button>
                </footer>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
};
