import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Modal, RefreshControl } from 'react-native';
import { Clock, CheckCircle2, Minus, Plus, BellRing, VolumeX } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Card, Button, Pill, EmptyState, ErrorNote } from '../components/ui';
import { fetchLiveOrders, updateOrderStatus, fetchCancellationReasons } from '../lib/partnerApi';
import { stopOrderAlert, announceOrder, markOrdersSeen, hasTakenBaseline } from '../lib/orderAlert';

/** The kitchen cannot promise faster than this, and the customer is shown the figure. */
const MIN_PREP_MINUTES = 10;
const MAX_PREP_MINUTES = 120;
const DEFAULT_PREP_MINUTES = 20;

interface Props {
  restaurantId: string;
  /** Bumped by the parent whenever a socket event says something changed. */
  refreshSignal: number;
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
}

/**
 * The kitchen queue.
 *
 * Two things were wrong with the previous version and both are fixed here.
 *
 * The whole app shared one ScrollView across all four tabs, so the scroll offset
 * was carried between them and re-clamped whenever a refresh changed the content
 * height — the "it jumps back to the top" the partner reported. This screen owns
 * its own FlatList with a stable keyExtractor, and a refresh now merges by order
 * id rather than replacing the array, so rows that did not change keep their
 * identity and the list stays where the reader left it.
 *
 * A new order also arrives silently no longer: the first time an unseen order id
 * appears, the alert rings and a notification is raised.
 */
