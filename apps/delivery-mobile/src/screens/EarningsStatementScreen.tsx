import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { ReceiptText, ChevronDown, ChevronUp } from 'lucide-react-native';
import { t } from '../theme';
import { Card, SectionTitle, Pill, Button, EmptyState, LoadingBlock } from '../components/ui';
import {
  earningsApi,
  type ApiContext,
  type RiderStatementView,
  type OrderStatementView,
} from '../lib/api';

/**
 * Trip by trip: what was earned, and when it arrives.
 *
 * -------------------------------------------------------------------------
 * A RIDER IS OWED THE ARITHMETIC MORE THAN ANYBODY
 * -------------------------------------------------------------------------
 * They are usually the person on this platform who can least afford an
 * unexplained shortfall and has the least leverage to chase one. A payout
 * figure with nothing behind it is something they have to take on trust, week
 * after week, from a company they have never met.
 *
 * So every trip opens up: the trip earning, the tip in full, and anything that
 * came off afterwards with the reason as it was recorded.
 *
 * -------------------------------------------------------------------------
 * THERE IS NO LONGER ANYTHING TO ASK FOR
 * -------------------------------------------------------------------------
 * This screen used to carry an "Ask to be paid" button. It named no amount and
 * gated nothing, and its own footnote said as much — which is the problem. A
 * control that does nothing still teaches a rider that asking is part of getting
 * paid, and a rider who believes that reads a quiet week as their own fault and
 * asks harder. The money arrives on the run either way.
 *
 * The button is gone and the sentence that replaces it comes FROM THE SERVER,
 * because the version written here said "our daily run" while the configured
 * cadence was weekly. An app cannot read the pricing config, so the only way it
 * can tell the truth about a number it does not hold is to be told it.
 */

