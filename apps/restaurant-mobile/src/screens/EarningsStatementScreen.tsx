import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert, Modal } from 'react-native';
import { c } from '../theme';
import { Card, SectionHeading, Pill, Button, EmptyState, ErrorNote, Field } from '../components/ui';
import {
  fetchStatement,
  raisePayoutRequest,
  withdrawPayoutRequest,
  type StatementView,
  type OrderStatementView,
  type PayoutRequestView,
  fetchPaymentPolicies,
  fetchPaymentPolicy,
  type PolicySummaryView,
  type PolicyView
} from '../lib/partnerApi';

/**
 * What this kitchen earned, order by order, and asking to be paid it.
 *
 * -------------------------------------------------------------------------
 * WHY EVERY DEDUCTION IS NAMED SEPARATELY
 * -------------------------------------------------------------------------
 * A partner shown "settlement: ₹4,182" has two options when it looks wrong:
 * accept it, or accuse us. Both are bad, and the second is what actually
 * happens — repeatedly, by phone, to somebody who also cannot see the
 * arithmetic.
 *
 * Naming each line turns that into a conversation about one figure, and far
 * more often ends it before it starts, because the partner finds the answer
 * themselves. It costs us nothing to show, and the only reason not to would be
 * that we would rather they did not look.
 *
 * -------------------------------------------------------------------------
 * THE COMMISSION SHOWN IS THE ONE THAT WAS CHARGED
 * -------------------------------------------------------------------------
 * Every line is the rate FROZEN onto that order, not today's. A renegotiated
 * rate must not restate what this kitchen earned last month — if it did, a
 * partner would be right to distrust every figure we have ever shown them.
 *
 * -------------------------------------------------------------------------
 * AND ASKING IS NOT HOW YOU GET PAID
 * -------------------------------------------------------------------------
 * The button raises a request. It does not name an amount and it does not move
 * a settlement up a queue by itself — what it does is make somebody at our end
 * aware that this kitchen is waiting, with this statement attached. Everything
 * owed is paid on the daily run whether or not anyone asks, and the screen says
 * so, because a partner who believes they must ask will assume the quiet months
 * were their own fault.
 */

