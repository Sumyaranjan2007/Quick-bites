import React, { useState } from 'react';
import {
  Money,
  StatCard,
  Loading,
  Failed,
  Empty,
  NoPermission,
  PageHeading,
  useRemote
} from './primitives';
import {
  fetchPricingConfig,
  updatePricingConfig,
  fetchDues,
  fetchPayoutList,
  draftPayout,
  approvePayout,
  sendPayout,
  fetchPayoutRequests,
  declinePayoutRequest,
  fetchPayeeReviewQueue,
  fetchPayeeCoverage,
  reviewPayeeAccount,
  fetchCashDeposits,
  confirmCashDeposit,
  fetchTaxIdentity,
  updateTaxIdentity,
  fetchTaxSummary,
  fetchGrievanceContact,
  updateGrievanceContact,
  runPaymentsHealthCheck
} from '../../lib/adminApi';

/**
 * Payments in the web console.
 *
 * -------------------------------------------------------------------------
 * THE SAME ENDPOINTS AS THE OPERATIONS APP, DELIBERATELY
 * -------------------------------------------------------------------------
 * Every call here is the one the mobile console makes. Not a parallel set, and
 * nothing recomputed in the browser: two implementations of "what is owed" is
 * the single thing this entire plan exists to avoid, and a console showing a
 * different figure to the app would be worse than a console with no payments
 * screen at all — somebody would have to work out which one was lying.
 *
 * -------------------------------------------------------------------------
 * AND NO AMOUNT IS EVER TYPED
 * -------------------------------------------------------------------------
 * There is no amount field on the payout side of this screen. What is owed
 * comes from the ledger and is frozen onto the draft. The only figure anybody
 * types is the cash they COUNTED at the counter, which is a measurement rather
 * than a decision — and the note beside it is compulsory the instant it differs
 * from what the rider declared.
 */

type Tab = 'dues' | 'requests' | 'cash' | 'rates' | 'accounts' | 'tax';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'dues', label: 'Owed & sending' },
  { key: 'requests', label: 'Requests' },
  { key: 'cash', label: 'Cash in' },
  { key: 'rates', label: 'Rates' },
  { key: 'accounts', label: 'Payout accounts' },
  { key: 'tax', label: 'Tax & policies' }
];