const rupees = (n: number) =>
  '₹' + Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signed = (n: number) => (n < 0 ? '− ' + rupees(n) : rupees(n));

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const TripRow: React.FC<{ order: OrderStatementView }> = ({ order }) => {
  const [open, setOpen] = useState(false);

  return (
    <Card style={{ marginBottom: 10 }}>
      <TouchableOpacity onPress={() => setOpen(v => !v)} activeOpacity={0.75}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={s.orderNumber}>#{order.orderNumber}</Text>
            <Text style={s.date}>{when(order.occurredAt)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={s.net}>{signed(order.net)}</Text>
            {order.settledByPayoutId ? (
              <Pill label="Paid" tone="go" />
            ) : order.released ? (
              <Pill label="Ready" tone="money" />
            ) : (
              <Pill label="On hold" tone="neutral" />
            )}
          </View>
          {open ? (
            <ChevronUp size={16} color={t.color.textMuted} />
          ) : (
            <ChevronDown size={16} color={t.color.textMuted} />
          )}
        </View>
      </TouchableOpacity>

      {open && (
        <View style={s.breakdown}>
          {order.lines.map((line, index) => (
            <View key={line.label + index} style={s.lineRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.lineLabel}>{line.label}</Text>
                {!!line.detail && <Text style={s.lineDetail}>{line.detail}</Text>}
              </View>
              <Text style={[s.lineAmount, line.amount < 0 && { color: t.color.danger }]}>
                {signed(line.amount)}
              </Text>
            </View>
          ))}

          <View style={s.lineTotal}>
            <Text style={s.lineTotalLabel}>You earned</Text>
            <Text style={s.lineTotalValue}>{signed(order.net)}</Text>
          </View>

          {order.unexplainedPaise !== 0 && (
            <Text style={s.unexplained}>
              {signed(order.unexplainedPaise / 100)} of this is not broken down above. Quote this trip number
              to support — it usually means the order predates our current rate records.
            </Text>
          )}
        </View>
      )}
    </Card>
  );
};

export const EarningsStatementScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const [data, setData] = useState<RiderStatementView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await earningsApi.statement(ctx);
        setData(next.statement);
        setError(null);
      } catch (err: any) {
        setError(err?.message || 'Could not load your statement.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [ctx]
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  if (loading) return <LoadingBlock label="Working out your statement…" />;

  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={t.color.brand} />
      }
      keyboardShouldPersistTaps="handled"
    >
      {!!error && (
        <Card>
          <Text style={s.errorText}>{error}</Text>
          <Button label="Try again" variant="secondary" onPress={() => void load('refresh')} style={{ marginTop: 12 }} />
        </Card>
      )}

      {data && (
        <>
          <Card>
            <View style={s.head}>
              <ReceiptText size={18} color={t.color.money} />
              <Text style={s.title}>Ready to be paid to you</Text>
            </View>
            <Text style={s.big}>{rupees(data.summary.payable)}</Text>

            {data.summary.held > 0 && (
              <Text style={s.sub}>
                {rupees(data.summary.held)} more is still inside the {data.holdDays}-day hold. It becomes
                payable by itself.
              </Text>
            )}

            <View style={s.row}>
              <Text style={s.rowLabel}>Paid to you so far</Text>
              <Text style={s.rowValue}>{rupees(data.summary.paid)}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Trips in this statement</Text>
              <Text style={s.rowValue}>{data.summary.ordersCount}</Text>
            </View>

            {/*
              * THE PROMISE, IN THE SERVER'S WORDS.
              *
              * This screen used to say "paid on our daily run" while the
              * configured cadence was weekly. It was hardcoded here because an
              * app cannot read the pricing config — so it is now sent with the
              * statement, from the one function that derives it from the rates.
              * Both sentences, both apps, one source.
              */}
            <Text style={s.promise}>{data.payoutPromise.arrival}</Text>
            <Text style={s.footnote}>{data.payoutPromise.noRequestNeeded}</Text>
          </Card>

          <SectionTitle>Trip by trip</SectionTitle>
          {data.orders.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ReceiptText size={28} color={t.color.textMuted} />}
                title="No trips in this period"
                message="Completed trips appear here with the full breakdown."
              />
            </Card>
          ) : (
            data.orders.map(order => <TripRow key={order.orderId} order={order} />)
          )}

          {data.payouts.length > 0 && (
            <>
              <SectionTitle>Payments sent to you</SectionTitle>
              {data.payouts.slice(0, 10).map(payout => (
                <Card key={payout.id} style={{ marginBottom: 10 }}>
                  <View style={s.head}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.orderNumber}>{rupees(payout.amount)}</Text>
                      <Text style={s.date}>
                        {payout.executedAt ? when(payout.executedAt) : 'Not sent yet'}
                        {payout.reference ? ' · ' + payout.reference : ''}
                      </Text>
                    </View>
                    <Pill
                      label={payout.state === 'PAID' ? 'Sent' : payout.state}
                      tone={payout.state === 'PAID' ? 'go' : payout.state === 'FAILED' ? 'danger' : 'neutral'}
                    />
                  </View>
                </Card>
              ))}
            </>
          )}

          <Text style={s.footnote}>
            Every figure comes from the same ledger your payment is drawn from, so a statement and a payment
            cannot disagree. Tips are paid across in full — we take no cut of a tip.
          </Text>
        </>
      )}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },

  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: t.color.text, fontSize: 16, fontWeight: '700', flex: 1 },
  sub: { color: t.color.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
  big: { color: t.color.text, fontSize: 34, fontWeight: '800', marginTop: 10 },

  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  rowLabel: { color: t.color.textSecondary, fontSize: 13 },
  rowValue: { color: t.color.text, fontSize: 13, fontWeight: '700' },

  promise: { color: t.color.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 14 },

  orderNumber: { color: t.color.text, fontSize: 15, fontWeight: '700' },
  date: { color: t.color.textMuted, fontSize: 12, marginTop: 2 },
  net: { color: t.color.text, fontSize: 17, fontWeight: '800' },

  breakdown: { marginTop: 12, borderTopWidth: 1, borderTopColor: t.color.border, paddingTop: 12 },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 5 },
  lineLabel: { color: t.color.text, fontSize: 13, fontWeight: '600' },
  lineDetail: { color: t.color.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 2 },
  lineAmount: { color: t.color.text, fontSize: 14, fontWeight: '700' },

  lineTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    marginTop: 8,
    paddingTop: 10
  },
  lineTotalLabel: { color: t.color.text, fontSize: 14, fontWeight: '700' },
  lineTotalValue: { color: t.color.text, fontSize: 16, fontWeight: '800' },

  unexplained: { color: t.color.danger, fontSize: 11, lineHeight: 16, marginTop: 10 },

  errorText: { color: t.color.danger, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  footnote: { color: t.color.textMuted, fontSize: 11, lineHeight: 16, marginTop: 10, textAlign: 'center' }
});

export default EarningsStatementScreen;