const rupees = (n: number) =>
  `₹${Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const signedRupees = (n: number) => (n < 0 ? `− ${rupees(n)}` : rupees(n));

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const OrderRow: React.FC<{ order: OrderStatementView }> = ({ order }) => {
  const [open, setOpen] = useState(false);

  return (
    <Card style={s.orderCard}>
      <TouchableOpacity onPress={() => setOpen(v => !v)} activeOpacity={0.7}>
        <View style={s.orderHead}>
          <View style={{ flex: 1 }}>
            <Text style={s.orderNumber}>#{order.orderNumber}</Text>
            <Text style={s.orderDate}>{when(order.occurredAt)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.orderNet}>{signedRupees(order.net)}</Text>
            {order.settledByPayoutId ? (
              <Pill label="Paid" tone="success" />
            ) : order.released ? (
              <Pill label="Ready to pay" tone="brand" />
            ) : (
              <Pill label="On hold" tone="warning" />
            )}
          </View>
        </View>
        <Text style={s.tapHint}>{open ? 'Tap to close' : 'Tap to see how this was worked out'}</Text>
      </TouchableOpacity>

      {open && (
        <View style={s.breakdown}>
          {order.lines.map((line, index) => (
            <View key={`${line.label}-${index}`} style={s.lineRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.lineLabel}>{line.label}</Text>
                {!!line.detail && <Text style={s.lineDetail}>{line.detail}</Text>}
              </View>
              <Text style={[s.lineAmount, line.amount < 0 && s.lineAmountNegative]}>
                {signedRupees(line.amount)}
              </Text>
            </View>
          ))}

          <View style={s.lineTotal}>
            <Text style={s.lineTotalLabel}>You earned</Text>
            <Text style={s.lineTotalValue}>{signedRupees(order.net)}</Text>
          </View>

          {order.unexplainedPaise !== 0 && (
            /*
             * Shown, not hidden.
             *
             * This only appears when the lines cannot account for the ledger
             * figure — nearly always an order placed before per-order rates
             * existed. A statement that quietly absorbed the difference into a
             * line would be a statement that lied to make itself tidy.
             */
            <Text style={s.unexplained}>
              {signedRupees(order.unexplainedPaise / 100)} of this is not broken down above. Contact support
              and quote this order number — it usually means the order predates our current rate records.
            </Text>
          )}
        </View>
      )}
    </Card>
  );
};

export const EarningsStatementScreen: React.FC = () => {
  const [data, setData] = useState<StatementView | null>(null);
  const [openRequest, setOpenRequest] = useState<PayoutRequestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const [policies, setPolicies] = useState<PolicySummaryView[]>([]);
  const [policyGaps, setPolicyGaps] = useState<string[]>([]);
  const [openPolicyDoc, setOpenPolicyDoc] = useState<PolicyView | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    const result = await fetchStatement();
    if (result.ok && result.data) {
      setData(result.data.statement);
      setOpenRequest(result.data.openRequest);
      setError(null);
    } else {
      setError(result.message || 'Could not load your statement.');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  // Fetched rather than bundled, so a revision reaches a kitchen the next time
  // they open this screen instead of the next time they update the app.
  useEffect(() => {
    void fetchPaymentPolicies().then(result => {
      if (result.ok && result.data) {
        setPolicies(result.data.policies);
        setPolicyGaps(result.data.gaps || []);
      }
    });
  }, []);

  const openPolicy = async (id: string) => {
    const result = await fetchPaymentPolicy(id);
    if (result.ok && result.data) setOpenPolicyDoc(result.data.policy);
  };

  const ask = async () => {
    setBusy(true);
    setAskError(null);
    const result = await raisePayoutRequest(note.trim() || undefined);
    if (result.ok) {
      setAsking(false);
      setNote('');
      await load('refresh');
    } else {
      setAskError(result.message || 'That could not be sent.');
    }
    setBusy(false);
  };

  const withdraw = () => {
    if (!openRequest) return;
    Alert.alert('Withdraw this request?', 'What you are owed is unchanged either way.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          await withdrawPayoutRequest(openRequest.id);
          await load('refresh');
        }
      }
    ]);
  };

  if (loading) {
    return (
      <View style={s.centre}>
        <Text style={s.centreText}>Working out your statement…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />}
      keyboardShouldPersistTaps="handled"
    >
      {!!error && <ErrorNote message={error} onRetry={() => void load('refresh')} />}

      {data && (
        <>
          <Card style={s.topCard}>
            <Text style={s.topLabel}>Ready to be paid to you</Text>
            <Text style={s.topValue}>{rupees(data.summary.payable)}</Text>

            {data.summary.held > 0 && (
              <Text style={s.topSub}>
                {rupees(data.summary.held)} more is inside the {data.holdDays}-day hold. It becomes payable by
                itself — nothing is required of you.
              </Text>
            )}

            <View style={s.topDivider} />

            <View style={s.topRow}>
              <Text style={s.topRowLabel}>Paid to you so far</Text>
              <Text style={s.topRowValue}>{rupees(data.summary.paid)}</Text>
            </View>
            <View style={s.topRow}>
              <Text style={s.topRowLabel}>Orders in this statement</Text>
              <Text style={s.topRowValue}>{data.summary.ordersCount}</Text>
            </View>

            {openRequest ? (
              <View style={s.askedBox}>
                <Text style={s.askedTitle}>You have asked to be paid</Text>
                <Text style={s.askedBody}>
                  Raised {when(openRequest.raisedAt)}. Our finance team can see this statement alongside it.
                </Text>
                <Button label="Withdraw the request" variant="ghost" onPress={withdraw} />
              </View>
            ) : (
              <Button
                label="Ask to be paid"
                onPress={() => {
                  setAsking(true);
                  setAskError(null);
                }}
                style={{ marginTop: 14 }}
              />
            )}

            <Text style={s.reassure}>
              You do not have to ask. Everything owed is paid on our daily run whether or not a request is
              raised — asking only tells us you are waiting.
            </Text>
          </Card>

          {asking && (
            <Card>
              <SectionHeading title="Anything we should know?" sub="Optional, and read by a person." />
              <Field
                label="Your note"
                value={note}
                onChangeText={setNote}
                placeholder="e.g. rent is due on the first"
                multiline
              />
              {!!askError && <ErrorNote message={askError} />}
              <Button label={busy ? 'Sending…' : 'Send the request'} onPress={ask} disabled={busy} />
              <Button label="Cancel" variant="ghost" onPress={() => setAsking(false)} />
            </Card>
          )}

          <SectionHeading
            title="Order by order"
            sub="Tap any order to see the food total, our commission at the rate on that order, and the tax withheld."
          />

          {data.orders.length === 0 ? (
            <EmptyState
              title="No orders in this period"
              body="Once orders are delivered they appear here with the full breakdown."
            />
          ) : (
            data.orders.map(order => <OrderRow key={order.orderId} order={order} />)
          )}

          {data.adjustments.length > 0 && (
            <>
              <SectionHeading
                title="Other adjustments"
                sub="Anything not tied to a single order, with the reason as it was recorded."
              />
              {data.adjustments.map(adjustment => (
                <Card key={adjustment.id} style={s.orderCard}>
                  <View style={s.orderHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.lineLabel}>{adjustment.narration}</Text>
                      <Text style={s.orderDate}>{when(adjustment.occurredAt)}</Text>
                    </View>
                    <Text style={[s.orderNet, adjustment.amount < 0 && s.lineAmountNegative]}>
                      {signedRupees(adjustment.amount)}
                    </Text>
                  </View>
                </Card>
              ))}
            </>
          )}

          {data.payouts.length > 0 && (
            <>
              <SectionHeading title="Payments sent to you" sub="With the reference each one can be traced by." />
              {data.payouts.slice(0, 10).map(payout => (
                <Card key={payout.id} style={s.orderCard}>
                  <View style={s.orderHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.orderNumber}>{rupees(payout.amount)}</Text>
                      <Text style={s.orderDate}>
                        {payout.executedAt ? when(payout.executedAt) : 'Not sent yet'}
                        {payout.reference ? ` · ${payout.reference}` : ''}
                      </Text>
                    </View>
                    <Pill
                      label={payout.state === 'PAID' ? 'Sent' : payout.state}
                      tone={payout.state === 'PAID' ? 'success' : payout.state === 'FAILED' ? 'danger' : 'muted'}
                    />
                  </View>
                </Card>
              ))}
            </>
          )}

          {/* ----------------------------- Policies ----------------------------- */}
          {/*
            At the bottom of the statement rather than in a tab of its own.
            A partner reaches for the settlement terms at exactly one moment —
            when a figure looks wrong — and that moment is spent looking at this
            screen. A policy two taps away in a menu is a policy nobody reads.
          */}
          <SectionHeading title="The terms these figures follow" />
          {policies.length === 0 ? (
            <Card>
              <Text style={s.policyRowSummary}>
                Our payment policies could not be loaded just now. Pull down to try again.
              </Text>
            </Card>
          ) : (
            policies.map(policy => (
              <TouchableOpacity key={policy.id} onPress={() => void openPolicy(policy.id)} activeOpacity={0.75}>
                <Card style={s.orderCard}>
                  <Text style={s.policyRowTitle}>{policy.title}</Text>
                  <Text style={s.policyRowSummary}>{policy.summary}</Text>
                </Card>
              </TouchableOpacity>
            ))
          )}

          {policyGaps.length > 0 && (
            <Text style={s.policyGap}>
              {policyGaps.join(' ')} We would rather show you that than leave the section looking complete.
            </Text>
          )}

          <Text style={s.footnote}>
            Every figure here comes from our ledger, which is the same record your payment is drawn from — a
            statement and a payment cannot disagree. Commission is shown at the rate that was on each order,
            not today’s.
          </Text>
        </>
      )}

      <Modal
        visible={!!openPolicyDoc}
        animationType="slide"
        transparent
        onRequestClose={() => setOpenPolicyDoc(null)}
      >
        <View style={s.policyOverlay}>
          <View style={s.policySheet}>
            <View style={s.policyHeader}>
              <Text style={s.policyTitle} numberOfLines={1}>
                {openPolicyDoc?.title}
              </Text>
              <TouchableOpacity
                onPress={() => setOpenPolicyDoc(null)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={s.policyClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.policyBody}>
              <Text style={s.policyDate}>Last updated {openPolicyDoc?.updatedAt}</Text>
              {(openPolicyDoc?.sections || []).map(section => (
                <View key={section.heading} style={{ marginTop: 18 }}>
                  <Text style={s.policyHeading}>{section.heading}</Text>
                  <Text style={s.policyText}>{section.body}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  centreText: { color: c.textMuted, fontSize: 14 },

  topCard: { marginBottom: 16 },
  topLabel: { color: c.textMuted, fontSize: 12, fontWeight: '600' },
  topValue: { color: c.text, fontSize: 34, fontWeight: '800', marginTop: 4 },
  topSub: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  topDivider: { height: 1, backgroundColor: c.border, marginVertical: 14 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  topRowLabel: { color: c.textMuted, fontSize: 13 },
  topRowValue: { color: c.text, fontSize: 13, fontWeight: '700' },

  askedBox: { marginTop: 14 },
  askedTitle: { color: c.text, fontSize: 14, fontWeight: '700' },
  askedBody: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: 10 },

  reassure: { color: c.textMuted, fontSize: 11, lineHeight: 16, marginTop: 12 },

  orderCard: { marginBottom: 10 },
  orderHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  orderNumber: { color: c.text, fontSize: 15, fontWeight: '700' },
  orderDate: { color: c.textMuted, fontSize: 12, marginTop: 2 },
  orderNet: { color: c.text, fontSize: 17, fontWeight: '800', marginBottom: 4 },
  tapHint: { color: c.textMuted, fontSize: 11, marginTop: 8 },

  breakdown: { marginTop: 12, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 5 },
  lineLabel: { color: c.text, fontSize: 13, fontWeight: '600' },
  lineDetail: { color: c.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  lineAmount: { color: c.text, fontSize: 14, fontWeight: '700' },
  lineAmountNegative: { color: c.danger },

  lineTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: c.border,
    marginTop: 8,
    paddingTop: 10
  },
  lineTotalLabel: { color: c.text, fontSize: 14, fontWeight: '700' },
  lineTotalValue: { color: c.text, fontSize: 16, fontWeight: '800' },

  unexplained: { color: c.danger, fontSize: 11, lineHeight: 16, marginTop: 10 },

  policyRowTitle: { color: c.text, fontSize: 14, fontWeight: '700' },
  policyRowSummary: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  policyGap: { color: c.warning, fontSize: 11, lineHeight: 16, marginTop: 8 },

  policyOverlay: { flex: 1, backgroundColor: 'rgba(23,19,19,0.55)', justifyContent: 'flex-end' },
  policySheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%'
  },
  policyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border
  },
  policyTitle: { color: c.text, fontSize: 17, fontWeight: '800', flex: 1 },
  policyClose: { color: c.brand, fontSize: 14, fontWeight: '700' },
  policyBody: { padding: 20, paddingBottom: 36 },
  policyDate: { color: c.textMuted, fontSize: 12 },
  policyHeading: { color: c.text, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  policyText: { color: c.textSoft, fontSize: 14, lineHeight: 21 },

  footnote: { color: c.textMuted, fontSize: 11, lineHeight: 16, marginTop: 16, textAlign: 'center' }
});

export default EarningsStatementScreen;
