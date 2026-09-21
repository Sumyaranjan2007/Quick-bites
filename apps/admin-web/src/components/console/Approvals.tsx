import React from 'react';
import {
  fetchMenuRequests,
  reviewMenuRequest,
  fetchDocuments,
  fetchProfileEdits,
  reviewProfileEdit,
  adminSend
} from '../../lib/adminApi';
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


/* ===================================================================
 * Partner profile changes
 * =================================================================== */

/** Server field names, in the words a reviewer reads. */
const PROFILE_FIELD_WORD: Record<string, string> = {
  name: 'Restaurant name',
  description: 'About',
  phone: 'Phone number',
  addressLine: 'Address',
  city: 'City',
  pincode: 'Pincode',
  coordinates: 'Map pin',
  cuisineTags: 'Cuisines',
  costForTwo: 'Cost for two',
  bannerUrl: 'Cover photo',
  galleryUrls: 'Photos',
  openingHours: 'Opening hours'
};

const isImageField = (field: string) => field === 'bannerUrl' || field === 'galleryUrls';

/** Renders a value the way a person can judge it, not the way it is stored. */
const ProfileValue: React.FC<{ field: string; value: any }> = ({ field, value }) => {
  if (value === undefined || value === null || value === '') {
    return <span className="muted">not set</span>;
  }

  if (field === 'bannerUrl') {
    return <img src={String(value)} alt="" className="review-image" />;
  }

  if (field === 'galleryUrls') {
    const list = Array.isArray(value) ? value : [];
    if (!list.length) return <span className="muted">none</span>;
    return (
      <div className="review-image-row">
        {list.map((uri: string, i: number) => (
          <img key={i} src={uri} alt="" className="review-image review-image-small" />
        ))}
      </div>
    );
  }

  if (field === 'openingHours') {
    const week = (value?.week || {}) as Record<string, Array<{ opensAt: number; closesAt: number }>>;
    const clock = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const days = Object.keys(week);
    if (!days.length) return <span className="muted">not declared</span>;
    return (
      <ul className="plain-list">
        {days.map(d => (
          <li key={d}>
            <strong>{d[0] + d.slice(1).toLowerCase()}</strong>:{' '}
            {week[d].length
              ? week[d].map(w => `${clock(w.opensAt)}–${clock(w.closesAt)}`).join(', ')
              : 'closed'}
          </li>
        ))}
      </ul>
    );
  }

  if (field === 'coordinates') {
    return (
      <span className="mono">
        {Number(value.latitude).toFixed(5)}, {Number(value.longitude).toFixed(5)}
      </span>
    );
  }

  if (Array.isArray(value)) return <span>{value.join(', ')}</span>;
  return <span>{String(value)}</span>;
};

/**
 * Partner-submitted changes to how a restaurant appears to customers.
 *
 * Everything a customer sees passes a human, and this is that human. The live
 * restaurant has not moved: what is here is what the partner has ASKED it to
 * become, and approving is the only thing that writes it.
 *
 * Reviewed field by field on purpose. A partner who corrected their opening
 * hours and also uploaded a bad photograph should keep the hours — forcing an
 * all-or-nothing decision means they lose the correction and have to send both
 * again, and the reviewer sees the same submission twice.
 *
 * The server refuses a review that leaves any changed field undecided, so this
 * screen will not let one be submitted either: the button stays disabled and
 * says how many are left. Being refused by the server after clicking Approve is
 * a worse version of the same rule.
 */
