import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Banknote, ShieldAlert, Clock, CircleSlash, Send, Info } from 'lucide-react-native';
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

  const [tab, setTab] = useState('due');
  const [drafting, setDrafting] = useState<DueRow | null>(null);
  const [rail, setRail] = useState<string>('');
  const [sending, setSending] = useState<PayoutRow | null>(null);
  const [manualReference, setManualReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!canView) return <NoAccess permission="finance.payouts.view" />;
  if (dues.loading && !dues.data) return <Loading label="Working out who is owed what…" />;

  const payload = dues.data;
  const rails = payload?.rails || [];
  const limits = payload?.limits;

  const reloadAll = async () => {
    await dues.reload();
    void history.silentReload();
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
            { key: 'due', label: `Owed${payload ? ` (${payload.summary.payableCount})` : ''}` },
            {
              key: 'sending',
              label: `To send${pendingApproval.length + readyToSend.length ? ` (${pendingApproval.length + readyToSend.length})` : ''}`
            },
            { key: 'history', label: 'Sent' }
          ]}
          value={tab}
          onChange={setTab}
        />

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
    </>
  );
};

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
  warnText: { color: c.state.warning, fontSize: 12, lineHeight: 17, flex: 1 }
});
