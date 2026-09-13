import React from 'react';
import { fetchRoles, fetchAdmins, fetchAuditLog, fetchSupportTickets, adminSend, type AdminAccess } from '../../lib/adminApi';
import { Loading, Failed, Empty, NoPermission, PageHeading, StatusTag, useRemote } from './primitives';

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * Complaints and questions from all four apps.
 *
 * Read-only here beyond replying: a refund is issued from the order, not from a
 * conversation about it, so the two stay separate and the money has one path.
 */
export const SupportSection: React.FC = () => {
  const [status, setStatus] = React.useState('');
  const query = status ? `?status=${status}` : '';
  const { data, error, denied, loading, reload } = useRemote<any>(() => fetchSupportTickets(query), [query]);

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [reply, setReply] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const send = async (id: string) => {
    if (reply.trim().length < 2) return;
    setBusy(true);
    setActionError(null);
    try {
      await adminSend(`/admin/support/tickets/${id}/reply`, 'POST', { body: reply.trim() });
      setReply('');
      setOpenId(null);
      reload();
    } catch (err: any) {
      setActionError(err?.message || 'Could not send that reply.');
    } finally {
      setBusy(false);
    }
  };

  if (denied) return <NoPermission section="support" />;

  const tickets = data?.tickets || [];

  return (
    <>
      <PageHeading
        title="Support"
        sub="Raised from the customer, partner and rider apps"
        actions={
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Every status</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        }
      />

      {!!actionError && <div className="inline-error">{actionError}</div>}

      {loading ? (
        <Loading />
      ) : error ? (
        <Failed message={error} onRetry={reload} />
      ) : !tickets.length ? (
        <Empty title="Nothing open" body="Messages from any of the apps appear here." />
      ) : (
        <div className="card-list">
          {tickets.map((t: any) => (
            <article className="review-card" key={t.id}>
              <header>
                <div>
                  <h3>{t.subject}</h3>
                  <p className="muted">
                    {String(t.category).replace(/_/g, ' ')} · {t.raisedByName || t.userId} · {when(t.createdAt)}
                  </p>
                </div>
                <StatusTag status={t.status} />
              </header>

              <p className="review-desc">{t.message}</p>

              {(t.replies || []).map((r: any, i: number) => (
                <div className="reply" key={i}>
                  <strong>{r.authorName || (r.authorRole === 'admin' ? 'Support' : 'Them')}</strong>
                  <span>{r.body}</span>
                  <em>{when(r.sentAt || r.createdAt)}</em>
                </div>
              ))}

              <footer>
                {openId === t.id ? (
                  <>
                    <textarea
                      className="input"
                      rows={2}
                      placeholder="Reply to them"
                      value={reply}
                      onChange={e => setReply(e.target.value)}
                    />
                    <button className="btn btn-primary" disabled={busy} onClick={() => send(t.id)}>
                      {busy ? 'Sending…' : 'Send'}
                    </button>
                    <button className="btn btn-ghost" onClick={() => setOpenId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn btn-ghost" onClick={() => { setOpenId(t.id); setReply(''); }}>
                    Reply
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </>
  );
};

/**
 * Roles, administrators, and the record of what they did.
 *
 * A Super Admin holds every permission implicitly and is the only role that can
 * change these, which is why the section is gated on the server as well as here.
 */
export const AccessSection: React.FC<{ access: AdminAccess | null }> = ({ access }) => {
  const roles = useRemote<any>(fetchRoles);
  const admins = useRemote<any>(fetchAdmins);
  const audit = useRemote<any>(fetchAuditLog);

  if (roles.denied && admins.denied) return <NoPermission section="roles and access" />;

  return (
    <>
      <PageHeading
        title="Roles and access"
        sub={
          access?.isSuperAdmin
            ? 'You are a Super Admin — every permission, including changing these.'
            : `Signed in as ${access?.role?.name || access?.user.role}`
        }
      />

      <section className="panel">
        <h2>Roles</h2>
        {roles.loading ? (
          <Loading />
        ) : roles.denied ? (
          <NoPermission section="roles" />
        ) : roles.error ? (
          <Failed message={roles.error} onRetry={roles.reload} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Key</th>
                  <th>Permissions</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(roles.data?.roles || []).map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {r.isSystem && <span className="muted small"> · built in</span>}
                    </td>
                    <td className="mono small">{r.key}</td>
                    <td>
                      {r.key === 'super_admin' || r.isSuperAdmin ? (
                        <span className="tag tag-good">every permission</span>
                      ) : (
                        `${(r.permissions || []).length} granted`
                      )}
                    </td>
                    <td>
                      <StatusTag status={r.isActive === false ? 'DISABLED' : 'ACTIVE'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Administrators</h2>
        {admins.loading ? (
          <Loading />
        ) : admins.denied ? (
          <NoPermission section="administrator accounts" />
        ) : admins.error ? (
          <Failed message={admins.error} onRetry={admins.reload} />
        ) : !(admins.data?.admins || []).length ? (
          <Empty title="No administrators listed" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {(admins.data?.admins || []).map((a: any) => (
                  <tr key={a.id}>
                    <td>{a.fullName}</td>
                    <td className="small">{a.email}</td>
                    <td>{a.roleName || a.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Audit log</h2>
        <p className="muted small">Every administrative action, newest first.</p>
        {audit.loading ? (
          <Loading />
        ) : audit.denied ? (
          <NoPermission section="the audit log" />
        ) : audit.error ? (
          <Failed message={audit.error} onRetry={audit.reload} />
        ) : !(audit.data?.entries || audit.data?.logs || []).length ? (
          <Empty title="Nothing recorded yet" />
        ) : (
          <ul className="audit">
            {(audit.data?.entries || audit.data?.logs || []).slice(0, 60).map((e: any, i: number) => (
              <li key={e.id || i}>
                <span className="audit-when">{when(e.at || e.createdAt)}</span>
                <span className="audit-who">{e.actorName || e.actorId}</span>
                <span className="audit-what">{e.summary || e.action}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
};