export const ProfileApprovals: React.FC = () => {
  const [status, setStatus] = React.useState('PENDING');
  const { data, error, denied, loading, reload } = useRemote<any>(() => fetchProfileEdits(status), [status]);

  // field -> 'APPROVE' | 'REJECT', per submission.
  const [decisions, setDecisions] = React.useState<Record<string, Record<string, string>>>({});
  const [reasons, setReasons] = React.useState<Record<string, Record<string, string>>>({});
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const decide = (editId: string, field: string, verdict: string) =>
    setDecisions(d => ({ ...d, [editId]: { ...(d[editId] || {}), [field]: verdict } }));

  const setReason = (editId: string, field: string, reason: string) =>
    setReasons(r => ({ ...r, [editId]: { ...(r[editId] || {}), [field]: reason } }));

  const submit = async (edit: any) => {
    const chosen = decisions[edit.id] || {};
    const approve = edit.fields.filter((f: string) => chosen[f] === 'APPROVE');
    const reject = edit.fields
      .filter((f: string) => chosen[f] === 'REJECT')
      .map((f: string) => ({ field: f, reason: (reasons[edit.id]?.[f] || '').trim() }));

    const missingReason = reject.find((r: any) => r.reason.length < 4);
    if (missingReason) {
      setActionError(
        `Say why "${PROFILE_FIELD_WORD[missingReason.field] ?? missingReason.field}" was refused — the partner has to know what to fix.`
      );
      return;
    }

    setBusyId(edit.id);
    setActionError(null);
    try {
      await reviewProfileEdit(edit.id, { approve, reject });
      setDecisions(d => ({ ...d, [edit.id]: {} }));
      setReasons(r => ({ ...r, [edit.id]: {} }));
      reload();
    } catch (err: any) {
      setActionError(err?.message || 'Could not record that decision.');
    } finally {
      setBusyId(null);
    }
  };

  if (denied) return <NoPermission section="restaurant approvals" />;

  const edits = data?.edits || [];

  return (
    <>
      <PageHeading
        title="Profile changes"
        sub="What partners have asked to change about how they appear"
        actions={
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="PENDING">Awaiting review</option>
            <option value="APPROVED">Approved</option>
            <option value="PARTIALLY_APPROVED">Partly approved</option>
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
      ) : !edits.length ? (
        <Empty
          title="Nothing waiting"
          body="When a partner changes their photos, name, hours or address, it appears here before any customer sees it."
        />
      ) : (
        <div className="card-list">
          {edits.map((edit: any) => {
            const chosen = decisions[edit.id] || {};
            const undecided = edit.fields.filter((f: string) => !chosen[f]);
            const settled = edit.status !== 'PENDING';

            return (
              <article className="review-card" key={edit.id}>
                <header>
                  <div>
                    <h3>{edit.restaurantName}</h3>
                    <p className="muted">
                      {edit.city ? `${edit.city} · ` : ''}
                      {edit.fields.length} change{edit.fields.length === 1 ? '' : 's'} · {when(edit.submittedAt)}
                    </p>
                  </div>
                  <StatusTag status={edit.status} />
                </header>

                {/* A kitchen that is already trading has customers looking at
                    the old values right now; one that is not is usually
                    completing its first profile. It changes the decision. */}
                {edit.restaurantStatus !== 'ACTIVE' && (
                  <p className="warn-text">
                    This restaurant is {String(edit.restaurantStatus).replace(/_/g, ' ').toLowerCase()} and is
                    not trading yet.
                  </p>
                )}
                {edit.affectsListing && (
                  <p className="warn-text">
                    This changes where the restaurant is, so it changes which customers can order from it.
                  </p>
                )}

                {edit.fields.map((field: string) => (
                  <section className="field-review" key={field}>
                    <h4>{PROFILE_FIELD_WORD[field] ?? field}</h4>

                    <div className={isImageField(field) ? 'before-after stacked' : 'before-after'}>
                      <div>
                        <span className="muted">Now</span>
                        <ProfileValue field={field} value={edit.previous?.[field]} />
                      </div>
                      <div>
                        <span className="muted">Asked for</span>
                        <ProfileValue field={field} value={edit.changes?.[field]} />
                      </div>
                    </div>

                    {settled ? (
                      <p className="muted">
                        {(edit.approvedFields || []).includes(field)
                          ? 'Approved'
                          : (edit.rejections || []).find((r: any) => r.field === field)?.reason ||
                            'Not approved'}
                      </p>
                    ) : (
                      <div className="field-actions">
                        <button
                          className={`btn ${chosen[field] === 'APPROVE' ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => decide(edit.id, field, 'APPROVE')}
                        >
                          Approve
                        </button>
                        <button
                          className={`btn ${chosen[field] === 'REJECT' ? 'btn-danger' : 'btn-ghost'}`}
                          onClick={() => decide(edit.id, field, 'REJECT')}
                        >
                          Refuse
                        </button>
                        {chosen[field] === 'REJECT' && (
                          <input
                            className="input"
                            placeholder="Why? The partner sees this."
                            value={reasons[edit.id]?.[field] || ''}
                            onChange={e => setReason(edit.id, field, e.target.value)}
                          />
                        )}
                      </div>
                    )}
                  </section>
                ))}

                {!settled && (
                  <footer className="review-actions">
                    <button
                      className="btn btn-ghost"
                      onClick={() =>
                        setDecisions(d => ({
                          ...d,
                          [edit.id]: Object.fromEntries(edit.fields.map((f: string) => [f, 'APPROVE']))
                        }))
                      }
                    >
                      Approve all
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busyId === edit.id || undecided.length > 0}
                      onClick={() => submit(edit)}
                    >
                      {busyId === edit.id
                        ? 'Saving…'
                        : undecided.length > 0
                          ? `${undecided.length} still to decide`
                          : 'Record decision'}
                    </button>
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
};