export const PaymentsSection: React.FC = () => {
  const [tab, setTab] = useState<Tab>('dues');

  return (
    <>
      <PageHeading
        title="Payments"
        sub="Who is owed what, what is being sent, and the rates behind every figure"
      />

      <div className="page-actions" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`btn btn-sm${tab === t.key ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dues' && <Dues />}
      {tab === 'requests' && <Requests />}
      {tab === 'cash' && <CashIn />}
      {tab === 'rates' && <Rates />}
      {tab === 'accounts' && <PayeeAccounts />}
      {tab === 'tax' && <TaxAndPolicies />}
    </>
  );
};

/* ------------------------------------------------------------------ *
 *  WHO IS OWED, AND SENDING IT                                        *
 * ------------------------------------------------------------------ */

const Dues: React.FC = () => {
  const dues = useRemote<any>(() => fetchDues());
  const list = useRemote<any>(() => fetchPayoutList());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<Record<string, string>>({});

  if (dues.denied) return <NoPermission section="payouts" />;
  if (dues.loading && !dues.data) return <Loading label="Working out who is owed what" />;
  if (dues.error) return <Failed message={dues.error} onRetry={dues.reload} />;

  const payload = dues.data;
  const rails: any[] = payload?.rails || [];
  const payouts: any[] = list.data?.payouts || [];
  const awaiting = payouts.filter(p => p.state === 'AWAITING_APPROVAL');
  const ready = payouts.filter(p => p.state === 'APPROVED');
  const rest = payouts.filter(p => p.state !== 'AWAITING_APPROVAL' && p.state !== 'APPROVED');

  const reloadAll = async () => {
    await dues.reload();
    await list.reload();
  };

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await reloadAll();
    } catch (err: any) {
      setError(err?.message || 'That could not be done.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="stat-grid">
        <StatCard
          label="Ready to pay"
          value={<Money value={payload?.summary?.payableTotal ?? 0} compact />}
          tone="brand"
          sub={`${payload?.summary?.payableCount ?? 0} people`}
        />
        <StatCard
          label="Blocked"
          value={<Money value={payload?.summary?.blockedTotal ?? 0} compact />}
          tone={Number(payload?.summary?.blockedTotal) > 0 ? 'bad' : 'default'}
          sub={`${payload?.summary?.blockedCount ?? 0} people — this is the day's real work`}
        />
        <StatCard
          label="Sent in the last 24 hours"
          value={<Money value={payload?.limits?.usedToday ?? 0} compact />}
          sub={`of a ${payload?.limits?.dailyCap ?? 0} daily ceiling`}
        />
      </section>

      {!!error && <p className="inline-error">{error}</p>}

      {/*
        Blocked rows are shown, not hidden. A list of only the payable people
        looks finished, and being finished by eleven is not the same as
        everybody having been paid.
      */}
      <div className="panel">
        <h2>Owed</h2>
        {(payload?.dues || []).length === 0 ? (
          <Empty title="Nobody is owed anything" body="Every delivered order has been settled." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th className="num">Payable</th>
                  <th className="num">Held</th>
                  <th>Why not</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payload.dues.map((row: any) => (
                  <tr key={`${row.ownerType}:${row.ownerId}`}>
                    <td>
                      {row.ownerName}
                      <div className="small muted">
                        {row.ownerType === 'RIDER' ? 'Rider' : 'Restaurant'}
                        {row.requestedAt ? ' · has asked to be paid' : ''}
                      </div>
                    </td>
                    <td className="num">
                      <Money value={row.payable} />
                    </td>
                    <td className="num muted">
                      <Money value={row.held} />
                    </td>
                    <td className={row.blockedReason ? 'warn-text small' : 'small muted'}>
                      {row.blockedReason || '—'}
                    </td>
                    <td>
                      {!row.blockedReason && row.payable > 0 && (
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy !== null}
                          onClick={() =>
                            act(`draft:${row.ownerId}`, () =>
                              draftPayout({
                                ownerType: row.ownerType,
                                ownerId: row.ownerId,
                                rail: payload.defaultRail
                              })
                            )
                          }
                        >
                          {busy === `draft:${row.ownerId}` ? 'Drafting' : 'Draft a payment'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {awaiting.length > 0 && (
        <div className="panel">
          <h2>Waiting for a second approver</h2>
          <p className="small muted">
            Over {payload?.limits?.makerCheckerThreshold ?? 0}. Whoever drafted it cannot approve it.
          </p>
          <div className="card-list">
            {awaiting.map(p => (
              <div key={p.id} className="review-card">
                <div>
                  <strong>{p.ownerName}</strong>
                  <div className="small muted">Drafted by {p.draftedByUserId}</div>
                </div>
                <div className="num">
                  <Money value={p.amount} />
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy !== null}
                  onClick={() => act(`approve:${p.id}`, () => approvePayout(p.id))}
                >
                  Approve
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {ready.length > 0 && (
        <div className="panel">
          <h2>Ready to send</h2>
          <p className="small muted">Approved. This is the step that moves money.</p>
          <div className="card-list">
            {ready.map(p => {
              const rail = rails.find(r => r.id === p.rail);
              return (
                <div key={p.id} className="review-card">
                  <div>
                    <strong>{p.ownerName}</strong>
                    <div className="small muted">via {rail?.displayName || p.rail}</div>
                  </div>
                  <div className="num">
                    <Money value={p.amount} />
                  </div>
                  {rail?.needsManualReference && (
                    <input
                      className="input"
                      placeholder="UTR after you transfer"
                      value={reference[p.id] || ''}
                      onChange={e => setReference(r => ({ ...r, [p.id]: e.target.value }))}
                    />
                  )}
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={
                      busy !== null ||
                      (rail?.needsManualReference && (reference[p.id] || '').trim().length < 4)
                    }
                    onClick={() =>
                      act(`send:${p.id}`, () =>
                        sendPayout(p.id, {
                          ...(reference[p.id]?.trim() ? { manualReference: reference[p.id].trim() } : {})
                        })
                      )
                    }
                  >
                    {busy === `send:${p.id}` ? 'Sending' : 'Send'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Sent</h2>
        {rest.length === 0 ? (
          <Empty title="Nothing sent yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th className="num">Amount</th>
                  <th>State</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {rest.map(p => (
                  <tr key={p.id}>
                    <td>{p.ownerName}</td>
                    <td className="num">
                      <Money value={p.amount} />
                    </td>
                    <td>
                      {p.state}
                      {p.state === 'UNCERTAIN' && (
                        <div className="warn-text small">
                          Outcome unknown. Being reconciled against the gateway — do not send again.
                        </div>
                      )}
                    </td>
                    <td className="mono small">{p.reference || p.claimUrl || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ *
 *  WHO HAS ASKED                                                      *
 * ------------------------------------------------------------------ */

const Requests: React.FC = () => {
  const requests = useRemote<any>(() => fetchPayoutRequests());
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.denied) return <NoPermission section="payout requests" />;
  if (requests.loading && !requests.data) return <Loading />;
  if (requests.error) return <Failed message={requests.error} onRetry={requests.reload} />;

  const rows: any[] = requests.data?.requests || [];

  return (
    <div className="panel">
      <h2>Who has asked to be paid</h2>
      {/*
        Said plainly, because the opposite assumption is easy and expensive:
        this list is a courtesy to whoever works the queue, not the work list.
      */}
      <p className="small muted">
        Everybody owed money is already in the Owed tab whether or not they asked, and the daily run clears
        all of them. A platform that pays the people who complain does not pay the quiet ones.
      </p>

      {!!error && <p className="inline-error">{error}</p>}

      {rows.length === 0 ? (
        <Empty title="Nobody is waiting on you" />
      ) : (
        <div className="card-list">
          {rows.map(r => (
            <div key={r.id} className="review-card">
              <div>
                <strong>{r.ownerName}</strong>
                <div className="small muted">
                  Asked {new Date(r.raisedAt).toLocaleDateString('en-IN')}
                  {r.note ? ` — “${r.note}”` : ''}
                </div>
                {r.movedSinceRequest && (
                  <div className="warn-text small">
                    They were owed <Money value={r.payableAtRequest} /> when they asked and are owed{' '}
                    <Money value={r.payableNow} /> now. That difference is what they will ring about.
                  </div>
                )}
                {!!r.blockedReason && <div className="warn-text small">{r.blockedReason}</div>}
              </div>
              <div className="num">
                <Money value={r.payableNow} />
              </div>
              <input
                className="input"
                placeholder="Reason, shown to them word for word"
                value={reason[r.id] || ''}
                onChange={e => setReason(s => ({ ...s, [r.id]: e.target.value }))}
              />
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy !== null || (reason[r.id] || '').trim().length < 4}
                onClick={async () => {
                  setBusy(r.id);
                  setError(null);
                  try {
                    await declinePayoutRequest(r.id, { reason: reason[r.id].trim() });
                    await requests.reload();
                  } catch (err: any) {
                    setError(err?.message || 'That could not be declined.');
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Decline
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="small muted">
        Declining closes a conversation, never a debt. What they are owed stays owed and stays in the queue.
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 *  CASH COMING IN                                                     *
 * ------------------------------------------------------------------ */

const CashIn: React.FC = () => {
  const cash = useRemote<any>(() => fetchCashDeposits());
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (cash.denied) return <NoPermission section="cash deposits" />;
  if (cash.loading && !cash.data) return <Loading />;
  if (cash.error) return <Failed message={cash.error} onRetry={cash.reload} />;

  const awaiting: any[] = cash.data?.awaiting || [];
  const ageing: any[] = cash.data?.ageing || [];

  return (
    <>
      <div className="panel">
        <h2>Riders coming in</h2>
        <p className="small muted">
          Type what you COUNTED, not what they said. Their balance comes down by this figure — confirming a
          declaration without counting is how money quietly goes missing.
        </p>

        {!!error && <p className="inline-error">{error}</p>}

        {awaiting.length === 0 ? (
          <Empty title="Nobody has declared a deposit" />
        ) : (
          <div className="card-list">
            {awaiting.map(d => {
              const declared = d.declaredPaise / 100;
              const value = Number((counted[d.id] ?? String(declared)).replace(/[^0-9.]/g, ''));
              const valid = Number.isFinite(value) && value >= 0;
              const differs = valid && Math.round((value - declared) * 100) !== 0;

              return (
                <div key={d.id} className="review-card">
                  <div>
                    <strong>{d.riderName || d.riderId}</strong>
                    <div className="small muted">
                      Declared <Money value={declared} /> · carrying{' '}
                      <Money value={d.cashInHandAtDeclarationPaise / 100} />
                    </div>
                  </div>
                  <input
                    className="input"
                    value={counted[d.id] ?? String(declared)}
                    onChange={e => setCounted(s => ({ ...s, [d.id]: e.target.value }))}
                    placeholder="Amount counted"
                  />
                  {differs && (
                    <input
                      className="input"
                      value={note[d.id] || ''}
                      onChange={e => setNote(s => ({ ...s, [d.id]: e.target.value }))}
                      placeholder="What happened? Required when the two differ"
                    />
                  )}
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy !== null || !valid || (differs && (note[d.id] || '').trim().length < 4)}
                    onClick={async () => {
                      setBusy(d.id);
                      setError(null);
                      try {
                        await confirmCashDeposit(d.id, {
                          receivedAmount: Number(value.toFixed(2)),
                          ...(differs ? { varianceNote: note[d.id].trim() } : {})
                        });
                        await cash.reload();
                      } catch (err: any) {
                        setError(err?.message || 'That could not be recorded.');
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === d.id ? 'Recording' : 'Record what I counted'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Cash still out there</h2>
        {/*
          The half that matters. A rider quietly accumulating cash and never
          coming in is invisible from any single order and obvious here.
        */}
        {ageing.length === 0 ? (
          <Empty title="Nobody is carrying platform money" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Rider</th>
                  <th className="num">Holding</th>
                  <th>Last deposit</th>
                </tr>
              </thead>
              <tbody>
                {ageing.map(r => (
                  <tr key={r.riderId}>
                    <td>{r.riderName}</td>
                    <td className={r.overCeiling ? 'num warn-text' : 'num'}>
                      <Money value={r.cashInHand} />
                      {r.overCeiling && <div className="small">Over the limit — cannot take cash orders</div>}
                    </td>
                    <td className="small muted">
                      {r.lastDepositAt
                        ? new Date(r.lastDepositAt).toLocaleDateString('en-IN')
                        : 'Has never deposited'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ *
 *  RATES                                                              *
 * ------------------------------------------------------------------ */

const Rates: React.FC = () => {
  const config = useRemote<any>(() => fetchPricingConfig());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (config.denied) return <NoPermission section="rates" />;
  if (config.loading && !config.data) return <Loading />;
  if (config.error) return <Failed message={config.error} onRetry={config.reload} />;

  const rates: Record<string, number> = config.data?.config?.rates || {};
  const bounds: Record<string, any> = config.data?.bounds || {};

  const changed = Object.keys(edits).filter(
    key => edits[key].trim() !== '' && Number(edits[key]) !== Number(rates[key])
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const changes: Record<string, number> = {};
      for (const key of changed) changes[key] = Number(edits[key]);
      const result = await updatePricingConfig({ changes, note: note.trim() });
      setSaved(`Version ${result?.config?.version ?? ''} saved.`);
      setEdits({});
      setNote('');
      await config.reload();
    } catch (err: any) {
      setError(err?.message || 'Those rates could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Rates and fees</h2>
      {/*
        Versioned, never edited in place. Every order keeps the rates it was
        charged at, which is why a commission change cannot restate a settled
        month.
      */}
      <p className="small muted">
        Changing a rate creates a new version. Nothing already charged is altered — every order keeps the
        rates that were in force when it was placed. Version {config.data?.config?.version} is live.
      </p>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Rate</th>
              <th className="num">Now</th>
              <th className="num">Change to</th>
              <th>Limits</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(rates).map(key => {
              const bound = bounds[key] || {};
              return (
                <tr key={key}>
                  <td>
                    {bound.label || key}
                    {bound.affectsCustomerBill && (
                      <div className="small warn-text">On the customer&rsquo;s bill</div>
                    )}
                  </td>
                  <td className="num mono">{rates[key]}</td>
                  <td className="num">
                    <input
                      className="input"
                      style={{ maxWidth: 110, textAlign: 'right' }}
                      value={edits[key] ?? ''}
                      placeholder={String(rates[key])}
                      onChange={e => setEdits(s => ({ ...s, [key]: e.target.value }))}
                    />
                  </td>
                  <td className="small muted">
                    {bound.min ?? '—'} to {bound.max ?? '—'} {bound.unit || ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {changed.length > 0 && (
        <div className="field">
          <label>Why are you changing {changed.length === 1 ? 'this' : 'these'}?</label>
          <input
            className="input"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. renegotiated commission for the south zone"
          />
          <p className="small muted">
            Required. It is what somebody reads in six months when they ask why the number moved.
          </p>
        </div>
      )}

      {!!error && <p className="inline-error">{error}</p>}
      {!!saved && <p className="inline-ok">{saved}</p>}

      <button
        className="btn btn-primary"
        disabled={busy || changed.length === 0 || note.trim().length < 4}
        onClick={save}
      >
        {busy ? 'Saving' : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 *  PAYOUT ACCOUNTS                                                    *
 * ------------------------------------------------------------------ */

const PayeeAccounts: React.FC = () => {
  const queue = useRemote<any>(() => fetchPayeeReviewQueue());
  const coverage = useRemote<any>(() => fetchPayeeCoverage());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (queue.denied) return <NoPermission section="payout accounts" />;
  if (queue.loading && !queue.data) return <Loading />;

  const rows: any[] = queue.data?.queue || [];

  // Two groups on the server, one list here: an administrator chasing missing
  // accounts before payday does not care which kind of payee each one is, only
  // that somebody has to ring them.
  const missing: any[] = [
    ...((coverage.data?.riders?.withoutAccount || []) as any[]).map(r => ({ ...r, ownerType: 'RIDER' })),
    ...((coverage.data?.restaurants?.withoutAccount || []) as any[]).map(r => ({ ...r, ownerType: 'RESTAURANT' }))
  ];

  const decide = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    setBusy(id);
    setError(null);
    try {
      await reviewPayeeAccount(id, { decision });
      await queue.reload();
      await coverage.reload();
    } catch (err: any) {
      setError(err?.message || 'That could not be recorded.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="panel">
        <h2>Names a person has to look at</h2>
        {/*
          The middle band. Above 90 is verified automatically and below 70 is
          refused; these are the ones where a Rahul Sharma whose bank holds
          "SHARMA RAHUL KUMAR" is neither obviously himself nor obviously not.
        */}
        <p className="small muted">
          The bank&rsquo;s name and ours are close but not close enough to decide automatically. Both are
          shown so you are comparing, not guessing.
        </p>

        {!!error && <p className="inline-error">{error}</p>}

        {rows.length === 0 ? (
          <Empty title="Nothing waiting" body="Every account either verified or was refused outright." />
        ) : (
          <div className="card-list">
            {rows.map(a => (
              <div key={a.id} className="review-card">
                <div>
                  <strong>{a.ownerName || a.ownerId}</strong>
                  <div className="small">
                    They gave: <span className="mono">{a.holderName}</span>
                  </div>
                  <div className="small">
                    Bank holds: <span className="mono">{a.registeredName || '—'}</span>
                  </div>
                  <div className="small muted">Match {a.nameMatchScore ?? '—'} of 100</div>
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy !== null}
                  onClick={() => decide(a.id, 'APPROVE')}
                >
                  Same person
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={busy !== null}
                  onClick={() => decide(a.id, 'REJECT')}
                >
                  Not them
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Nobody can be paid without one</h2>
        {missing.length === 0 ? (
          <Empty title="Everyone who trades has a verified account" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Type</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((m: any) => (
                  <tr key={`${m.ownerType}:${m.id}`}>
                    <td>{m.name}</td>
                    <td className="small muted">{m.ownerType === 'RIDER' ? 'Rider' : 'Restaurant'}</td>
                    <td className="warn-text small">{m.reason || 'No verified account'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ *
 *  TAX AND POLICIES                                                   *
 * ------------------------------------------------------------------ */

const thisMonth = () => new Date().toISOString().slice(0, 7);

const TaxAndPolicies: React.FC = () => {
  const [month, setMonth] = useState(thisMonth());
  const identity = useRemote<any>(() => fetchTaxIdentity());
  const summary = useRemote<any>(() => fetchTaxSummary(month), [month]);
  const grievance = useRemote<any>(() => fetchGrievanceContact());

  const [form, setForm] = useState<Record<string, string>>({});
  const [contact, setContact] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);

  if (identity.denied) return <NoPermission section="tax" />;
  if (identity.loading && !identity.data) return <Loading />;

  const gaps: string[] = identity.data?.gaps || [];
  const ready = identity.data?.canIssueInvoices;
  const policyGaps: string[] = grievance.data?.gaps || [];
  const tax = summary.data;

  const saveIdentity = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateTaxIdentity(form);
      setForm({});
      await identity.reload();
      await summary.reload();
    } catch (err: any) {
      setError(err?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const saveContact = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateGrievanceContact(contact);
      setContact({});
      await grievance.reload();
    } catch (err: any) {
      setError(err?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const field = (
    state: Record<string, string>,
    set: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    key: string,
    label: string,
    placeholder?: string
  ) => (
    <div className="field" key={key}>
      <label>{label}</label>
      <input
        className="input"
        value={state[key] ?? ''}
        placeholder={placeholder}
        onChange={e => set(s => ({ ...s, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <>
      <div className="panel">
        <h2>{ready ? 'GST registration on file' : 'No GST registration — invoices are not being issued'}</h2>

        {ready ? (
          <p className="small">
            <span className="mono">{identity.data.identity.gstin}</span> · {identity.data.identity.legalName} ·{' '}
            {identity.data.identity.stateName}
          </p>
        ) : (
          <>
            {/*
              Deliberate, and also a compliance gap that grows with every order.
              Both halves have to be said: the behaviour is correct and the
              situation is not something to leave alone.
            */}
            <p className="warn-text small">
              Customers are being given payment receipts instead of tax invoices. That is deliberate — an
              invoice with a made-up GSTIN is a false document, not a draft — but it is a gap that grows with
              every order.
            </p>
            {gaps.map(g => (
              <p key={g} className="small muted">
                {g}
              </p>
            ))}
          </>
        )}

        <div className="panel-grid">
          {field(form, setForm, 'gstin', 'GSTIN', '29AABCU9603R1ZM')}
          {field(form, setForm, 'legalName', 'Legal name', 'As on the registration certificate')}
          {field(form, setForm, 'tradeName', 'Trading name (optional)')}
          {field(form, setForm, 'addressLine', 'Registered address')}
          {field(form, setForm, 'city', 'City')}
          {field(form, setForm, 'stateName', 'State')}
          {field(form, setForm, 'pincode', 'Pincode')}
          {field(form, setForm, 'pan', 'PAN (optional)')}
          {field(form, setForm, 'invoicePrefix', 'Invoice prefix', 'INV')}
        </div>
        <p className="small muted">
          You do not enter a state code. It is taken from the first two characters of the GSTIN, because a
          typed one that disagrees splits tax against a state you are not registered in.
        </p>
        {!!error && <p className="inline-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy} onClick={saveIdentity}>
          Save registration
        </button>
      </div>

      <div className="panel">
        <h2>Grievance officer</h2>
        {policyGaps.length > 0 ? (
          <p className="warn-text small">
            {policyGaps.join(' ')} Until it is published, every payment policy says so in its own text rather
            than naming somebody who does not exist.
          </p>
        ) : (
          <p className="small">
            {grievance.data?.contact?.officerName} · {grievance.data?.contact?.email}
          </p>
        )}
        <div className="panel-grid">
          {field(contact, setContact, 'officerName', 'Name')}
          {field(contact, setContact, 'designation', 'Designation (optional)')}
          {field(contact, setContact, 'email', 'Email')}
          {field(contact, setContact, 'phone', 'Phone (optional)')}
          {field(contact, setContact, 'address', 'Postal address')}
          {field(contact, setContact, 'hours', 'Working hours (optional)')}
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={saveContact}>
          Publish
        </button>
      </div>

      <div className="panel">
        <h2>What a return is filed from</h2>
        <div className="field-inline">
          <input className="input" value={month} onChange={e => setMonth(e.target.value)} placeholder="2026-09" />
        </div>

        {summary.loading && !tax ? (
          <Loading />
        ) : !tax ? (
          <Empty title="Nothing for that month" />
        ) : (
          <>
            {/*
              Above the numbers, not below. Somebody about to file reads the top
              of the page, and a summary that looks clean because it dropped the
              awkward orders is how a wrong return gets filed confidently.
            */}
            {(tax.warnings || []).map((w: string) => (
              <p key={w} className="warn-text small">
                {w}
              </p>
            ))}

            <section className="stat-grid">
              <StatCard label="Orders delivered" value={tax.ordersCounted} />
              <StatCard
                label="Tax on outward supplies"
                value={<Money value={tax.outward.totalTax} compact />}
                tone="brand"
              />
              <StatCard label="TCS collected" value={<Money value={tax.tcs.collected} compact />} />
              <StatCard label="TDS deducted" value={<Money value={tax.tdsTotal} compact />} />
            </section>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Partner</th>
                    <th className="num">Orders</th>
                    <th className="num">Supplied</th>
                    <th className="num">TDS</th>
                  </tr>
                </thead>
                <tbody>
                  {(tax.tds || []).map((row: any) => (
                    <tr key={row.restaurantId}>
                      <td>{row.restaurantName}</td>
                      <td className="num">{row.ordersCounted}</td>
                      <td className="num">
                        <Money value={row.grossSupplies} />
                      </td>
                      <td className="num">
                        <Money value={row.deducted} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Check for money gone quiet</h2>
        <p className="small muted">
          Resolves payouts whose outcome never came back by asking the gateway, and raises cash that has been
          out too long or books that do not balance. It never sends a payment and never corrects the ledger.
        </p>
        {!!health && <p className="inline-ok">{health}</p>}
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const report = await runPaymentsHealthCheck();
              setHealth(
                (report?.alerts || []).length === 0
                  ? 'Nothing needs attention.'
                  : (report.alerts as string[]).join(' · ')
              );
            } catch (err: any) {
              setHealth(err?.message || 'The check could not be run.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Run the check now
        </button>
      </div>
    </>
  );
};

export default PaymentsSection;
