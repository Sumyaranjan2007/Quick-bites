import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { ShoppingBag } from 'lucide-react-native';
import { Card, SearchBar, Segmented, Badge, Loading, EmptyState, Button } from '../components/ui';
import { OrderDetailSheet } from '../components/OrderDetailSheet';
import { tokens, formatMoney, timeAgo, humanise, toneForStatus } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

const c = tokens.colors;

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'ORDER_PLACED,ACCEPTED,PREPARING,READY_FOR_PICKUP,HANDED_TO_RIDER,OUT_FOR_DELIVERY', label: 'Live' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'REFUNDED', label: 'Refunded' },
  { key: 'PAYMENT_PENDING', label: 'Unpaid' }
];

/** Every order on the platform, filterable, with the whole file one tap away. */
export const OrdersScreen: React.FC = () => {
  const { api } = useSession();
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [page, setPage] = useState(1);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const resource = useResource(
    () => api.get<any>(`/admin/orders${query({ status, q: submitted, page, pageSize: 25 })}`),
    [status, submitted, page]
  );

  const orders = resource.data?.orders || [];
  const pagination = resource.data?.pagination;
  const totals = resource.data?.totals;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Order number, customer, restaurant, rider"
          onSubmit={() => {
            setPage(1);
            setSubmitted(search.trim());
          }}
        />
        <Segmented
          options={FILTERS}
          value={status}
          onChange={next => {
            setPage(1);
            setStatus(next);
          }}
        />
        {totals ? (
          <Text style={s.summary}>
            {pagination?.total ?? 0} order{(pagination?.total ?? 0) === 1 ? '' : 's'} · {formatMoney(totals.value)} billed · {totals.delivered} delivered ·{' '}
            {totals.cancelled} cancelled
          </Text>
        ) : null}
      </View>

      {resource.loading && orders.length === 0 ? <Loading label="Loading orders…" /> : null}

      {!resource.loading && orders.length === 0 ? (
        <EmptyState
          title={resource.denied ? 'Orders are not on your role' : 'No orders match'}
          message={resource.error || 'Try a different filter or search term.'}
          icon={<ShoppingBag size={36} color={c.text.muted} />}
        />
      ) : null}

      {orders.length > 0 ? (
        <ScrollView
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={resource.loading} onRefresh={resource.reload} tintColor={c.brand.amber} />
          }
        >
          {orders.map((order: any) => (
            <Card key={order.id} onPress={() => setOpenOrderId(order.id)}>
              <View style={s.rowTop}>
                <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                  <Text style={s.orderNumber} numberOfLines={1}>
                    #{order.orderNumber}
                  </Text>
                  <Text style={s.restaurant} numberOfLines={1}>
                    {order.restaurantName}
                  </Text>
                </View>
                <Badge label={order.status} tone={toneForStatus(order.status)} />
              </View>

              <View style={s.metaGrid}>
                <View style={s.metaCell}>
                  <Text style={s.metaLabel}>Customer</Text>
                  <Text style={s.metaValue} numberOfLines={1}>
                    {order.customerName}
                  </Text>
                </View>
                <View style={s.metaCell}>
                  <Text style={s.metaLabel}>Delivery partner</Text>
                  <Text style={s.metaValue} numberOfLines={1}>
                    {order.riderName || 'Unassigned'}
                  </Text>
                </View>
              </View>

              <View style={s.rowBottom}>
                <Text style={s.amount}>{formatMoney(order.totalAmount)}</Text>
                <Text style={s.meta} numberOfLines={1}>
                  {order.itemCount} item{order.itemCount === 1 ? '' : 's'} · {humanise(order.paymentMethod)} ·{' '}
                  {timeAgo(order.createdAt)}
                </Text>
              </View>
            </Card>
          ))}

          {pagination && pagination.totalPages > 1 ? (
            <View style={s.pager}>
              <Button
                label="Previous"
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onPress={() => setPage(p => Math.max(1, p - 1))}
              />
              <Text style={s.pagerText}>
                Page {pagination.page} of {pagination.totalPages}
              </Text>
              <Button
                label="Next"
                variant="secondary"
                size="sm"
                disabled={page >= pagination.totalPages}
                onPress={() => setPage(p => p + 1)}
              />
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      <OrderDetailSheet orderId={openOrderId} onClose={() => setOpenOrderId(null)} onChanged={resource.silentReload} />
    </View>
  );
};

const s = StyleSheet.create({
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  summary: { fontSize: tokens.font.size.xs, color: c.text.muted, marginBottom: tokens.space[3] },
  list: { paddingHorizontal: tokens.space[5], paddingBottom: tokens.space[8] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  orderNumber: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.heavy, color: c.text.primary },
  restaurant: { fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: 2 },
  metaGrid: {
    flexDirection: 'row',
    gap: tokens.space[4],
    marginTop: tokens.space[3],
    paddingTop: tokens.space[3],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  metaCell: { flex: 1, minWidth: 0 },
  metaLabel: { fontSize: tokens.font.size.xxs, color: c.text.muted },
  metaValue: { fontSize: tokens.font.size.sm, color: c.text.primary, marginTop: 2 },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: tokens.space[3],
    gap: tokens.space[3]
  },
  amount: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.heavy, color: c.brand.amberText },
  meta: { flexShrink: 1, fontSize: tokens.font.size.xxs, color: c.text.muted, textAlign: 'right' },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: tokens.space[4],
    gap: tokens.space[3]
  },
  pagerText: { color: c.text.muted, fontSize: tokens.font.size.xs }
});
