import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Star, TrendingUp, Clock, Package } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Card, SectionHeading, Metric, Pill, ErrorNote, EmptyState } from '../components/ui';
import { fetchDashboard } from '../lib/partnerApi';

interface Props {
  restaurantId: string;
  refreshSignal: number;
}

const rupees = (n: number) => `Rs ${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/**
 * The partner's home screen.
 *
 * Every figure comes from the server's dashboard endpoint, which derives them
 * from this restaurant's own orders at request time. Nothing here is estimated
 * or carried in the app: a partner reconciles their bank statement against the
 * payout number, so an invented one would be worse than no number at all.
 */
export const DashboardScreen: React.FC<Props> = ({ restaurantId, refreshSignal }) => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'quiet') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);

      const res = await fetchDashboard(restaurantId);
      if (!res.ok) {
        setError(res.message || 'Could not load your dashboard.');
      } else {
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
  }, [load]);

  useEffect(() => {
    if (refreshSignal > 0) load('quiet');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={c.brand} size="large" />
      </View>
    );
  }

  const d = data?.dashboard;
  const maxTrend = Math.max(1, ...(d?.revenueTrend || []).map((p: any) => p.revenue));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={c.brand} />}
    >
      {!!error && <ErrorNote message={error} onRetry={() => load('initial')} />}

      {!d ? (
        <EmptyState title="No data yet" body="Your dashboard fills in as orders come through." />
      ) : (
        <>
          <Card>
            <SectionHeading title="Earnings" sub="What you keep, after platform commission" />
            <Text style={styles.bigMoney}>{rupees(d.revenue.netPayout)}</Text>
            <Text style={styles.bigMoneySub}>
              from {d.orders.delivered} delivered order{d.orders.delivered === 1 ? '' : 's'}
            </Text>

            <View style={styles.metricRow}>
              <Metric label="Today" value={rupees(d.revenue.today)} tone="brand" />
              <Metric label="Last 7 days" value={rupees(d.revenue.last7Days)} />
            </View>
            <View style={styles.metricRow}>
              <Metric label="Last 30 days" value={rupees(d.revenue.last30Days)} />
              <Metric label="Average order" value={rupees(d.revenue.averageOrderValue)} />
            </View>
          </Card>

          <Card>
            <SectionHeading title="Last 14 days" sub="Daily earnings" />
            {d.revenueTrend.every((p: any) => p.revenue === 0) ? (
              <Text style={styles.quietNote}>No delivered orders in this period yet.</Text>
            ) : (
              <View style={styles.chart}>
                {d.revenueTrend.map((point: any) => (
                  <View key={point.date} style={styles.barColumn}>
                    <View
                      style={[
                        styles.bar,
                        { height: Math.max(3, (point.revenue / maxTrend) * 96) },
                        point.revenue === 0 && styles.barEmpty
                      ]}
                    />
                    <Text style={styles.barLabel}>{point.date.slice(8)}</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>

          <Card>
            <SectionHeading title="Orders" />
            <View style={styles.metricRow}>
              <Metric label="Total" value={String(d.orders.total)} />
              <Metric label="Delivered" value={String(d.orders.delivered)} />
            </View>
            <View style={styles.metricRow}>
              <Metric label="Cancelled" value={String(d.orders.cancelled)} />
              <Metric label="In kitchen now" value={String(d.orders.active)} tone="brand" />
            </View>
            <View style={styles.inlineStat}>
              <Package size={14} color={c.textMuted} />
              <Text style={styles.inlineStatText}>
                {d.orders.completionRate}% of finished orders were delivered rather than cancelled
              </Text>
            </View>
            {d.preparation.averageMinutes !== null && (
              <View style={styles.inlineStat}>
                <Clock size={14} color={c.textMuted} />
                <Text style={styles.inlineStatText}>
                  Average preparation time {d.preparation.averageMinutes} minutes, across{' '}
                  {d.preparation.ordersMeasured} orders
                </Text>
              </View>
            )}
          </Card>

          <Card>
            <SectionHeading title="Ratings" />
            {d.ratings.count === 0 ? (
              <Text style={styles.quietNote}>No customer has rated an order yet.</Text>
            ) : (
              <>
                <View style={styles.ratingHead}>
                  <Star size={22} color={c.brand} fill={c.brand} />
                  <Text style={styles.ratingValue}>{d.ratings.average?.toFixed(1)}</Text>
                  <Text style={styles.ratingCount}>from {d.ratings.count} ratings</Text>
                </View>
                {[5, 4, 3, 2, 1].map(star => {
                  const count = d.ratings.distribution[star - 1] || 0;
                  const share = d.ratings.count ? (count / d.ratings.count) * 100 : 0;
                  return (
                    <View key={star} style={styles.distRow}>
                      <Text style={styles.distStar}>{star}★</Text>
                      <View style={styles.distTrack}>
                        <View style={[styles.distFill, { width: `${share}%` }]} />
                      </View>
                      <Text style={styles.distCount}>{count}</Text>
                    </View>
                  );
                })}
              </>
            )}
          </Card>

          <Card>
            <SectionHeading title="Best sellers" sub="By units sold" />
            {d.topDishes.length === 0 ? (
              <Text style={styles.quietNote}>Nothing has sold yet.</Text>
            ) : (
              d.topDishes.slice(0, 6).map((dish: any, i: number) => (
                <View key={dish.dishId} style={styles.dishRow}>
                  <Text style={styles.dishRank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dishName} numberOfLines={1}>
                      {dish.name}
                    </Text>
                    <Text style={styles.dishMeta}>
                      {dish.unitsSold} sold · {rupees(dish.revenue)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </Card>

          <Card>
            <SectionHeading title="Categories" sub="Where your revenue comes from" />
            {d.categories.length === 0 ? (
              <Text style={styles.quietNote}>No category has sold yet.</Text>
            ) : (
              d.categories.map((cat: any) => (
                <View key={cat.categoryName} style={styles.dishRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dishName}>{cat.categoryName}</Text>
                    <Text style={styles.dishMeta}>{cat.unitsSold} items</Text>
                  </View>
                  <Text style={styles.catMoney}>{rupees(cat.revenue)}</Text>
                </View>
              ))
            )}
          </Card>

          <Card>
            <SectionHeading title="Menu health" />
            <View style={styles.metricRow}>
              <Metric label="Items" value={String(d.menu.totalItems)} />
              <Metric label="In stock" value={String(d.menu.availableItems)} />
            </View>
            <View style={styles.metricRow}>
              <Metric label="Out of stock" value={String(d.menu.outOfStockItems)} />
              <Metric label="Never ordered" value={String(d.menu.neverOrdered)} />
            </View>
            {d.menu.outOfStockItems > 0 && (
              <View style={{ marginTop: spacing.md }}>
                <Pill label={`${d.menu.outOfStockItems} marked unavailable`} tone="warning" />
              </View>
            )}
          </Card>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { padding: spacing.xl, paddingBottom: 48 },
  centre: { flex: 1, backgroundColor: c.bg, justifyContent: 'center', alignItems: 'center' },
  bigMoney: { fontSize: 34, fontWeight: '800', color: c.brand },
  bigMoneySub: { fontSize: 13, color: c.textMuted, marginTop: 2, marginBottom: spacing.lg },
  metricRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.lg },
  quietNote: { fontSize: 13, color: c.textMuted, lineHeight: 19 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 124, paddingTop: spacing.md },
  barColumn: { flex: 1, alignItems: 'center' },
  bar: { width: '78%', backgroundColor: c.brand, borderRadius: 3 },
  barEmpty: { backgroundColor: c.border },
  barLabel: { fontSize: 9, color: c.textMuted, marginTop: 6 },
  inlineStat: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm },
  inlineStatText: { fontSize: 12, color: c.textMuted, flex: 1, lineHeight: 17 },
  ratingHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.lg },
  ratingValue: { fontSize: 30, fontWeight: '800', color: c.text },
  ratingCount: { fontSize: 13, color: c.textMuted, marginLeft: 4 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: 6 },
  distStar: { fontSize: 12, color: c.textMuted, width: 24 },
  distTrack: { flex: 1, height: 7, backgroundColor: c.border, borderRadius: 4, overflow: 'hidden' },
  distFill: { height: 7, backgroundColor: c.brand },
  distCount: { fontSize: 12, color: c.textMuted, width: 28, textAlign: 'right' },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border
  },
  dishRank: { fontSize: 14, fontWeight: '800', color: c.brand, width: 20 },
  dishName: { fontSize: 14, color: c.text, fontWeight: '600' },
  dishMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  catMoney: { fontSize: 14, fontWeight: '800', color: c.text }
});