export const LiveOrdersScreen: React.FC<Props> = ({
  restaurantId,
  refreshSignal,
  soundEnabled,
  onToggleSound
}) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [acceptTarget, setAcceptTarget] = useState<any | null>(null);
  /**
   * Rejecting an order now requires a reason, because the server refuses a
   * cancellation without one. That is deliberate: a kitchen that rejects orders
   * is telling operations something, and "CANCELLED" on its own tells them
   * nothing they can act on.
   */
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Array<{ code: string; label: string; allowsNote: boolean }>>([]);
  const [rejectCode, setRejectCode] = useState('');
  const [prepMinutes, setPrepMinutes] = useState(DEFAULT_PREP_MINUTES);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);


  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'quiet') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);

      const res = await fetchLiveOrders(restaurantId);

      if (!res.ok) {
        setError(res.message || 'Could not load your orders.');
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setError(null);

      const live = (res.data?.orders || []).filter(
        (o: any) => !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status)
      );

      /*
       * THE FALLBACK, not the alert itself.
       *
       * The socket rings from the app shell now, so this fires only on the
       * mobile networks where websockets are blocked and polling is all there
       * is. `announceOrder` keeps the record of what has already rung, at
       * module scope, so the two paths cannot ring for the same order and the
       * record survives this screen being unmounted — which it is, every time
       * the kitchen looks at any other tab.
       *
       * This logic used to live here alone, with the seen-set in component
       * state. That is why a kitchen sitting on the dashboard heard nothing:
       * the only code that could ring was on a screen that was not mounted.
       */
      if (!hasTakenBaseline()) {
        // Opening mid-service must not set off an alarm for work already on the
        // pass. The first list seen establishes the baseline — including an
        // EMPTY one, which is why this asks whether a baseline was taken rather
        // than whether anything has been seen.
        markOrdersSeen(live.map((o: any) => o.id));
      } else if (soundEnabled) {
        for (const o of live) {
          void announceOrder({
            id: o.id,
            orderNumber: o.orderNumber,
            itemCount: (o.items || []).length,
            total: Number(o.bill?.totalAmount) || 0
          });
        }
      } else {
        // Sound is off, but these have still been SEEN. Without this, turning
        // sound back on would ring for every order already on the screen.
        markOrdersSeen(live.map((o: any) => o.id));
      }

      // Merge rather than replace: an unchanged row keeps its object identity, so
      // FlatList does not re-render it and the scroll position is undisturbed.
      setOrders(prev => {
        const byId = new Map(prev.map(o => [o.id, o]));
        return live.map((incoming: any) => {
          const existing = byId.get(incoming.id);
          if (existing && existing.updatedAt === incoming.updatedAt) return existing;
          return incoming;
        });
      });

      setLoading(false);
      setRefreshing(false);
    },
    [restaurantId, soundEnabled]
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  useEffect(() => {
    if (refreshSignal > 0) load('quiet');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const acknowledge = () => {
    stopOrderAlert();
  };

  const openAccept = (order: any) => {
    acknowledge();
    setActionError(null);
    setPrepMinutes(DEFAULT_PREP_MINUTES);
    setAcceptTarget(order);
  };

  const confirmAccept = async () => {
    if (!acceptTarget) return;
    if (prepMinutes < MIN_PREP_MINUTES) {
      setActionError(`Preparation time cannot be less than ${MIN_PREP_MINUTES} minutes.`);
      return;
    }

    setActionBusy(true);
    const res = await updateOrderStatus(acceptTarget.id, 'ACCEPTED', prepMinutes);
    setActionBusy(false);

    if (!res.ok) {
      setActionError(res.message || 'Could not accept the order.');
      return;
    }
    setAcceptTarget(null);
    load('quiet');
  };

  const advance = async (order: any, status: string) => {
    acknowledge();
    setActionError(null);
    const res = await updateOrderStatus(order.id, status);
    if (!res.ok) {
      setError(res.message || 'Could not update the order.');
      return;
    }
    load('quiet');
  };

  const openReject = async (order: any) => {
    acknowledge();
    setActionError(null);
    setRejectTarget(order);
    if (rejectReasons.length) return;
    const res = await fetchCancellationReasons();
    if (res.ok && Array.isArray(res.data?.reasons)) {
      setRejectReasons(res.data.reasons);
      setRejectCode(res.data.reasons[0]?.code ?? '');
    } else {
      setActionError(res.message || 'Could not load the reasons. Check your connection.');
    }
  };

  const confirmReject = async () => {
    if (!rejectTarget || !rejectCode) return;
    setActionBusy(true);
    const res = await updateOrderStatus(rejectTarget.id, 'CANCELLED', undefined, { reasonCode: rejectCode });
    setActionBusy(false);
    if (!res.ok) {
      setActionError(res.message || 'Could not reject the order.');
      return;
    }
    setRejectTarget(null);
    load('quiet');
  };

  const adjustPrep = (delta: number) => {
    setActionError(null);
    setPrepMinutes(prev => Math.min(MAX_PREP_MINUTES, Math.max(MIN_PREP_MINUTES, prev + delta)));
  };

  const header = useMemo(
    () => (
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Live orders</Text>
          <Text style={styles.subheading}>
            {orders.length === 0 ? 'Nothing cooking' : `${orders.length} in the kitchen`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.soundBtn}
          onPress={() => {
            if (soundEnabled) stopOrderAlert();
            onToggleSound(!soundEnabled);
          }}
          accessibilityLabel={soundEnabled ? 'Mute new order alerts' : 'Unmute new order alerts'}
        >
          {soundEnabled ? <BellRing size={18} color={c.brand} /> : <VolumeX size={18} color={c.textMuted} />}
        </TouchableOpacity>
      </View>
    ),
    [orders.length, soundEnabled, onToggleSound]
  );

  const renderOrder = ({ item }: { item: any }) => {
    const status = item.status as string;
    return (
      <Card>
        <View style={styles.orderTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderNumber}>Order {item.orderNumber}</Text>
            <Text style={styles.customer}>{item.customerName || 'Customer'}</Text>
          </View>
          <Pill
            label={status.replace(/_/g, ' ')}
            tone={
              status === 'ORDER_PLACED'
                ? 'warning'
                : status === 'READY_FOR_PICKUP'
                  ? 'success'
                  : 'brand'
            }
          />
        </View>

        <View style={styles.itemsBlock}>
          {(item.items || []).map((line: any, idx: number) => (
            <View key={`${item.id}-${line.dishId}-${idx}`} style={styles.itemRow}>
              <Text style={styles.itemQty}>{line.quantity}x</Text>
              <Text style={styles.itemName}>{line.name}</Text>
            </View>
          ))}
        </View>

        <View style={styles.orderFooter}>
          <Text style={styles.billTotal}>Rs {(Number(item.bill?.totalAmount) || 0).toFixed(2)}</Text>
          {!!item.pickupCode && <Text style={styles.pickupCode}>Pickup {item.pickupCode}</Text>}
        </View>

        {typeof item.preparationMinutes === 'number' && (
          <Text style={styles.prepNote}>
            <Clock size={12} color={c.textMuted} /> Promised in {item.preparationMinutes} min
          </Text>
        )}

        <View style={styles.actions}>
          {status === 'ORDER_PLACED' && (
            <>
              <Button
                label="Reject"
                variant="ghost"
                onPress={() => openReject(item)}
                style={{ flex: 1 }}
              />
              <Button label="Accept" onPress={() => openAccept(item)} style={{ flex: 1 }} />
            </>
          )}
          {status === 'ACCEPTED' && (
            <Button label="Start preparing" onPress={() => advance(item, 'PREPARING')} style={{ flex: 1 }} />
          )}
          {status === 'PREPARING' && (
            <Button label="Ready for pickup" onPress={() => advance(item, 'READY_FOR_PICKUP')} style={{ flex: 1 }} />
          )}
          {(status === 'READY_FOR_PICKUP' || status === 'RIDER_ASSIGNED' || status === 'OUT_FOR_DELIVERY') && (
            <View style={styles.waitingNote}>
              <CheckCircle2 size={15} color={c.success} />
              <Text style={styles.waitingText}>
                {status === 'OUT_FOR_DELIVERY' ? 'On the way to the customer' : 'Waiting for the rider'}
              </Text>
            </View>
          )}
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={orders}
        keyExtractor={o => o.id}
        renderItem={renderOrder}
        ListHeaderComponent={
          <>
            {header}
            {!!error && <ErrorNote message={error} onRetry={() => load('initial')} />}
          </>
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title="No live orders"
              body="New orders appear here the moment a customer places one, with a sound so you do not have to watch the screen."
            />
          )
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={c.brand} />
        }
      />

      <Modal visible={!!rejectTarget} transparent animationType="slide" onRequestClose={() => setRejectTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Why are you rejecting this order?</Text>
            <Text style={styles.modalBody}>
              The customer is told, and a paid order is refunded straight away. Pick the closest reason.
            </Text>

            {rejectReasons.map(reason => (
              <TouchableOpacity
                key={reason.code}
                style={[styles.reasonRow, rejectCode === reason.code && styles.reasonRowOn]}
                onPress={() => setRejectCode(reason.code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: rejectCode === reason.code }}
              >
                <View style={[styles.reasonDot, rejectCode === reason.code && styles.reasonDotOn]} />
                <Text style={styles.reasonText}>{reason.label}</Text>
              </TouchableOpacity>
            ))}

            {!!actionError && <ErrorNote message={actionError} />}

            <Button
              label="Reject this order"
              onPress={confirmReject}
              busy={actionBusy}
              disabled={!rejectCode}
            />
            <Button
              label="Keep it"
              variant="ghost"
              onPress={() => setRejectTarget(null)}
              style={{ marginTop: spacing.md }}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={!!acceptTarget} transparent animationType="slide" onRequestClose={() => setAcceptTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>How long will it take?</Text>
            <Text style={styles.modalBody}>
              The customer sees this as a promise, so give yourself a realistic figure. The minimum is{' '}
              {MIN_PREP_MINUTES} minutes.
            </Text>

            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepBtn, prepMinutes <= MIN_PREP_MINUTES && styles.stepBtnDisabled]}
                onPress={() => adjustPrep(-5)}
                disabled={prepMinutes <= MIN_PREP_MINUTES}
              >
                <Minus size={20} color={prepMinutes <= MIN_PREP_MINUTES ? c.textMuted : c.text} />
              </TouchableOpacity>
              <View style={styles.stepValue}>
                <Text style={styles.stepNumber}>{prepMinutes}</Text>
                <Text style={styles.stepUnit}>minutes</Text>
              </View>
              <TouchableOpacity
                style={[styles.stepBtn, prepMinutes >= MAX_PREP_MINUTES && styles.stepBtnDisabled]}
                onPress={() => adjustPrep(5)}
                disabled={prepMinutes >= MAX_PREP_MINUTES}
              >
                <Plus size={20} color={prepMinutes >= MAX_PREP_MINUTES ? c.textMuted : c.text} />
              </TouchableOpacity>
            </View>

            {!!actionError && <ErrorNote message={actionError} />}

            <Button label="Confirm and accept" onPress={confirmAccept} busy={actionBusy} />
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => setAcceptTarget(null)}
              style={{ marginTop: spacing.md }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  listContent: { padding: spacing.xl, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  heading: { fontSize: 22, fontWeight: '800', color: c.text },
  subheading: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  soundBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    justifyContent: 'center',
    alignItems: 'center'
  },
  orderTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  orderNumber: { fontSize: 16, fontWeight: '800', color: c.text },
  customer: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  itemsBlock: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: c.border,
    paddingVertical: spacing.md,
    marginBottom: spacing.md
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  itemQty: { fontSize: 14, fontWeight: '800', color: c.brand, width: 34 },
  itemName: { fontSize: 14, color: c.text, flex: 1 },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  billTotal: { fontSize: 16, fontWeight: '800', color: c.text },
  pickupCode: { fontSize: 13, color: c.info, fontWeight: '700' },
  prepNote: { fontSize: 12, color: c.textMuted, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  waitingNote: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: spacing.md },
  waitingText: { fontSize: 13, color: c.textSoft },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.xxl,
    paddingBottom: 40
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: c.text },
  modalBody: { fontSize: 13, color: c.textMuted, marginTop: 6, lineHeight: 19 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.xxl
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border
  },
  reasonRowOn: { opacity: 1 },
  reasonDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.border },
  reasonDotOn: { borderColor: c.brand, backgroundColor: c.brand },
  reasonText: { flex: 1, color: c.text },

  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.border,
    justifyContent: 'center',
    alignItems: 'center'
  },
  stepBtnDisabled: { opacity: 0.4 },
  stepValue: { alignItems: 'center' },
  stepNumber: { fontSize: 40, fontWeight: '800', color: c.brand },
  stepUnit: { fontSize: 13, color: c.textMuted }
});
