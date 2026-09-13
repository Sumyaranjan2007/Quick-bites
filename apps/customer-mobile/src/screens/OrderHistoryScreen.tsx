import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl
} from 'react-native';
import { ArrowLeft, Star, Receipt, Eye, EyeOff } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { Card } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';
import { useTranslation } from '../lib/i18n';

const c = tokens.colors;

interface Props {
  onBack: () => void;
  onOpenOrder: (order: any) => void;
  apiUrl?: string;
  token?: string;
}

const LIVE_STATUSES = ['ORDER_PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'OUT_FOR_DELIVERY'];

const STATUS_LABEL: Record<string, string> = {
  PAYMENT_PENDING: 'Payment pending',
  ORDER_PLACED: 'Order placed',
  ACCEPTED: 'Accepted',
  PREPARING: 'Being prepared',
  READY_FOR_PICKUP: 'Ready for pickup',
  RIDER_ASSIGNED: 'Rider assigned',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded'
};

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleString('en-IN', { month: 'short' });
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${day} ${month}, ${h % 12 === 0 ? 12 : h % 12}:${m} ${suffix}`;
}

export const OrderHistoryScreen: React.FC<Props> = ({ onBack, onOpenOrder, apiUrl, token }) => {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One switch for the whole list: someone hiding prices is hiding them from the
  // person beside them, not from one order at a time.
  const [amountsHidden, setAmountsHidden] = useState(false);

  const load = useCallback(async () => {
    if (!apiUrl || !token) return;
    try {
      const res = await apiFetch(`${apiUrl}/orders`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) {
        const list = data.data?.orders ?? data.data ?? [];
        setOrders(
          [...list].sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))
        );
        setError(null);
      } else {
        setError('Could not load your orders.');
      }
    } catch {
      setError('Could not reach Quick Bites. Check your connection.');
    }
  }, [apiUrl, token]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary[500]} />}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.8}>
          <ArrowLeft size={18} color={c.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('orders.title')}</Text>
        <TouchableOpacity
          style={styles.hideBtn}
          onPress={() => setAmountsHidden(h => !h)}
          activeOpacity={0.8}
          accessibilityLabel={amountsHidden ? 'Show amounts' : 'Hide amounts'}
        >
          {amountsHidden ? <Eye size={16} color={c.text.secondary} /> : <EyeOff size={16} color={c.text.secondary} />}
        </TouchableOpacity>
      </View>

      {orders === null ? (
        <ActivityIndicator color={c.primary[500]} style={{ marginTop: 40 }} />
      ) : error ? (
        <Card style={styles.block}>
          <Text style={styles.emptyText}>{error}</Text>
        </Card>
      ) : orders.length === 0 ? (
        <Card style={styles.block}>
          <Receipt size={26} color={c.text.muted} />
          <Text style={styles.emptyText}>{t('orders.empty')}</Text>
        </Card>
      ) : (
        orders.map(order => {
          const live = LIVE_STATUSES.includes(order.status);
          return (
            <Card key={order.id} style={styles.orderCard}>
              <View style={styles.orderTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.restaurant}>{order.restaurantName || 'Quick Bites order'}</Text>
                  <Text style={styles.orderMeta}>
                    #{order.orderNumber} · {formatDate(order.createdAt)}
                  </Text>
                </View>
                <View style={[styles.statusPill, live && styles.statusPillLive, order.status === 'DELIVERED' && styles.statusPillDone]}>
                  <Text
                    style={[
                      styles.statusText,
                      live && { color: c.accent[600] },
                      order.status === 'DELIVERED' && { color: c.dietary.veg }
                    ]}
                  >
                    {STATUS_LABEL[order.status] ?? order.status}
                  </Text>
                </View>
              </View>

              {(order.items ?? []).slice(0, 3).map((it: any, i: number) => (
                <Text key={i} style={styles.itemLine} numberOfLines={1}>
                  {it.quantity}× {it.name}
                </Text>
              ))}
              {(order.items ?? []).length > 3 && (
                <Text style={styles.itemLine}>+{order.items.length - 3} more</Text>
              )}

              <View style={styles.orderBottom}>
                <Text style={styles.total}>
                  {amountsHidden ? '₹ ••••' : `₹${Number(order.bill?.totalAmount ?? 0).toFixed(2)}`}
                </Text>

                <View style={styles.actions}>
                  {order.rating ? (
                    <View style={styles.ratedChip}>
                      <Star size={13} color={c.accent[500]} fill={c.accent[500]} />
                      <Text style={styles.ratedChipText}>
                        {order.rating}.0 {t('orders.rated')}
                      </Text>
                    </View>
                  ) : null}
                  <TouchableOpacity style={styles.openBtn} onPress={() => onOpenOrder(order)} activeOpacity={0.85}>
                    <Text style={styles.openBtnText}>
                      {live ? t('orders.viewOrder') : 'View details'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  hideBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: c.text.primary },
  block: { alignItems: 'center', paddingVertical: 34, gap: 10 },
  emptyText: { color: c.text.muted, fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
  orderCard: { marginBottom: 12 },
  orderTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  restaurant: { fontSize: 15.5, fontWeight: '800', color: c.text.primary },
  orderMeta: { fontSize: 12, color: c.text.muted, marginTop: 2 },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: c.surface.sunken
  },
  statusPillLive: { backgroundColor: c.accent[50] },
  statusPillDone: { backgroundColor: c.dietary.vegBg },
  statusText: { fontSize: 11, fontWeight: '800', color: c.text.secondary },
  itemLine: { fontSize: 13, color: c.text.secondary, marginTop: 2 },
  orderBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  total: { fontSize: 15.5, fontWeight: '800', color: c.text.primary },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.dietary.goldBg,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999
  },
  ratedChipText: { fontSize: 11, fontWeight: '700', color: c.dietary.gold },
  openBtn: {
    backgroundColor: c.primary[500],
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  openBtnText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' }
});
