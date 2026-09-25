import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Banknote, ShieldAlert, Clock, CircleSlash, Send, Info, Wallet, TriangleAlert, Landmark } from 'lucide-react-native';
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
  ResourceError,
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
  /**
   * Where the money WILL land. Null when nothing is connected.
   *
   * Not `destination`: PayoutRow below has one of those, meaning where money
   * WENT. Same screen, adjacent rows, opposite meanings -- so they are named
   * apart, and a shared renderer cannot quietly take the wrong one.
   */
  willPayInto: {
    method: 'BANK' | 'VPA';
    holderName: string;
    accountLast4?: string;
    ifsc?: string;
    vpa?: string;
  } | null;
}

/**
 * Where a payment is going, on the row that offers to send it.
 *
 * Nobody should press Send having seen only a name and an amount. The
 * destination is the one part of a payout that cannot be undone afterwards, and
 * until now it lived on a different screen entirely -- so checking it meant
 * leaving the row, and a step somebody has to remember to take is a step that
 * gets skipped on a busy payday.
 */
const WillPayInto: React.FC<{ willPayInto: DueRow['willPayInto'] }> = ({ willPayInto: destination }) => {
  if (!destination) return null;
  return (
    <View style={s.blockRow}>
      <Landmark size={14} color={c.text.muted} />
      <Text style={s.blockText}>
        {destination.method === 'VPA'
          ? `${destination.holderName} · ${destination.vpa}`
          : `${destination.holderName} · ending ${destination.accountLast4 || '----'}${
              destination.ifsc ? ` · ${destination.ifsc}` : ''
            }`}
      </Text>
    </View>
  );
};

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
  /** Cash counted in at the office and not yet banked. Absent on older servers. */
  officeCash?: number;
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
  /*
   * Narrower than `canPay` on purpose.
   *
   * POST /gateway/settlements requires `finance.payouts.manage` alone, so
   * somebody holding only `finance.settlements.manage` would be shown a button
   * that returns 403 — which reads as a broken app rather than as a permission
   * they do not have.
   */
  const canRecordSettlement = can('finance.payouts.manage');

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

  /*
   * What Razorpay is holding, and what it has kept.
   *
   * Both figures were invisible until money in was fixed: an online payment
   * booked straight to the bank, so money still at the gateway looked like money
   * in the account, and the gateway's fee was recorded nowhere at all. The owner
   * would read their statement, find it short, and have nothing here explaining
   * why.
   */
  const gateway = useResource<{
    atGateway: number;
    feesKeptToDate: number;
    prepaidForUndeliveredFood: number;
    note: string;
  }>(() => api.get('/admin/gateway/receivable').then(r => r.data), [], { enabled: canView });

  /*
   * What people have actually ASKED for.
   *
   * The endpoint existed and nothing called it, so a partner or rider raising
   * "ask to be paid" reached the server and stopped there — recorded, and
   * invisible to the only person who could act on it. Everyone owed money is
   * already under Owed whether or not they asked; this is the list of people
   * who are waiting for an answer, which is a different question.
   */
  const requests = useResource<{
    requests: Array<{
      id: string;
      ownerType: 'RESTAURANT' | 'RIDER';
      ownerId: string;
      ownerName: string;
      raisedAt: string;
      note?: string;
      status: string;
      payableAtRequest: number;
      payableNow: number;
      payableNowPaise: number;
      movedSinceRequest: boolean;
      blockedReason: string | null;
      willPayInto: DueRow['willPayInto'];
    }>;
  }>(() => api.get('/admin/payouts/requests').then(r => r.data), [], { enabled: canView });

  const [tab, setTab] = useState('overview');
  const [drafting, setDrafting] = useState<DueRow | null>(null);
  const [rail, setRail] = useState<string>('');
  const [sending, setSending] = useState<PayoutRow | null>(null);
  const [manualReference, setManualReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /* Counting cash in. */
  const [counting, setCounting] = useState<DepositRow | null>(null);
  // Office desk: cash taken from a rider who declared nothing, and cash banked.
  const [takingFrom, setTakingFrom] = useState<string | null>(null);
  const [takenAmount, setTakenAmount] = useState('');
  const [bankAmount, setBankAmount] = useState('');
  const [bankReference, setBankReference] = useState('');
  // A held order is released with a sentence saying what was checked.
  const [releaseNotes, setReleaseNotes] = useState<Record<string, string>>({});
  // Cancelling a drafted or approved payout puts what they are owed back in the queue.
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [countedAmount, setCountedAmount] = useState('');
  const [varianceNote, setVarianceNote] = useState('');

  /*
   * Recording a settlement. Three fields, and all three are TRANSCRIBED.
   *
   * The names match the columns on Razorpay's settlement page exactly, because
   * every one of them is copied off it and a label that does not match the page
   * it is read from is how the wrong column gets typed. Nothing here is worked
   * out by the person at the keyboard: what the gateway discharged is derived on
   * the server from these three, so no two entries can disagree.
   */
  const [recordingSettlement, setRecordingSettlement] = useState(false);
  const [settledAmount, setSettledAmount] = useState('');
  const [settledFees, setSettledFees] = useState('');
  const [settledTax, setSettledTax] = useState('');
  const [settlementRef, setSettlementRef] = useState('');
  const [settlementNote, setSettlementNote] = useState('');

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
    void gateway.silentReload();
  };

  /** Runs one desk action, reloads everything, and shows what went wrong if it did. */
  const deskAction = async (work: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await work();
      await reloadAll();
      return true;
    } catch (err: any) {
      setActionError(err?.message || failure);
      return false;
    } finally {
      setBusy(false);
    }
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

  /*
   * Recording what the gateway actually paid in.
   *
   * A person reads the statement and types what is on it, and the server checks
   * the arithmetic rather than trusting it: a settlement larger than the gateway
   * is holding is refused, and so is the same settlement id twice. Both refusals
   * come back as readable sentences, which is why `actionError` is shown rather
   * than swallowed.
   *
   * Razorpay's settlement API could do this without a person one day. There are
   * no live keys yet, and a feature that only works once there are is a feature
   * that does not work.
   */
  const settledNum = Number(settledAmount.replace(/[^0-9.]/g, ''));
  const feesNum = Number(settledFees.replace(/[^0-9.]/g, '') || 0);
  const taxNum = Number(settledTax.replace(/[^0-9.]/g, '') || 0);
  const settlementValid =
    Number.isFinite(settledNum) &&
    settledNum > 0 &&
    Number.isFinite(feesNum) &&
    feesNum >= 0 &&
    Number.isFinite(taxNum) &&
    taxNum >= 0 &&
    settlementRef.trim().length >= 3;
  /** What the gateway took out of what it was holding. Shown, never typed. */
  const settlementDischarged = settlementValid
    ? Math.round((settledNum + feesNum + taxNum) * 100) / 100
    : 0;

  const recordSettlement = async () => {
    if (!settlementValid) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post('/admin/gateway/settlements', {
        amountSettled: Number(settledNum.toFixed(2)),
        fees: Number(feesNum.toFixed(2)),
        tax: Number(taxNum.toFixed(2)),
        reference: settlementRef.trim(),
        ...(settlementNote.trim() ? { note: settlementNote.trim() } : {})
      });
      setRecordingSettlement(false);
      setSettledAmount('');
      setSettledFees('');
      setSettledTax('');
      setSettlementRef('');
      setSettlementNote('');
      await reloadAll();
    } catch (err: any) {
      setActionError(err?.message || 'That settlement could not be recorded.');
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
            {
              key: 'asked',
              label: `Asked${requests.data?.requests.length ? ` (${requests.data.requests.length})` : ''}`
            },
            { key: 'history', label: 'Sent' },
            {
              key: 'cash',
              label: `Cash in${cash.data?.awaiting.length ? ` (${cash.data.awaiting.length})` : ''}`
            },
            { key: 'gateway', label: 'Card & UPI in' }
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
                        {blocker.where === 'HELD' &&
                          (overview.data.held || []).map((row: any) => (
                            <View key={row.orderId} style={{ marginTop: 12 }}>
                              <Text style={s.dueName}>
                                #{row.orderNumber || row.orderId}
                                {row.restaurantName ? ` · ${row.restaurantName}` : ''}
                              </Text>
                              <Text style={s.blockTextMuted}>{row.reason}</Text>
                              {canPay && (
                                <>
                                  <Field
                                    label="What you checked"
                                    value={releaseNotes[row.orderId] || ''}
                                    onChangeText={text => setReleaseNotes(prev => ({ ...prev, [row.orderId]: text }))}
                                    placeholder="Called the customer, food arrived"
                                  />
                                  <Button
                                    label="It was real — release the earnings"
                                    variant="secondary"
                                    disabled={busy || (releaseNotes[row.orderId] || '').trim().length < 8}
                                    onPress={() =>
                                      void deskAction(
                                        () =>
                                          api.post(`/admin/payments/held/${row.orderId}/release`, {
                                            note: (releaseNotes[row.orderId] || '').trim()
                                          }),
                                        'That order could not be released.'
                                      )
                                    }
                                  />
                                </>
                              )}
                            </View>
                          ))}
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

                <WillPayInto willPayInto={row.willPayInto} />

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
            {!!actionError && <Text style={s.errorText}>{actionError}</Text>}
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
                    {canPay && cancelling !== payout.id && (
                      <Button
                        label="Cancel this payment"
                        variant="ghost"
                        onPress={() => {
                          setCancelling(payout.id);
                          setCancelReason('');
                          setActionError(null);
                        }}
                        disabled={busy}
                        style={{ marginTop: 6 }}
                      />
                    )}
                    {canPay && cancelling === payout.id && (
                      <View style={{ marginTop: 10 }}>
                        <Field label="Why it is being cancelled" value={cancelReason} onChangeText={setCancelReason} placeholder="Wrong account, will redo" />
                        <Button
                          label="Cancel it — they stay owed"
                          variant="danger"
                          disabled={busy || cancelReason.trim().length < 3}
                          onPress={async () => {
                            const ok = await deskAction(
                              () => api.post(`/admin/payouts/${payout.id}/cancel`, { reason: cancelReason.trim() }),
                              'That payment could not be cancelled.'
                            );
                            if (ok) setCancelling(null);
                          }}
                        />
                        <Button label="Keep it" variant="ghost" onPress={() => setCancelling(null)} style={{ marginTop: 6 }} />
                      </View>
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
                    {canPay && cancelling !== payout.id && (
                      <Button
                        label="Cancel this payment"
                        variant="ghost"
                        onPress={() => {
                          setCancelling(payout.id);
                          setCancelReason('');
                          setActionError(null);
                        }}
                        disabled={busy}
                        style={{ marginTop: 6 }}
                      />
                    )}
                    {canPay && cancelling === payout.id && (
                      <View style={{ marginTop: 10 }}>
                        <Field label="Why it is being cancelled" value={cancelReason} onChangeText={setCancelReason} placeholder="Wrong account, will redo" />
                        <Button
                          label="Cancel it — they stay owed"
                          variant="danger"
                          disabled={busy || cancelReason.trim().length < 3}
                          onPress={async () => {
                            const ok = await deskAction(
                              () => api.post(`/admin/payouts/${payout.id}/cancel`, { reason: cancelReason.trim() }),
                              'That payment could not be cancelled.'
                            );
                            if (ok) setCancelling(null);
                          }}
                        />
                        <Button label="Keep it" variant="ghost" onPress={() => setCancelling(null)} style={{ marginTop: 6 }} />
                      </View>
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

        {/* ------------------------- Asked to be paid ------------------------- */}
        {tab === 'asked' && <ResourceError resource={requests} what="Who has asked to be paid" />}
        {tab === 'asked' &&
          ((requests.data?.requests.length || 0) === 0 && !requests.error ? (
            <EmptyState
              title="Nobody is waiting on an answer"
              message="When a restaurant or rider asks to be paid, they appear here with what they are owed right now. Everyone owed money is under Owed whether or not they have asked."
              icon={<Send size={28} color={c.text.muted} />}
            />
          ) : (requests.data?.requests.length || 0) === 0 ? null : (
            (requests.data?.requests || []).map(request => (
              <Card key={request.id} style={s.payoutCard}>
                <View style={s.payoutHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dueName}>{request.ownerName}</Text>
                    <Text style={s.dueType}>
                      {request.ownerType === 'RESTAURANT' ? 'Restaurant' : 'Rider'} · asked{' '}
                      {timeAgo(request.raisedAt)}
                    </Text>
                  </View>
                  <Text style={s.dueAmount}>{rupees(request.payableNow)}</Text>
                </View>

                {/*
                  * Both figures whenever they differ.
                  *
                  * What they were owed when they asked is not what they are owed
                  * now — a refund may have landed in between. The gap between the
                  * two numbers is exactly what a partner telephones about, and
                  * showing only the current one leaves whoever answers with no
                  * idea why the caller is quoting something else.
                  */}
                {request.movedSinceRequest && (
                  <Text style={s.askedMoved}>
                    They asked for {rupees(request.payableAtRequest)}. It is {rupees(request.payableNow)}{' '}
                    now — orders have been refunded or settled since.
                  </Text>
                )}

                {!!request.note && <Text style={s.askedNote}>“{request.note}”</Text>}

                <WillPayInto willPayInto={request.willPayInto} />

                {request.blockedReason ? (
                  <Text style={s.askedBlocked}>{request.blockedReason}</Text>
                ) : (
                  <Text style={s.askedReady}>
                    Ready to pay. Draft it from Owed, where the amount comes from the ledger rather
                    than from what they asked for.
                  </Text>
                )}
              </Card>
            ))
          ))}

        {tab === 'history' && <ResourceError resource={history} what="What you have sent" />}
        {tab === 'history' &&
          (rest.length === 0 && !history.error ? (
            <EmptyState title="Nothing sent yet" message="Payments you send will be listed here with their references." />
          ) : rest.length === 0 ? null : (
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

            {!!actionError && <Text style={s.errorText}>{actionError}</Text>}

            {/* Office cash -> bank. Recorded after the deposit slip is in hand. */}
            {canPay && (
              <Card style={s.dueCard}>
                <Text style={s.dueName}>Cash in the office: {rupees(cash.data?.officeCash ?? 0)}</Text>
                <Text style={s.blockTextMuted}>
                  Counted in from riders and not yet in the bank. When you pay it in, record the slip here so
                  payday knows the money is in the bank.
                </Text>
                <Field label="Amount paid into the bank (Rs)" value={bankAmount} onChangeText={setBankAmount} keyboardType="numeric" />
                <Field label="Deposit slip or reference" value={bankReference} onChangeText={setBankReference} placeholder="SBI slip 004512" />
                <Button
                  label="Record bank deposit"
                  variant="secondary"
                  disabled={busy || !(Number(bankAmount) > 0) || !bankReference.trim()}
                  onPress={async () => {
                    const ok = await deskAction(
                      () =>
                        api.post('/admin/cash/bank-deposits', {
                          amount: Number(bankAmount),
                          reference: bankReference.trim()
                        }),
                      'The bank deposit could not be recorded.'
                    );
                    if (ok) {
                      setBankAmount('');
                      setBankReference('');
                    }
                  }}
                  style={{ marginTop: 10 }}
                />
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

                  {/* A rider at the desk who declared nothing in the app. */}
                  {canPay && takingFrom !== row.riderId && (
                    <Button
                      label="They are here — take cash"
                      variant="ghost"
                      onPress={() => {
                        setTakingFrom(row.riderId);
                        setTakenAmount(String(row.cashInHand));
                        setActionError(null);
                      }}
                      disabled={busy}
                      style={{ marginTop: 10 }}
                    />
                  )}
                  {canPay && takingFrom === row.riderId && (
                    <View style={{ marginTop: 10 }}>
                      <Field label="Amount you counted (Rs)" value={takenAmount} onChangeText={setTakenAmount} keyboardType="numeric" />
                      <Button
                        label="Record cash received"
                        variant="success"
                        disabled={busy || !(Number(takenAmount) > 0)}
                        onPress={async () => {
                          const ok = await deskAction(
                            () => api.post('/admin/cash/returns', { riderId: row.riderId, amount: Number(takenAmount) }),
                            'The cash could not be recorded.'
                          );
                          if (ok) {
                            setTakingFrom(null);
                            setTakenAmount('');
                          }
                        }}
                      />
                      <Button label="Cancel" variant="ghost" onPress={() => setTakingFrom(null)} style={{ marginTop: 6 }} />
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

        {/* --------------------------- Card & UPI in -------------------------- */}
        {tab === 'gateway' && (
          <>
            {/*
              FOUR STATES, EACH SAID OUT LOUD.

              Fourteen admin screens render `useResource().error` nowhere at all,
              so a failed load shows as an empty page and whoever is looking
              concludes there is nothing to do. On this tab that conclusion is
              expensive: "the gateway is holding nothing" and "we could not ask"
              look identical, and one of them means a settlement is sitting
              unrecorded.

              So loading, refused, failed and empty are four different things, and
              each one says which it is.
            */}
            {gateway.loading && !gateway.data ? (
              <Loading label="Asking what the gateway is holding…" />
            ) : gateway.denied ? (
              <EmptyState
                title="You cannot see gateway money"
                message="This needs the finance payouts or reports permission. Ask whoever manages roles."
                icon={<CircleSlash size={28} color={c.text.muted} />}
              />
            ) : gateway.error ? (
              <Card style={s.errorCard}>
                <Text style={s.errorText}>{gateway.error}</Text>
                <Text style={s.confirmNote}>
                  This is not the same as the gateway holding nothing — we could not ask it. Nothing has been
                  lost; try again.
                </Text>
                <Button label="Try again" variant="secondary" onPress={() => void gateway.reload()} />
              </Card>
            ) : (
              <>
                <Card style={s.dueCard}>
                  <View style={s.dueHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dueType}>At Razorpay, not yet settled</Text>
                      <Text style={s.summaryValue}>{rupees(gateway.data!.atGateway)}</Text>
                    </View>
                    <Landmark size={26} color={c.text.muted} />
                  </View>
                  <Text style={s.confirmNote}>{gateway.data!.note}</Text>

                  <Divider />

                  <View style={s.confirmRow}>
                    <Text style={s.confirmLabel}>Fees kept to date</Text>
                    <Text style={s.confirmValue}>{rupees(gateway.data!.feesKeptToDate)}</Text>
                  </View>
                  <Text style={s.confirmNote}>
                    About 2% plus GST on every card and UPI order. This was recorded nowhere at all until now,
                    which is why your bank statement never quite matched.
                  </Text>

                  <Divider />

                  <View style={s.confirmRow}>
                    <Text style={s.confirmLabel}>Paid by customers for food not yet delivered</Text>
                    <Text style={s.confirmValue}>{rupees(gateway.data!.prepaidForUndeliveredFood)}</Text>
                  </View>
                  <Text style={s.confirmNote}>
                    Normal while orders are out. If it stays high when nothing is on the road, a cancelled
                    order’s refund did not go through and somebody is owed their money back.
                  </Text>
                </Card>

                {gateway.data!.atGateway <= 0 ? (
                  <EmptyState
                    title="The gateway is not holding anything"
                    message="Everything it has collected has been settled. There is nothing to record today."
                    icon={<Banknote size={28} color={c.text.muted} />}
                  />
                ) : (
                  <Card style={s.dueCard}>
                    <Text style={s.dueName}>Has money landed in your bank?</Text>
                    <Text style={s.confirmNote}>
                      Open Settlements on your Razorpay dashboard, find the row for the money that arrived, and
                      copy the three figures it shows. Recording it moves the amount above into your bank and
                      puts the gateway’s fee on the books as the expense it is.
                    </Text>
                    {canRecordSettlement ? (
                      <Button
                        label="Record a settlement"
                        onPress={() => {
                          setRecordingSettlement(true);
                          setSettledAmount('');
                          setSettledFees('');
                          setSettledTax('');
                          setSettlementRef('');
                          setSettlementNote('');
                          setActionError(null);
                        }}
                        disabled={busy}
                        style={{ marginTop: 10 }}
                      />
                    ) : (
                      /*
                       * Not shown rather than shown-and-refused. A button that
                       * 403s teaches somebody that the app is broken, when what
                       * is actually true is that this is not their job.
                       */
                      <View style={s.blockRow}>
                        <Info size={14} color={c.text.muted} />
                        <Text style={s.blockTextMuted}>
                          Recording a settlement needs the finance payouts permission.
                        </Text>
                      </View>
                    )}
                  </Card>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Recording what the gateway actually paid in */}
      <Sheet
        visible={recordingSettlement}
        onClose={() => setRecordingSettlement(false)}
        title="Record a settlement"
        subtitle="Copy the three figures from Razorpay’s settlement row"
      >
        <Text style={s.confirmNote}>
          Type what the statement says, not what you expect. Do NOT use the “collected” figure from the
          dashboard — that is payments before refunds, and on a day with a refund it is far larger than what
          actually arrived.
        </Text>

        <Field
          label="Amount settled"
          value={settledAmount}
          onChangeText={text => setSettledAmount(text.replace(/[^0-9.]/g, ''))}
          keyboardType="numeric"
          placeholder="0.00"
          hint="What reached your bank account."
        />
        <Field
          label="Fees"
          value={settledFees}
          onChangeText={text => setSettledFees(text.replace(/[^0-9.]/g, ''))}
          keyboardType="numeric"
          placeholder="0.00"
          hint="The gateway’s own charge, from the Fees column."
        />
        <Field
          label="Tax"
          value={settledTax}
          onChangeText={text => setSettledTax(text.replace(/[^0-9.]/g, ''))}
          keyboardType="numeric"
          placeholder="0.00"
          hint="GST on those fees, from the Tax column."
        />
        <Field
          label="Settlement id"
          value={settlementRef}
          onChangeText={setSettlementRef}
          placeholder="setl_XXXXXXXXXXXX"
          hint="From the same row. It is what stops one settlement being recorded twice."
        />
        <Field
          label="Note (optional)"
          value={settlementNote}
          onChangeText={setSettlementNote}
          multiline
          placeholder="Anything worth remembering about this one"
        />

        {/*
          The total, shown BEFORE anything is sent.

          Nothing here is typed — it is the three figures above added up. A typo
          in the amount settled shows up as a total that does not match what the
          gateway is holding, which is visible on this screen a moment before the
          server would have refused it.
        */}
        {settlementValid && (
          <View style={s.confirmBox}>
            <View style={s.confirmRow}>
              <Text style={s.confirmLabel}>Leaves “At Razorpay”</Text>
              <Text style={s.confirmValue}>{rupees(settlementDischarged)}</Text>
            </View>
            <View style={s.confirmRow}>
              <Text style={s.confirmLabel}>Razorpay is holding</Text>
              <Text style={s.confirmValue}>{rupees(gateway.data?.atGateway || 0)}</Text>
            </View>
          </View>
        )}

        {settlementValid && settlementDischarged > (gateway.data?.atGateway || 0) && (
          <View style={s.warnBox}>
            <TriangleAlert size={16} color={c.state.warning} />
            <Text style={s.warnText}>
              That adds up to more than the gateway is holding, so it will be refused. Check the amount settled
              came from the settlement row and not from the day’s payments.
            </Text>
          </View>
        )}

        {/*
          The server's own words, not a generic failure.

          Both refusals here are written to be acted on: one names what the
          gateway is holding against what was asked for, and the other names what
          was recorded the first time and on what date. Replacing either with
          "Something went wrong" throws away the only useful part.
        */}
        {!!actionError && <Text style={s.errorText}>{actionError}</Text>}

        <Button
          label={busy ? 'Recording…' : 'Record it'}
          onPress={recordSettlement}
          disabled={busy || !settlementValid}
        />
      </Sheet>

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
askedMoved: { color: c.state.warning, fontSize: 12, marginTop: 10, lineHeight: 17 },
  askedNote: { color: c.text.secondary, fontSize: 13, marginTop: 10, fontStyle: 'italic' as const },
  askedBlocked: { color: c.state.danger, fontSize: 12, marginTop: 10, lineHeight: 17 },
  askedReady: { color: c.text.secondary, fontSize: 12, marginTop: 10, lineHeight: 17 },
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
