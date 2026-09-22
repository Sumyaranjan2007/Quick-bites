import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Banknote, ShieldAlert, Clock, CircleSlash, Send, Info, Wallet, TriangleAlert } from 'lucide-react-native';
import {
  Card,
  Badge,
  Button,
  Field,
  Sheet,
  Divider,
  Loading,
  NoAccess,
  EmptyState,
  SectionTitle,
  Segmented
} from '../components/ui';
import { tokens, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

interface DueRow {
  ownerType: 'RESTAURANT' | 'RIDER';
  ownerId: string;
  ownerName: string;
  payable: number;
  held: number;
  outstanding: number;
  cashInHand: number;
  hasVerifiedAccount: boolean;
  blockedReason: string | null;
}

interface Rail {
  id: string;
  displayName: string;
  description: string;
  available: boolean;
  unavailableReason: string | null;
  isDefault: boolean;
  needsManualReference: boolean;
}

interface DuesPayload {
  dues: DueRow[];
  summary: {
    payableCount: number;
    payableTotal: number;
    blockedCount: number;
    blockedTotal: number;
    heldTotal: number;
  };
  limits: {
    dailyCap: number;
    usedToday: number;
    remainingToday: number;
    makerCheckerThreshold: number;
    minPayoutAmount: number;
    partnerHoldDays: number;
    riderHoldDays: number;
  };
  rails: Rail[];
  defaultRail: string;
}

interface PayoutRow {
  id: string;
  ownerName: string;
  ownerType: 'RESTAURANT' | 'RIDER';
  amount: number;
  state: string;
  rail: string;
  reference?: string;
  claimUrl?: string;
  failureReason?: string;
  draftedByUserId: string;
  draftedAt: string;
  approvedByUserId?: string;
  /** Where the money goes, resolved from the approved account. */
  destinationLine?: string;
  destination?: { kind: string; label: string; holderName: string } | null;
}

interface DepositRow {
  id: string;
  riderId: string;
  riderName?: string;
  declaredPaise: number;
  receivedPaise?: number;
  declared: number;
  received?: number | null;
  status: 'DECLARED' | 'CONFIRMED' | 'VARIANCE' | 'CANCELLED';
  declaredAt: string;
  confirmedAt?: string;
  varianceNote?: string;
  proofUrl?: string;
  cashInHandAtDeclarationPaise: number;
}

interface AgeingRow {
  riderId: string;
  riderName: string;
  cashInHand: number;
  overCeiling: boolean;
  lastDepositAt: string | null;
  pendingDeclarationPaise: number | null;
}

interface CashPayload {
  awaiting: DepositRow[];
  recent: DepositRow[];
  ageing: AgeingRow[];
}

const rupees = (n: number) =>
  `Rs ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  PAID: 'success',
  APPROVED: 'info',
  AWAITING_APPROVAL: 'warning',
  UNCERTAIN: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  DRAFT: 'neutral'
};

/**
 * The day's payments.
 *
 * -------------------------------------------------------------------------
 * WHY BLOCKED ROWS ARE SHOWN RATHER THAN HIDDEN
 * -------------------------------------------------------------------------
 * A list of only the payable people looks finished, and being finished by
 * eleven is not the same as everybody having been paid. A list that also says
 * "four riders are holding your cash and two partners have no verified account"
 * is the day's actual work, and somebody can go and chase it.
 *
 * -------------------------------------------------------------------------
 * THE AMOUNT IS NEVER TYPED
 * -------------------------------------------------------------------------
 * There is no amount field on this screen. What is owed comes from the ledger
 * and is frozen onto the draft. A payouts screen where an administrator types a
 * figure is a payouts screen where an administrator can type ANY figure, and
 * the only thing standing between that and the bank is their own care.
 */
export const PayoutsScreen: React.FC = () => {
  const { api, can, user } = useSession();
  const canView = can('finance.payouts.view', 'finance.settlements.view');
  const canPay = can('finance.payouts.manage', 'finance.settlements.manage');

  const dues = useResource<DuesPayload>(() => api.get('/admin/payouts/dues').then(r => r.data), [], {
    enabled: canView
  });
  const history = useResource<{ payouts: PayoutRow[] }>(
    () => api.get('/admin/payouts/list').then(r => r.data),
    [],
    { enabled: canView }
  );

  const cash = useResource<CashPayload>(() => api.get('/admin/cash/deposits').then(r => r.data), [], {
    enabled: canView
  });

  const overview = useResource<any>(() => api.get('/admin/payments/overview').then(r => r.data), [], {
    enabled: canView
  });

  const [tab, setTab] = useState('overview');
  const [drafting, setDrafting] = useState<DueRow | null>(null);
  const [rail, setRail] = useState<string>('');
  const [sending, setSending] = useState<PayoutRow | null>(null);
  const [manualReference, setManualReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /* Counting cash in. */
  const [counting, setCounting] = useState<DepositRow | null>(null);
  const [countedAmount, setCountedAmount] = useState('');
  const [varianceNote, setVarianceNote] = useState('');

  if (!canView) return <NoAccess permission="finance.payouts.view" />;
  if (dues.loading && !dues.data) return <Loading label="Working out who is owed what…" />;

  const payload = dues.data;
  const rails = payload?.rails || [];
  const limits = payload?.limits;

  const reloadAll = async () => {
    await dues.reload();
    void history.silentReload();
    void cash.silentReload();
    void overview.silentReload();
  };

  const draft = async () => {
    if (!drafting) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post('/admin/payouts', {
        ownerType: drafting.ownerType,
        ownerId: drafting.ownerId,
        rail: rail || payload?.defaultRail
      });
      setDrafting(null);
      setTab('sending');
      await reloadAll();
    } catch (err: any) {
      setActionError(err?.message || 'That payout could not be drafted.');
    } finally {
      setBusy(false);
    }
  };

  const approve = async (payout: PayoutRow) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/payouts/${payout.id}/approve`, {});
      await reloadAll();
    } catch (err: any) {
      setActionError(err?.message || 'That payout could not be approved.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!sending) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/payouts/${sending.id}/send`, {
        ...(manualReference.trim() ? { manualReference: manualReference.trim() } : {})
      });
      setSending(null);
      setManualReference('');
      await reloadAll();
    } catch (err: any) {
      setActionError(err?.message || 'That payout could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * Counting a deposit in.
   *
   * The field starts at what the rider DECLARED, because that is the number
   * being checked and starting anywhere else invites a distracted clerk to
   * confirm a blank. But the server reduces the rider's balance by what is
   * typed here, never by the declaration — so the note is compulsory the moment
   * the two differ, and the sheet says so before the difference is typed.
   */
  const counted = Number(countedAmount.replace(/[^0-9.]/g, ''));
  const countedValid = Number.isFinite(counted) && counted >= 0 && counted <= 1000000;
  const declaredRupees = counting ? counting.declaredPaise / 100 : 0;
  const countVariance = countedValid ? Math.round((counted - declaredRupees) * 100) / 100 : 0;
  const needsNote = countedValid && countVariance !== 0;

  const confirmDeposit = async () => {
    if (!counting || !countedValid) return;
    if (needsNote && varianceNote.trim().length < 4) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/cash/deposits/${counting.id}/confirm`, {
        receivedAmount: Number(counted.toFixed(2)),
        ...(needsNote ? { varianceNote: varianceNote.trim() } : {})
      });
      setCounting(null);
      setCountedAmount('');
      setVarianceNote('');
      await reloadAll();
    } catch (err: any) {
      setActionError(err?.message || 'That deposit could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const railFor = (id: string) => rails.find(r => r.id === id);
  const pendingApproval = (history.data?.payouts || []).filter(p => p.state === 'AWAITING_APPROVAL');
  const readyToSend = (history.data?.payouts || []).filter(p => p.state === 'APPROVED');
  const rest = (history.data?.payouts || []).filter(
    p => p.state !== 'AWAITING_APPROVAL' && p.state !== 'APPROVED'
  );

  return (
    <>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={dues.loading} onRefresh={reloadAll} />}
      >
        {!!dues.error && (
          <Card style={s.errorCard}>
            <Text style={s.errorText}>{dues.error}</Text>
          </Card>
        )}

        {!!payload && (
          <Card style={s.summaryCard}>
            <View style={s.summaryRow}>
              <View style={s.summaryCell}>
                <Text style={s.summaryValue}>{rupees(payload.summary.payableTotal)}</Text>
                <Text style={s.summaryLabel}>ready to pay, {payload.summary.payableCount} people</Text>
              </View>
              <View style={s.summaryCell}>
                <Text style={[s.summaryValue, { color: c.state.warning }]}>
                  {rupees(payload.summary.blockedTotal)}
                </Text>
                <Text style={s.summaryLabel}>blocked, {payload.summary.blockedCount} people</Text>
              </View>
            </View>
            <Divider style={{ marginVertical: 10 }} />
            <Text style={s.limitsText}>
              {rupees(limits?.usedToday || 0)} of {rupees(limits?.dailyCap || 0)} sent today ·{' '}
              {rupees(payload.summary.heldTotal)} still inside the hold period · a second approver is needed
              above {rupees(limits?.makerCheckerThreshold || 0)}
            </Text>
          </Card>
        )}

        <Segmented
          options={[
            { key: 'overview', label: 'What is going on' },
            { key: 'due', label: `Owed${payload ? ` (${payload.summary.payableCount})` : ''}` },
            {
              key: 'sending',
              label: `To send${pendingApproval.length + readyToSend.length ? ` (${pendingApproval.length + readyToSend.length})` : ''}`
            },
            { key: 'history', label: 'Sent' },
            {
              key: 'cash',
              label: `Cash in${cash.data?.awaiting.length ? ` (${cash.data.awaiting.length})` : ''}`
            }
          ]}
          value={tab}
          onChange={setTab}
        />

        {/* ------------------------- What is going on ------------------------- */}
        {tab === 'overview' && (
          <>
            {overview.loading && !overview.data ? (
              <Loading label="Working out what needs doing…" />
            ) : !overview.data ? (
              <EmptyState title="Could not load this" message={overview.error || 'Pull down to try again.'} />
            ) : (
              <>
                {/*
                  Blockers first, above the money.

                  An empty payouts queue can mean "everybody has been paid" or
                  "nothing was ever recorded and nobody can be paid at all".
                  Those look identical and mean opposite things, and not being
                  able to tell them apart was most of what the owner was
                  describing.
                */}
                {overview.data.blockers.length === 0 ? (
                  <Card style={{ borderColor: c.state.success, marginBottom: 12 }}>
                    <Text style={s.okTitle}>
                      {overview.data.queue.readyToPay > 0
                        ? `${overview.data.queue.readyToPay} to pay, and nothing in the way`
                        : 'Nothing needs your attention'}
                    </Text>
                    <Text style={s.okBody}>
                      {overview.data.queue.readyToPay > 0
                        ? `${rupees(overview.data.queue.readyToPayTotal)} is ready to send. Open the Owed tab.`
                        : 'Nobody is waiting to be paid and nothing is stuck.'}
                    </Text>
                  </Card>
                ) : (
                  <>
                    <SectionTitle
                      title="What is stopping payments"
                      subtitle="Each of these has one thing that clears it."
                    />
                    {overview.data.blockers.map((blocker: any, index: number) => (
                      <Card key={index} style={s.blockerCard}>
                        <View style={s.blockRow}>
                          <TriangleAlert size={15} color={c.state.warning} />
                          <Text style={s.blockerWhat}>{blocker.what}</Text>
                        </View>
                        <Text style={s.blockerFix}>{blocker.fix}</Text>

                        {blocker.where === 'CATCH_UP' && canPay && (
                          <Button
                            label={busy ? 'Catching up…' : 'Record the missing earnings'}
                            onPress={async () => {
                              setBusy(true);
                              setActionError(null);
                              try {
                                await api.post('/admin/payouts/backfill', {});
                                await reloadAll();
                              } catch (err: any) {
                                setActionError(err?.message || 'The catch-up could not run.');
                              } finally {
                                setBusy(false);
                              }
                            }}
                            disabled={busy}
                            style={{ marginTop: 10 }}
                          />
                        )}
                        {blocker.where === 'CASH' && (
                          <Button
                            label="Go to Cash in"
                            variant="ghost"
                            onPress={() => setTab('cash')}
                            style={{ marginTop: 10 }}
                          />
                        )}
                      </Card>
                    ))}
                  </>
                )}

                {!!actionError && <Text style={s.errorText}>{actionError}</Text>}

                {/* ---------------------- What we earned ---------------------- */}
                <SectionTitle
                  title={`What we earned, last ${overview.data.period.days} days`}
                  subtitle={`${overview.data.business.orders} delivered orders, ${rupees(overview.data.business.gross)} taken from customers.`}
                />
                <Card>
                  <Text style={s.earnedTotal}>{rupees(overview.data.business.earned.total)}</Text>
                  <Text style={s.earnedCaption}>ours, after paying restaurants and riders</Text>
                  <Divider style={{ marginVertical: 12 }} />

                  <EarnRow label="Commission on food" value={overview.data.business.earned.commission} />
                  <EarnRow label="Packaging markup" value={overview.data.business.earned.packagingMarkup} />
                  <EarnRow label="Platform fees" value={overview.data.business.earned.platformFee} />
                  {overview.data.business.earned.extraCharges > 0 && (
                    <EarnRow label="Extra charges" value={overview.data.business.earned.extraCharges} />
                  )}
                  <EarnRow
                    label="Delivery"
                    value={overview.data.business.earned.deliveryMargin}
                    hint={
                      overview.data.business.earned.deliveryMargin < 0
                        ? 'Negative: delivery costs more than you charge for it.'
                        : undefined
                    }
                  />
                </Card>

                <Text style={s.footnote}>
                  These are what each delivered order actually charged, not today’s rates — so changing a rate
                  never rewrites what you already earned.
                </Text>
              </>
            )}
          </>
        )}

        {tab === 'due' &&
          (!payload || payload.dues.length === 0 ? (
            <EmptyState
              title="Nobody is owed anything"
              message="Every delivered order has been settled, or nothing has been delivered yet."
              icon={<Banknote size={28} color={c.text.muted} />}
            />
          ) : (
            payload.dues.map(row => (
              <Card key={`${row.ownerType}:${row.ownerId}`} style={s.dueCard}>
                <View style={s.dueHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dueName}>{row.ownerName}</Text>
                    <Text style={s.dueType}>
                      {row.ownerType === 'RIDER' ? 'Rider' : 'Restaurant'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.dueAmount}>{rupees(row.payable)}</Text>
                    {row.held > 0 && <Text style={s.dueHeld}>{rupees(row.held)} held</Text>}
                  </View>
                </View>

                {row.cashInHand > 0 && (
                  <View style={s.blockRow}>
                    <CircleSlash size={14} color={c.state.danger} />
                    <Text style={s.blockText}>
                      Holding {rupees(row.cashInHand)} of platform cash — must be deposited first
                    </Text>
                  </View>
                )}

                {!!row.blockedReason && row.cashInHand === 0 && (
                  <View style={s.blockRow}>
                    {row.hasVerifiedAccount ? (
                      <Clock size={14} color={c.state.warning} />
                    ) : (
                      <ShieldAlert size={14} color={c.state.warning} />
                    )}
                    <Text style={s.blockTextWarn}>{row.blockedReason}</Text>
                  </View>
                )}

                {canPay && !row.blockedReason && row.payable > 0 && (
                  <Button
                    label="Draft a payment"
                    onPress={() => {
                      setDrafting(row);
                      setRail(payload.defaultRail);
                      setActionError(null);
                    }}
                    style={{ marginTop: 10 }}
                  />
                )}
              </Card>
            ))
          ))}

        {tab === 'sending' && (
          <>
            {pendingApproval.length > 0 && (
              <>
                <SectionTitle
                  title="Waiting for a second approver"
                  subtitle="Over the threshold. Whoever drafted it cannot be the one to approve it."
                />
                {pendingApproval.map(payout => (
                  <Card key={payout.id} style={s.payoutCard}>
                    <View style={s.payoutHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.dueName}>{payout.ownerName}</Text>
                        <Text style={s.dueType}>
                          Drafted {timeAgo(payout.draftedAt)}
                          {payout.draftedByUserId === user?.id ? ' by you' : ''}
                        </Text>
                      </View>
                      <Text style={s.dueAmount}>{rupees(payout.amount)}</Text>
                    </View>
                    {payout.draftedByUserId === user?.id ? (
                      <View style={s.blockRow}>
                        <Info size={14} color={c.text.muted} />
                        <Text style={s.blockTextMuted}>
                          You drafted this. Another administrator has to approve it.
                        </Text>
                      </View>
                    ) : (
                      canPay && (
                        <Button
                          label="Approve"
                          onPress={() => void approve(payout)}
                          disabled={busy}
                          style={{ marginTop: 10 }}
                        />
                      )
                    )}
                  </Card>
                ))}
              </>
            )}

            {readyToSend.length > 0 && (
              <>
                <SectionTitle title="Ready to send" subtitle="Approved. This is the step that moves money." />
                {readyToSend.map(payout => (
                  <Card key={payout.id} style={s.payoutCard}>
                    <View style={s.payoutHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.dueName}>{payout.ownerName}</Text>
                        <Text style={s.dueType}>via {railFor(payout.rail)?.displayName || payout.rail}</Text>
                      {!!payout.destinationLine && (
                        <Text style={s.destination}>{payout.destinationLine}</Text>
                      )}
                      </View>
                      <Text style={s.dueAmount}>{rupees(payout.amount)}</Text>
                    </View>
                    {canPay && (
                      <Button
                        label="Send"
                        onPress={() => {
                          setSending(payout);
                          setManualReference('');
                          setActionError(null);
                        }}
                        disabled={busy}
                        style={{ marginTop: 10 }}
                      />
                    )}
                  </Card>
                ))}
              </>
            )}

            {pendingApproval.length === 0 && readyToSend.length === 0 && (
              <EmptyState
                title="Nothing waiting to go out"
                message="Draft a payment from the Owed tab."
                icon={<Send size={28} color={c.text.muted} />}
              />
            )}
          </>
        )}

        {tab === 'history' &&
          (rest.length === 0 ? (
            <EmptyState title="Nothing sent yet" message="Payments you send will be listed here with their references." />
          ) : (
            rest.map(payout => (
              <Card key={payout.id} style={s.payoutCard}>
                <View style={s.payoutHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dueName}>{payout.ownerName}</Text>
                    <Text style={s.dueType}>
                      {timeAgo(payout.draftedAt)} · {railFor(payout.rail)?.displayName || payout.rail}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.dueAmount}>{rupees(payout.amount)}</Text>
                    <Badge label={payout.state} tone={STATE_TONE[payout.state] || 'neutral'} />
                  </View>
                </View>
                {!!payout.destinationLine && <Text style={s.destination}>{payout.destinationLine}</Text>}
                {!!payout.reference && <Text style={s.reference}>Reference: {payout.reference}</Text>}
                {!!payout.claimUrl && <Text style={s.reference}>Link: {payout.claimUrl}</Text>}
                {!!payout.failureReason && <Text style={s.errorText}>{payout.failureReason}</Text>}
                {payout.state === 'UNCERTAIN' && (
                  <Text style={s.uncertain}>
                    The request was sent and its outcome is unknown. It will be reconciled against the
                    gateway — do not send it again.
                  </Text>
                )}
              </Card>
            ))
          ))}

        {/* ----------------------------- Cash in ----------------------------- */}
        {tab === 'cash' && (
          <>
            {!!cash.error && (
              <Card style={s.errorCard}>
                <Text style={s.errorText}>{cash.error}</Text>
              </Card>
            )}

            <SectionTitle
              title="Riders coming in"
              subtitle="What they said they are bringing. Count it, then record what you actually counted."
            />
            {(cash.data?.awaiting.length || 0) === 0 ? (
              <EmptyState
                title="Nobody has declared a deposit"
                message="A rider declares before they set off, so this list is what to expect at the counter today."
                icon={<Wallet size={28} color={c.text.muted} />}
              />
            ) : (
              cash.data!.awaiting.map(deposit => (
                <Card key={deposit.id} style={s.dueCard}>
                  <View style={s.dueHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dueName}>{deposit.riderName || deposit.riderId}</Text>
                      <Text style={s.dueType}>Declared {timeAgo(deposit.declaredAt)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.dueAmount}>{rupees(deposit.declared)}</Text>
                      <Text style={s.dueHeld}>
                        carrying {rupees(deposit.cashInHandAtDeclarationPaise / 100)}
                      </Text>
                    </View>
                  </View>

                  {deposit.cashInHandAtDeclarationPaise > deposit.declaredPaise && (
                    <View style={s.blockRow}>
                      <Info size={14} color={c.text.muted} />
                      <Text style={s.blockTextMuted}>
                        This is a part deposit.{' '}
                        {rupees((deposit.cashInHandAtDeclarationPaise - deposit.declaredPaise) / 100)} stays
                        against them afterwards.
                      </Text>
                    </View>
                  )}

                  {canPay && (
                    <Button
                      label="Count it in"
                      onPress={() => {
                        setCounting(deposit);
                        setCountedAmount(String(deposit.declaredPaise / 100));
                        setVarianceNote('');
                        setActionError(null);
                      }}
                      disabled={busy}
                      style={{ marginTop: 10 }}
                    />
                  )}
                </Card>
              ))
            )}

            <SectionTitle
              title="Cash still out there"
              subtitle="Every rider holding platform money right now, largest first."
            />
            {(cash.data?.ageing.length || 0) === 0 ? (
              <EmptyState
                title="No cash is outstanding"
                message="Nobody is carrying platform money."
                icon={<Banknote size={28} color={c.text.muted} />}
              />
            ) : (
              cash.data!.ageing.map(row => (
                <Card key={row.riderId} style={s.dueCard}>
                  <View style={s.dueHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dueName}>{row.riderName}</Text>
                      <Text style={s.dueType}>
                        {row.lastDepositAt
                          ? `Last deposit ${timeAgo(row.lastDepositAt)}`
                          : 'Has never deposited'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[s.dueAmount, row.overCeiling && { color: c.state.danger }]}>
                        {rupees(row.cashInHand)}
                      </Text>
                      {row.pendingDeclarationPaise != null && (
                        <Text style={s.dueHeld}>
                          declared {rupees(row.pendingDeclarationPaise / 100)}
                        </Text>
                      )}
                    </View>
                  </View>

                  {row.overCeiling && (
                    <View style={s.blockRow}>
                      <TriangleAlert size={14} color={c.state.danger} />
                      <Text style={s.blockText}>
                        Over the cash limit. They cannot take cash orders, and they cannot be paid, until this
                        is counted in.
                      </Text>
                    </View>
                  )}
                </Card>
              ))
            )}

            {(cash.data?.recent.length || 0) > 0 && (
              <>
                <SectionTitle title="Recently counted" subtitle="What was declared against what arrived." />
                {cash.data!.recent.map(deposit => {
                  const differs =
                    deposit.receivedPaise != null && deposit.receivedPaise !== deposit.declaredPaise;
                  return (
                    <Card key={deposit.id} style={s.payoutCard}>
                      <View style={s.payoutHead}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.dueName}>{deposit.riderName || deposit.riderId}</Text>
                          <Text style={s.dueType}>
                            {timeAgo(deposit.confirmedAt || deposit.declaredAt)}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.dueAmount}>
                            {rupees((deposit.receivedPaise ?? deposit.declaredPaise) / 100)}
                          </Text>
                          <Badge
                            label={deposit.status}
                            tone={
                              deposit.status === 'CONFIRMED'
                                ? 'success'
                                : deposit.status === 'VARIANCE'
                                ? 'danger'
                                : 'neutral'
                            }
                          />
                        </View>
                      </View>
                      {differs && (
                        <Text style={s.reference}>
                          Declared {rupees(deposit.declaredPaise / 100)}, counted{' '}
                          {rupees((deposit.receivedPaise || 0) / 100)}
                          {deposit.varianceNote ? ` — ${deposit.varianceNote}` : ''}
                        </Text>
                      )}
                    </Card>
                  );
                })}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Drafting */}
      <Sheet
        visible={!!drafting}
        onClose={() => setDrafting(null)}
        title="Draft a payment"
        subtitle={drafting?.ownerName}
      >
        <View style={s.confirmBox}>
          <View style={s.confirmRow}>
            <Text style={s.confirmLabel}>Amount owed</Text>
            <Text style={s.confirmValue}>{rupees(drafting?.payable || 0)}</Text>
          </View>
          {(drafting?.held || 0) > 0 && (
            <View style={s.confirmRow}>
              <Text style={s.confirmLabel}>Still held</Text>
              <Text style={s.confirmValue}>{rupees(drafting?.held || 0)}</Text>
            </View>
          )}
        </View>

        <Text style={s.confirmNote}>
          The amount comes from the ledger and cannot be edited. It covers everything earned and released,
          and is frozen onto this draft.
        </Text>

        <SectionTitle title="How to pay" />
        {rails.map(option => (
          <Card key={option.id} style={rail === option.id ? { ...s.railCard, ...s.railCardActive } : s.railCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.railName}>
                {option.displayName}
                {option.isDefault ? ' · default' : ''}
              </Text>
              <Text style={s.railDescription}>
                {option.available ? option.description : option.unavailableReason}
              </Text>
            </View>
            <Button
              label={rail === option.id ? 'Chosen' : 'Choose'}
              variant={rail === option.id ? 'primary' : 'ghost'}
              onPress={() => setRail(option.id)}
              disabled={!option.available}
            />
          </Card>
        ))}

        {(drafting?.payable || 0) > (limits?.makerCheckerThreshold || Infinity) && (
          <View style={s.warnBox}>
            <ShieldAlert size={16} color={c.state.warning} />
            <Text style={s.warnText}>
              This is over {rupees(limits?.makerCheckerThreshold || 0)}, so a second administrator will have
              to approve it before it can be sent. You will not be able to approve it yourself.
            </Text>
          </View>
        )}

        {!!actionError && <Text style={s.errorText}>{actionError}</Text>}

        <Button label={busy ? 'Drafting…' : 'Draft it'} onPress={draft} disabled={busy || !rail} />
      </Sheet>

      {/* Sending */}
      <Sheet
        visible={!!sending}
        onClose={() => setSending(null)}
        title="Send this payment"
        subtitle={sending?.ownerName}
      >
        <View style={s.confirmBox}>
          <View style={s.confirmRow}>
            <Text style={s.confirmLabel}>Amount</Text>
            <Text style={s.confirmValue}>{rupees(sending?.amount || 0)}</Text>
          </View>
          <View style={s.confirmRow}>
            <Text style={s.confirmLabel}>Method</Text>
            <Text style={s.confirmValue}>
              {railFor(sending?.rail || '')?.displayName || sending?.rail}
            </Text>
          </View>
        </View>

        {railFor(sending?.rail || '')?.needsManualReference ? (
          <>
            <Text style={s.confirmNote}>
              Make the transfer in your banking app first, then record its reference here. This records that
              the money moved — it does not move it.
            </Text>
            <Field
              label="UTR or transaction reference"
              value={manualReference}
              onChangeText={setManualReference}
              placeholder="e.g. UTR9988776655"
              autoCapitalize="none"
              hint="A payment nobody can point at is not a payment."
            />
          </>
        ) : (
          <Text style={s.confirmNote}>
            This sends money to their verified account now. It cannot be recalled.
          </Text>
        )}

        {!!actionError && <Text style={s.errorText}>{actionError}</Text>}

        <Button
          label={busy ? 'Sending…' : `Send ${rupees(sending?.amount || 0)}`}
          onPress={send}
          disabled={
            busy ||
            (railFor(sending?.rail || '')?.needsManualReference === true && manualReference.trim().length < 4)
          }
        />
      </Sheet>

      {/* Counting cash in */}
      <Sheet
        visible={!!counting}
        onClose={() => setCounting(null)}
        title="Count this deposit in"
        subtitle={counting?.riderName || counting?.riderId}
      >
        <View style={s.confirmBox}>
          <View style={s.confirmRow}>
            <Text style={s.confirmLabel}>They declared</Text>
            <Text style={s.confirmValue}>{rupees(declaredRupees)}</Text>
          </View>
          <View style={s.confirmRow}>
            <Text style={s.confirmLabel}>They are carrying</Text>
            <Text style={s.confirmValue}>
              {rupees((counting?.cashInHandAtDeclarationPaise || 0) / 100)}
            </Text>
          </View>
        </View>

        <Text style={s.confirmNote}>
          Type what you counted, not what they said. Their balance comes down by this figure — confirming the
          declaration without counting is how money quietly goes missing.
        </Text>

        <Field
          label="Amount counted"
          value={countedAmount}
          onChangeText={text => setCountedAmount(text.replace(/[^0-9.]/g, ''))}
          keyboardType="numeric"
          placeholder="0.00"
          error={countedAmount && !countedValid ? 'Enter an amount.' : undefined}
        />

        {needsNote && (
          <>
            <View style={s.warnBox}>
              <TriangleAlert size={16} color={c.state.warning} />
              <Text style={s.warnText}>
                {countVariance < 0
                  ? `${rupees(Math.abs(countVariance))} short of what was declared. The shortfall stays against the rider — it is not written off.`
                  : `${rupees(countVariance)} more than was declared.`}{' '}
                Say what happened.
              </Text>
            </View>
            <Field
              label="What happened"
              value={varianceNote}
              onChangeText={setVarianceNote}
              multiline
              placeholder="e.g. two 500 notes short, rider says one customer underpaid"
              hint="This is the record anyone reviewing the difference later will read."
            />
          </>
        )}

        {!!actionError && <Text style={s.errorText}>{actionError}</Text>}

        <Button
          label={busy ? 'Recording…' : `Record ${countedValid ? rupees(counted) : 'deposit'}`}
          onPress={confirmDeposit}
          disabled={busy || !countedValid || (needsNote && varianceNote.trim().length < 4)}
        />
      </Sheet>
    </>
  );
};

const EarnRow: React.FC<{ label: string; value: number; hint?: string }> = ({ label, value, hint }) => (
  <View style={{ paddingVertical: 4 }}>
    <View style={s.earnRow}>
      <Text style={s.earnLabel}>{label}</Text>
      <Text style={[s.earnValue, value < 0 && { color: c.state.danger }]}>{rupees(value)}</Text>
    </View>
    {!!hint && <Text style={s.earnHint}>{hint}</Text>}
  </View>
);

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  errorCard: { borderColor: c.state.danger, marginBottom: 12 },
  errorText: { color: c.state.danger, fontSize: 13, marginTop: 8 },

  summaryCard: { marginBottom: 12 },
  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryCell: { flex: 1 },
  summaryValue: { color: c.text.primary, fontSize: 20, fontWeight: '800' },
  summaryLabel: { color: c.text.secondary, fontSize: 12, marginTop: 2 },
  limitsText: { color: c.text.muted, fontSize: 11, lineHeight: 16 },

  dueCard: { marginBottom: 10 },
  dueHead: { flexDirection: 'row', alignItems: 'flex-start' },
  dueName: { color: c.text.primary, fontSize: 15, fontWeight: '700' },
  dueType: { color: c.text.secondary, fontSize: 12, marginTop: 2 },
  dueAmount: { color: c.text.primary, fontSize: 17, fontWeight: '800' },
  dueHeld: { color: c.text.muted, fontSize: 11, marginTop: 2 },

  blockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10 },
  blockText: { color: c.state.danger, fontSize: 12, lineHeight: 17, flex: 1 },
  blockTextWarn: { color: c.state.warning, fontSize: 12, lineHeight: 17, flex: 1 },
  blockTextMuted: { color: c.text.muted, fontSize: 12, lineHeight: 17, flex: 1 },

  payoutCard: { marginBottom: 10 },
  payoutHead: { flexDirection: 'row', alignItems: 'flex-start' },
  reference: { color: c.text.secondary, fontSize: 12, marginTop: 6 },
  destination: { color: c.text.secondary, fontSize: 12, marginTop: 4, fontWeight: '600' },
  uncertain: { color: c.state.warning, fontSize: 12, lineHeight: 17, marginTop: 8 },

  confirmBox: { backgroundColor: c.bg.sunken, borderRadius: 10, padding: 12, marginBottom: 12 },
  confirmRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  confirmLabel: { color: c.text.muted, fontSize: 12 },
  confirmValue: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  confirmNote: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginBottom: 12 },

  railCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  railCardActive: { borderColor: c.brand.amberText },
  railName: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  railDescription: { color: c.text.secondary, fontSize: 12, marginTop: 2, lineHeight: 16 },

  warnBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: c.bg.sunken,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12
  },
  warnText: { color: c.state.warning, fontSize: 12, lineHeight: 17, flex: 1 },

  okTitle: { color: c.text.primary, fontSize: 15, fontWeight: '700' },
  okBody: { color: c.text.secondary, fontSize: 13, lineHeight: 19, marginTop: 6 },

  blockerCard: { marginBottom: 10 },
  blockerWhat: { color: c.text.primary, fontSize: 13, fontWeight: '700', lineHeight: 19, flex: 1 },
  blockerFix: { color: c.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 8 },

  earnedTotal: { color: c.text.primary, fontSize: 30, fontWeight: '800' },
  earnedCaption: { color: c.text.secondary, fontSize: 12, marginTop: 2 },
  earnRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  earnLabel: { color: c.text.secondary, fontSize: 13 },
  earnValue: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  earnHint: { color: c.state.danger, fontSize: 11, lineHeight: 16, marginTop: 2 },

  footnote: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 12 }
});
