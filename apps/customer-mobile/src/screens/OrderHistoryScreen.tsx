import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert
} from 'react-native';
import { ArrowLeft, Star, Receipt, Eye, EyeOff, X } from 'lucide-react-native';
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

/** Must match the server's RefundRequestSchema enum exactly. */
const REFUND_REASONS = [
  { key: 'ITEM_MISSING', label: 'Something was missing' },
  { key: 'WRONG_ITEM', label: 'Wrong item sent' },
  { key: 'FOOD_QUALITY', label: 'Food quality' },
  { key: 'SPILLED_DAMAGED', label: 'Spilled or damaged' },
  { key: 'LATE_DELIVERY', label: 'Arrived far too late' },
  { key: 'NEVER_ARRIVED', label: 'Never arrived' },
  { key: 'OTHER', label: 'Something else' }
];

export const OrderHistoryScreen: React.FC<Props> = ({ onBack, onOpenOrder, apiUrl, token }) => {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One switch for the whole list: someone hiding prices is hiding them from the
  // person beside them, not from one order at a time.
  const [amountsHidden, setAmountsHidden] = useState(false);

  // Reporting a problem on a delivered order. It opens a case for an
  // administrator to decide; it does not refund anything by itself, and the
  // wording says so rather than implying the money is already on its way.
  const [problemOrder, setProblemOrder] = useState<any | null>(null);
  const [reasonCode, setReasonCode] = useState('ITEM_MISSING');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);

  const submitProblem = async () => {
    setProblemError(null);
    if (description.trim().length < 10) {
      setProblemError('Tell us what went wrong, in a sentence or two.');
      return;
    }
    const requested = Number(amount);
    const orderTotal = Number(problemOrder?.bill?.totalAmount) || 0;
    if (requested > orderTotal) {
      setProblemError(`You cannot ask for more than the order total of ₹${Math.round(orderTotal)}.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(`${apiUrl}/support/refund-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          orderId: problemOrder.id,
          reasonCode,
          description: description.trim(),
          ...(requested > 0 ? { requestedAmount: requested } : {})
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setProblemError(data?.error?.message || data?.error || 'Your request could not be sent.');
        return;
      }
      setProblemOrder(null);
      setDescription('');
      Alert.alert(
        'Request received',
        'Our team will review what happened and come back to you. You can follow it under Help & support.'
      );
    } catch {
      setProblemError('Could not reach Quick Bites. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

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
                  {/* A delivered order that went wrong needs a route to a refund
                      from the order itself. Sending the customer to a phone
                      number is how a complaint ends up with nobody. */}
                  {order.status === 'DELIVERED' ? (
                    <TouchableOpacity
                      style={styles.problemBtn}
                      onPress={() => {
                        setProblemOrder(order);
                        setReasonCode('ITEM_MISSING');
                        setDescription('');
                        setAmount(String(Math.round(order.bill?.totalAmount ?? 0)));
                        setProblemError(null);
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.problemBtnText}>Report a problem</Text>
                    </TouchableOpacity>
                  ) : null}
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

      <Modal visible={!!problemOrder} transparent animationType="slide" onRequestClose={() => setProblemOrder(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Report a problem</Text>
                <Text style={styles.sheetSub}>
                  Order #{problemOrder?.orderNumber} · {problemOrder?.restaurantName}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setProblemOrder(null)} activeOpacity={0.8}>
                <X size={19} color={c.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>What went wrong?</Text>
              <View style={styles.reasonWrap}>
                {REFUND_REASONS.map(reason => (
                  <TouchableOpacity
                    key={reason.key}
                    style={[styles.reason, reasonCode === reason.key && styles.reasonActive]}
                    onPress={() => setReasonCode(reason.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.reasonText, reasonCode === reason.key && styles.reasonTextActive]}>
                      {reason.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Tell us what happened</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={description}
                onChangeText={setDescription}
                placeholder="One of the two biryanis was missing from the bag."
                placeholderTextColor={c.text.muted}
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.label}>How much should come back? (₹)</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                placeholderTextColor={c.text.muted}
              />
              <Text style={styles.helper}>
                This opens a request — our team reviews it and credits your Quick Bites wallet if it is approved.
              </Text>

              {!!problemError && <Text style={styles.error}>{problemError}</Text>}

              <TouchableOpacity
                style={[styles.primaryBtn, submitting && { opacity: 0.5 }]}
                onPress={submitProblem}
                disabled={submitting}
                activeOpacity={0.88}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Send request</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  problemBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: tokens.radii.md,
    backgroundColor: c.dietary.nonvegBg,
    marginRight: 'auto'
  },
  problemBtnText: { color: c.dietary.nonveg, fontSize: 12.5, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,10,14,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '88%'
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: c.text.primary },
  sheetSub: { fontSize: 12.5, color: c.text.muted, marginTop: 3 },
  label: { fontSize: 12, fontWeight: '700', color: c.text.secondary, marginBottom: 7, marginTop: 12 },
  input: {
    backgroundColor: c.surface.sunken,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 14,
    height: 46,
    fontSize: 15,
    color: c.text.primary
  },
  inputMultiline: { height: 106, paddingTop: 12 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: tokens.radii.full,
    backgroundColor: c.surface.sunken,
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  reasonActive: { backgroundColor: c.primary[500], borderColor: c.primary[500] },
  reasonText: { fontSize: 13, color: c.text.secondary, fontWeight: '600' },
  reasonTextActive: { color: '#FFFFFF', fontWeight: '700' },
  helper: { fontSize: 12, color: c.text.muted, marginTop: 8, lineHeight: 17 },
  error: { color: c.semantic.error, fontSize: 13, marginTop: 12, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: c.primary[500],
    height: 50,
    borderRadius: tokens.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    marginBottom: 8
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
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
