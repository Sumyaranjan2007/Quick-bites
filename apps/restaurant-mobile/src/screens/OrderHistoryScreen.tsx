import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { Star } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Card, Pill, EmptyState, ErrorNote } from '../components/ui';
import { fetchOrderHistory } from '../lib/partnerApi';

type Scope = 'all' | 'completed' | 'cancelled';

interface Props {
  restaurantId: string;
}

const when = (iso?: string) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * What already happened.
 *
 * Kept apart from the live queue: the kitchen screen answers "what do I cook
 * now", and this answers "what did we do". Partners had no way to see a past
 * order at all, so a customer querying a bill from yesterday could not be helped.
 */
export const OrderHistoryScreen: React.FC<Props> = ({ restaurantId }) => {
  const [scope, setScope] = useState<Scope>('all');
  const [orders, setOrders] = useState<any[]>([]);
  const [counts, setCounts] = useState({ all: 0, completed: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (which: Scope, mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);

      const res = await fetchOrderHistory(restaurantId, which);
      if (!res.ok) {
        setError(res.message || 'Could not load your order history.');
      } else {
        setError(null);
        setOrders(res.data?.orders || []);
        if (res.data?.counts) setCounts(res.data.counts);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [restaurantId]
  );

  useEffect(() => {
    load(scope, 'initial');
  }, [scope, load]);

  const tabs: Array<{ key: Scope; label: string; count: number }> = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'completed', label: 'Completed', count: counts.completed },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled }
  ];

  const renderOrder = ({ item }: { item: any }) => {
    const cancelled = item.status === 'CANCELLED' || item.status === 'REFUNDED';
    return (
      <Card>
        <View style={styles.top}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderNumber}>{item.orderNumber}</Text>
            <Text style={styles.meta}>{when(item.deliveredAt || item.updatedAt || item.createdAt)}</Text>
          </View>
          <Pill label={item.status.replace(/_/g, ' ')} tone={cancelled ? 'danger' : 'success'} />
        </View>

        <View style={styles.lines}>
          {(item.items || []).map((line: any, idx: number) => (
            <Text key={`${item.id}-${idx}`} style={styles.line} numberOfLines={1}>
              {line.quantity}x {line.name}
              {line.selectedOptions?.length ? ` (${line.selectedOptions.map((o: any) => o.optionName).join(', ')})` : ''}
            </Text>
          ))}
        </View>

        <View style={styles.bottom}>
          <View>
            <Text style={styles.customer}>{item.customerName || 'Customer'}</Text>
            {typeof item.rating === 'number' && (
              <View style={styles.ratingRow}>
                <Star size={12} color={c.brand} fill={c.brand} />
                <Text style={styles.ratingText}>
                  {item.rating}
                  {item.ratingComment ? ` · "${item.ratingComment}"` : ''}
                </Text>
              </View>
            )}
            {cancelled && !!item.cancellationReason && (
              <Text style={styles.cancelReason}>
                {item.cancellationReasonCode === 'RESTAURANT_DID_NOT_RESPOND'
                  ? 'Cancelled automatically: it was not accepted in time. Accept new orders as soon as they ring to avoid this.'
                  : item.cancellationReason}
              </Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.total}>Rs {(Number(item.bill?.totalAmount) || 0).toFixed(2)}</Text>
            {!cancelled && (
              <Text style={styles.payout}>
                you earned Rs {(Number(item.bill?.restaurantNetPayout) || 0).toFixed(2)}
              </Text>
            )}
          </View>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {tabs.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, scope === t.key && styles.tabActive]}
            onPress={() => setScope(t.key)}
          >
            <Text style={[styles.tabText, scope === t.key && styles.tabTextActive]}>
              {t.label}
              {t.count > 0 ? ` (${t.count})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={c.brand} size="large" />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={o => o.id}
          renderItem={renderOrder}
          ListHeaderComponent={error ? <ErrorNote message={error} onRetry={() => load(scope, 'initial')} /> : null}
          ListEmptyComponent={
            <EmptyState
              title={scope === 'cancelled' ? 'No cancelled orders' : 'Nothing here yet'}
              body={
                scope === 'cancelled'
                  ? 'Orders you or a customer cancelled will be listed here.'
                  : 'Completed orders appear here once they have been delivered.'
              }
            />
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(scope, 'refresh')} tintColor={c.brand} />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabs: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.border
  },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radii.sm, alignItems: 'center', backgroundColor: c.surface },
  tabActive: { backgroundColor: c.border },
  tabText: { fontSize: 13, color: c.textMuted, fontWeight: '700' },
  tabTextActive: { color: c.brand },
  listContent: { padding: spacing.xl, paddingBottom: 48 },
  top: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  orderNumber: { fontSize: 15, fontWeight: '800', color: c.text },
  meta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  lines: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.md, marginBottom: spacing.md },
  line: { fontSize: 13, color: c.textSoft, marginBottom: 3 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  customer: { fontSize: 13, color: c.textMuted },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  ratingText: { fontSize: 12, color: c.textSoft, flexShrink: 1 },
  cancelReason: { fontSize: 12, color: c.danger, marginTop: 4 },
  total: { fontSize: 16, fontWeight: '800', color: c.text },
  payout: { fontSize: 12, color: c.success, marginTop: 2 }
});
