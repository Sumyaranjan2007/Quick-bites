import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Banknote, Receipt, Percent, CheckCircle2 } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Card, SectionHeading, Metric, Pill, ErrorNote, EmptyState } from '../components/ui';
import { fetchSettlements } from '../lib/partnerApi';

interface Props {
  restaurantId: string;
  refreshSignal: number;
}

const rupees = (n: number) => `Rs ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  PAID: 'success',
  PROCESSING: 'warning',
  PENDING: 'muted',
  FAILED: 'danger'
};

/**
 * What the platform owes this kitchen, and what it has already paid.
 *
 * The dashboard could show takings, but a restaurant reconciling its bank
 * statement needs the other half: which orders are still awaiting payment, what
 * was deducted from them, and the reference of every transfer already made.
 * Every figure is computed by the server from this restaurant's own delivered
 * orders, so it agrees with what the administrator sees when they pay it.
 */
export const SettlementsScreen: React.FC<Props> = ({ restaurantId, refreshSignal }) => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      const res = await fetchSettlements(restaurantId);
      if (!res.ok) setError(res.message || 'Could not load your settlements.');
      else {
        setError(null);
        setData(res.data);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [restaurantId]
  );

  useEffect(() => {
    load('initial');
  }, [load, refreshSignal]);

  if (loading) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const summary = data?.summary || {};
  const pending = data?.pendingOrders || [];
  const history = data?.history || [];

  return (
    <ScrollView
      contentContainerStyle={s.body}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={c.brand} />}
    >
      {!!error && <ErrorNote message={error} onRetry={() => load('refresh')} />}

      <Card>
        <SectionHeading title="Awaiting settlement" sub="Delivered orders not yet paid across" />
        <Text style={s.headline}>{rupees(summary.netPending)}</Text>
        <Text style={s.headlineSub}>
          {summary.ordersAwaitingSettlement || 0} order{summary.ordersAwaitingSettlement === 1 ? '' : 's'} · last paid{' '}
          {when(summary.lastSettledAt)}
        </Text>

        <View style={s.splitRow}>
          <Metric label="Food sales" value={rupees(summary.grossPending)} />
          <Metric label="Commission" value={`- ${rupees(summary.commissionPending)}`} />
          <Metric label="TDS" value={`- ${rupees(summary.tdsPending)}`} />
        </View>
      </Card>

      <Card>
        <SectionHeading title="Paid to date" sub="Across every settled period" />
        <View style={s.splitRow}>
          <Metric label="Settled" value={rupees(summary.paidToDate)} tone="brand" />
          <Metric label="Orders delivered" value={String(summary.ordersAllTime || 0)} />
        </View>
      </Card>

      <Card>
        <SectionHeading title="Orders in the next settlement" sub="What the outstanding figure is made of" />
        {pending.length === 0 ? (
          <EmptyState title="Nothing outstanding" body="Every delivered order has been settled." />
        ) : (
          pending.map((line: any) => (
            <View key={line.orderId} style={s.line}>
              <View style={s.lineHead}>
                <Text style={s.lineNumber}>{line.orderNumber}</Text>
                <Text style={s.lineNet}>{rupees(line.net)}</Text>
              </View>
              <Text style={s.lineMeta}>
                {when(line.deliveredAt)} · sales {rupees(line.grossSales)} · commission {rupees(line.commission)} · TDS{' '}
                {rupees(line.tds)}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card>
        <SectionHeading title="Settlement history" sub="Every transfer, with its reference" />
        {history.length === 0 ? (
          <EmptyState title="No settlements yet" body="Your first settlement will appear here once it is drafted." />
        ) : (
          history.map((row: any) => (
            <View key={row.id} style={s.line}>
              <View style={s.lineHead}>
                <Text style={s.lineNumber}>{rupees(row.netAmount)}</Text>
                <Pill label={row.status} tone={STATUS_TONE[row.status] || 'muted'} />
              </View>
              <Text style={s.lineMeta}>
                {when(row.periodStart)} – {when(row.periodEnd)} · {row.ordersCount} order
                {row.ordersCount === 1 ? '' : 's'}
              </Text>
              <Text style={s.lineMeta}>
                Sales {rupees(row.grossSales)} · commission {rupees(row.commission)} · TDS {rupees(row.tds)}
                {row.adjustments ? ` · adjustments ${rupees(row.adjustments)}` : ''}
              </Text>
              {!!row.reference && <Text style={s.lineRef}>Reference {row.reference}</Text>}
              {row.status === 'PAID' && !!row.paidAt && (
                <Text style={s.linePaid}>Paid {when(row.paidAt)}</Text>
              )}
              {!!row.note && <Text style={s.lineMeta}>{row.note}</Text>}
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
  headline: { fontSize: 30, fontWeight: '800', color: c.text, marginTop: spacing.sm },
  headlineSub: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  splitRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, flexWrap: 'wrap' },
  line: {
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
    gap: 3
  },
  lineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  lineNumber: { fontSize: 14, fontWeight: '800', color: c.text, flexShrink: 1 },
  lineNet: { fontSize: 14, fontWeight: '800', color: c.brand },
  lineMeta: { fontSize: 11, color: c.textMuted, lineHeight: 17 },
  lineRef: { fontSize: 11, color: c.textSoft, fontWeight: '700' },
  linePaid: { fontSize: 11, color: c.success, fontWeight: '700' }
});
