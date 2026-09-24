import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { t } from '../theme';
import { Card, SectionTitle, Row, Pill, EmptyState, LoadingBlock, Divider } from '../components/ui';
import { api, type ApiContext, type SettlementsResponse } from '../lib/api';

const rupees = (n: number) =>
  `Rs ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const TONE: Record<string, 'go' | 'money' | 'danger' | 'neutral'> = {
  PAID: 'go',
  PROCESSING: 'money',
  PENDING: 'neutral',
  FAILED: 'danger'
};

/**
 * Settlement: the money side of the job, from the rider's point of view.
 *
 * Earnings answered "how much have I made"; this answers "how much have I been
 * paid, and when". A rider carrying cash from COD deliveries is holding money
 * that belongs to the platform and will be netted off their next payout, so it
 * is shown as a deduction here rather than appearing as an unexplained gap
 * between what was earned and what arrived.
 */
export const SettlementScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const [data, setData] = useState<SettlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      try {
        setData(await api.settlements(ctx));
        setError(null);
      } catch (err: any) {
        setError(err?.message || 'Could not load your settlement.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [ctx.apiUrl, ctx.token]
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  if (loading) return <LoadingBlock label="Loading your settlement…" />;

  const summary = data?.summary;
  const history = data?.history || [];
  const pendingTrips = data?.pendingTrips || [];

  return (
    <ScrollView
      contentContainerStyle={s.body}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={t.color.go} />}
    >
      {!!error && (
        <Card>
          <Text style={s.error}>{error}</Text>
        </Card>
      )}

      <Card tone="raised">
        <SectionTitle>Pending settlement</SectionTitle>
        <Text style={s.headline}>{rupees(summary?.netPending || 0)}</Text>
        <Text style={s.headlineSub}>
          {summary?.tripsAwaitingSettlement || 0} trip{summary?.tripsAwaitingSettlement === 1 ? '' : 's'} awaiting payment
        </Text>

        <Divider style={{ marginVertical: t.space[4] }} />

        <Row label="Trip earnings" value={rupees(summary?.tripEarningsPending || 0)} />
        <Row label="Incentives & bonuses" value={rupees(summary?.incentivesPending || 0)} />
        <Divider style={{ marginVertical: t.space[3] }} />
        <Row
          label="You will receive"
          value={rupees(summary?.netPending || 0)}
          valueStyle={{ color: t.color.go, fontWeight: '800' }}
        />

        {/*
          * CASH IS A BLOCK, NOT A DEDUCTION.
          *
          * This card used to show "Cash in hand (deducted)" as a negative line
          * and subtract it from the total. The platform does neither, and the
          * subtraction was wrong in both directions: a rider holding Rs 500
          * against Rs 1,800 of earnings was shown "you will receive Rs 1,300"
          * and would in fact receive nothing, because any of our cash in the bag
          * stops the payout outright; one holding Rs 2,000 against Rs 1,800 was
          * shown a NEGATIVE payout, which cannot happen.
          *
          * The reason comes from the same function the admin console drafts
          * payouts from, so a rider and the person paying them cannot be looking
          * at two different explanations of one hold.
          */}
        {!!summary?.payoutBlockedBy && (
          <View style={s.blocked}>
            <Text style={s.blockedTitle}>Nothing will be sent yet</Text>
            <Text style={s.blockedBody}>{summary.payoutBlockedBy}</Text>
            <Text style={s.blockedBody}>
              Your earnings are not reduced by it and nothing is lost — the full{' '}
              {rupees(summary?.netPending || 0)} is paid once this is cleared.
            </Text>
          </View>
        )}
      </Card>

      {!!summary?.cashInHand && (
        <Card>
          <SectionTitle>Our cash in your bag</SectionTitle>
          <Text style={s.headline}>{rupees(summary.cashInHand)}</Text>
          <Text style={s.headlineSub}>
            The same figure your Cash screen shows and the same one an administrator sees. It goes down when cash is
            counted in at the office, not when a trip is settled.
          </Text>
        </Card>
      )}

      <Card>
        <SectionTitle>Settled so far</SectionTitle>
        <Row label="Total paid to you" value={rupees(summary?.paidToDate || 0)} />
        <Row label="Trips completed" value={String(summary?.tripsAllTime || 0)} />
        <Row label="Last settled on" value={when(summary?.lastSettledAt)} />
      </Card>

      <Card>
        <SectionTitle>Trips in this settlement</SectionTitle>
        {pendingTrips.length === 0 ? (
          <EmptyState title="Nothing pending" message="Every trip you have completed has been settled." />
        ) : (
          pendingTrips.map(trip => (
            <View key={trip.orderId} style={s.line}>
              <View style={s.lineHead}>
                <Text style={s.lineTitle}>{trip.orderNumber}</Text>
                <Text style={s.lineValue}>{rupees(trip.earning)}</Text>
              </View>
              <Text style={s.lineMeta}>
                {when(trip.deliveredAt)}
                {trip.cashCollected ? ` · collected ${rupees(trip.cashCollected)} in cash` : ' · paid online'}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card>
        <SectionTitle>Payment history</SectionTitle>
        {history.length === 0 ? (
          <EmptyState title="No payments yet" message="Your settlements will be listed here once the first one is made." />
        ) : (
          history.map(row => (
            <View key={row.id} style={s.line}>
              <View style={s.lineHead}>
                <Text style={s.lineTitle}>{rupees(row.netAmount)}</Text>
                <Pill label={row.status} tone={TONE[row.status] || 'muted'} />
              </View>
              <Text style={s.lineMeta}>
                {when(row.periodStart)} – {when(row.periodEnd)} · {row.tripsCompleted} trip
                {row.tripsCompleted === 1 ? '' : 's'}
              </Text>
              <Text style={s.lineMeta}>
                Earnings {rupees(row.tripEarnings)} · incentives {rupees(row.incentives + row.bonuses)}
                {row.deductions ? ` · deductions ${rupees(row.deductions)}` : ''}
              </Text>
              {!!row.reference && <Text style={s.lineRef}>Reference {row.reference}</Text>}
              {row.status === 'PAID' && !!row.paidAt && <Text style={s.linePaid}>Paid {when(row.paidAt)}</Text>}
              {!!row.note && <Text style={s.lineMeta}>{row.note}</Text>}
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  body: { padding: t.space[4], gap: t.space[4], paddingBottom: t.space[8] },
  headline: { fontSize: 32, fontWeight: '800', color: t.color.text, marginTop: t.space[2] },
  headlineSub: { fontSize: 12, color: t.color.textMuted, marginTop: 2 },
  error: { color: t.color.danger, fontSize: 13, lineHeight: 19 },
  blocked: {
    marginTop: t.space[4],
    padding: t.space[3],
    borderRadius: 10,
    backgroundColor: t.color.surfaceSunken,
    borderLeftWidth: 3,
    borderLeftColor: t.color.warning,
    gap: 4
  },
  blockedTitle: { color: t.color.text, fontSize: 13, fontWeight: '800' },
  blockedBody: { color: t.color.textSecondary, fontSize: 12, lineHeight: 17 },
  line: { paddingVertical: t.space[3], borderTopWidth: 1, borderTopColor: t.color.border, gap: 3 },
  lineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space[3] },
  lineTitle: { fontSize: 14, fontWeight: '800', color: t.color.text, flexShrink: 1 },
  lineValue: { fontSize: 14, fontWeight: '800', color: t.color.go },
  lineMeta: { fontSize: 11, color: t.color.textMuted, lineHeight: 17 },
  lineRef: { fontSize: 11, color: t.color.textSecondary, fontWeight: '700' },
  linePaid: { fontSize: 11, color: t.color.go, fontWeight: '700' }
});
