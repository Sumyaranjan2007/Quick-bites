import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Navigation, TriangleAlert, Bike } from 'lucide-react-native';
import { Card, StatTile, Badge, Loading, EmptyState, KeyValue, Divider } from '../components/ui';
import { OrderDetailSheet } from '../components/OrderDetailSheet';
import { tokens, formatMoney, humanise, toneForStatus, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

/**
 * Deliveries in flight.
 *
 * Sorted by what needs somebody rather than by when it was placed: a trip nobody
 * has claimed, or one that has been running too long, is the reason this screen
 * is open. It refreshes on its own every twenty seconds, because an operator
 * watching a late delivery should not have to keep pulling the list.
 */
export const DeliveriesScreen: React.FC = () => {
  const { api } = useSession();
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const resource = useResource(() => api.get<any>('/admin/deliveries/live'), []);

  useEffect(() => {
    const timer = setInterval(() => {
      void resource.silentReload();
    }, 20000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (resource.loading && !resource.data) return <Loading label="Finding live trips…" />;
  if (!resource.data) {
    return (
      <EmptyState
        title={resource.denied ? 'Live deliveries are not on your role' : 'Could not load live deliveries'}
        message={resource.error || undefined}
      />
    );
  }

  const { deliveries, summary } = resource.data;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl refreshing={resource.loading} onRefresh={resource.reload} tintColor={c.brand.amber} />
        }
      >
        <View style={s.grid}>
          <StatTile label="In flight" value={summary.total} tone="info" icon={<Navigation size={16} color={c.state.info} />} />
          <StatTile label="With a rider" value={summary.inTransit} tone="success" icon={<Bike size={16} color={c.state.success} />} />
          <StatTile label="Unassigned" value={summary.unassigned} tone="warning" />
          <StatTile label="Running late" value={summary.delayed} tone="danger" icon={<TriangleAlert size={16} color={c.state.danger} />} />
        </View>

        {deliveries.length === 0 ? (
          <EmptyState title="Nothing is out for delivery" message="Every order on the platform has been completed or closed." />
        ) : null}

        {deliveries.map((delivery: any) => (
          <Card key={delivery.id} onPress={() => setOpenOrderId(delivery.id)}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.orderNumber} numberOfLines={1}>
                  #{delivery.orderNumber}
                </Text>
                <Text style={s.route} numberOfLines={1}>
                  {delivery.restaurantName} → {delivery.customerName}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Badge label={delivery.status} tone={toneForStatus(delivery.status)} />
                {delivery.isDelayed ? <Badge label="Late" tone="danger" /> : null}
              </View>
            </View>

            <Divider />

            <KeyValue label="Delivery partner" value={delivery.riderName || 'Waiting for a rider'} tone="strong" />
            {delivery.riderStage ? <KeyValue label="Stage" value={humanise(delivery.riderStage)} /> : null}
            <KeyValue label="Dropping at" value={delivery.deliveryAddressText} />
            {delivery.riderCoordinates ? (
              <KeyValue
                label="Rider position"
                value={`${delivery.riderCoordinates.latitude.toFixed(4)}, ${delivery.riderCoordinates.longitude.toFixed(4)} · ${timeAgo(
                  delivery.riderLocationUpdatedAt
                )}`}
              />
            ) : null}

            <View style={s.rowBottom}>
              <Text style={s.amount}>{formatMoney(delivery.totalAmount)}</Text>
              <Text style={[s.elapsed, delivery.isDelayed && { color: c.state.danger }]}>
                {delivery.minutesSincePlaced} min since it was placed
              </Text>
            </View>
          </Card>
        ))}
      </ScrollView>

      <OrderDetailSheet orderId={openOrderId} onClose={() => setOpenOrderId(null)} onChanged={resource.silentReload} />
    </View>
  );
};

const s = StyleSheet.create({
  scroll: { padding: tokens.space[5], paddingBottom: tokens.space[8] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[3], marginBottom: tokens.space[4] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  orderNumber: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.heavy, color: c.text.primary },
  route: { fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: 3 },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: tokens.space[3],
    paddingTop: tokens.space[3],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    gap: tokens.space[3]
  },
  amount: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.heavy, color: c.brand.amberText },
  elapsed: { flexShrink: 1, fontSize: tokens.font.size.xxs, color: c.text.muted, textAlign: 'right' }
});
