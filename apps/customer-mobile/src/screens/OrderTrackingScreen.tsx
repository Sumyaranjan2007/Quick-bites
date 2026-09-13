import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Linking, Alert } from 'react-native';
import { Bike, Phone, ArrowLeft, Check, MessageCircle, Eye, EyeOff, Star } from 'lucide-react-native';
import { Card } from '../components/ui';
import { LiveRiderMap } from '../components/LiveRiderMap';
import { OrderChat } from '../components/OrderChat';
import { RatingSheet } from '../components/RatingSheet';
import { useOrderSocket } from '../lib/useOrderSocket';
import { apiFetch } from '../lib/apiFetch';

const c = tokens.colors;

/** "1:18 PM" — the local time the order actually arrived. */
function deliveredTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${suffix}`;
}

interface Props {
  orderNumber: string;
  total: number;
  otp: string;
  onHome: () => void;
  orderId?: string;
  apiUrl?: string;
  token?: string;
  currentUserId?: string;
}

// Backend order status -> index in the customer-facing progress tracker
const STATUS_STEP_INDEX: Record<string, number> = {
  PAYMENT_PENDING: 0,
  ORDER_PLACED: 0,
  ACCEPTED: 1,
  PREPARING: 2,
  READY_FOR_PICKUP: 2,
  RIDER_ASSIGNED: 3,
  OUT_FOR_DELIVERY: 3,
  DELIVERED: 4
};

export const OrderTrackingScreen: React.FC<Props> = ({
  orderNumber,
  total,
  otp,
  onHome,
  orderId,
  apiUrl,
  token,
  currentUserId
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [order, setOrder] = useState<any | null>(null);
  const [tracking, setTracking] = useState<any | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [submittedRating, setSubmittedRating] = useState<number | null>(null);
  // Bills are read in public - at a doorstep, on a bus. Hidden by default is
  // wrong (most people want to see it), so it is shown with a one-tap cover.
  const [billHidden, setBillHidden] = useState(false);

  // Derived from the order the server reports, never from the local step index:
  // the step is a display detail, delivery is a fact about the order.
  const status: string = order?.status ?? '';
  const isDelivered = status === 'DELIVERED';
  const isClosed = isDelivered || status === 'CANCELLED' || status === 'REFUNDED';
  const riderAssigned = Boolean(order?.riderName) && !isClosed;

  // Push updates arrive instantly; the poll below is only a fallback for
  // networks where websockets are blocked.
  const { connected: liveConnected } = useOrderSocket(orderId, apiUrl, token, {
    onStatus: u => setCurrentStep(STATUS_STEP_INDEX[u.status] ?? 0),
    onRiderLocation: l =>
      setTracking((prev: any) => ({
        ...(prev ?? {}),
        riderCoordinates: { latitude: l.lat, longitude: l.lng },
        riderBearing: l.bearing ?? 0,
        riderLocationUpdatedAt: l.updatedAt
      }))
  });

  // Poll the real order so the tracker reflects what the kitchen and rider actually did
  useEffect(() => {
    if (!orderId || !apiUrl) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await apiFetch(`${apiUrl}/orders/${orderId}`, { headers });
        const data = await res.json();
        if (!cancelled && data.success && data.data?.order) {
          setOrder(data.data.order);
          setCurrentStep(STATUS_STEP_INDEX[data.data.order.status] ?? 0);
        }

        // Rider position lives on a separate endpoint so the customer never
        // needs the full order record, which carries the delivery OTP.
        const trackRes = await apiFetch(`${apiUrl}/orders/${orderId}/tracking`, { headers });
        const trackData = await trackRes.json();
        if (!cancelled && trackData.success) {
          setTracking(trackData.data);
        }
      } catch {
        // Keep showing the last known state; the next poll may succeed.
      }
    };

    poll();
    // 5s while polling is the only channel; 20s once push is connected.
    const interval = setInterval(poll, liveConnected ? 20000 : 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, apiUrl, token, liveConnected]);

  const restaurantName = order?.restaurantName || 'the restaurant';
  const riderName = order?.riderName;
  const riderPhone: string | undefined = order?.riderPhone || tracking?.riderPhone;
  const existingRating: number | null = order?.rating ?? null;
  const shownRating = submittedRating ?? existingRating;

  // A rough countdown that at least moves with the order rather than sitting at
  // a constant "~25 min" from placement to doorstep.
  const etaMinutes = (() => {
    const prep = Number(order?.preparationMinutes) || 20;
    switch (status) {
      case 'OUT_FOR_DELIVERY':
        return 10;
      case 'RIDER_ASSIGNED':
      case 'READY_FOR_PICKUP':
        return 15;
      case 'PREPARING':
        return prep;
      default:
        return prep + 10;
    }
  })();

  const callRider = async () => {
    if (!riderPhone) return;
    const url = `tel:${riderPhone.replace(/[^+0-9]/g, '')}`;
    const supported = await Linking.canOpenURL(url).catch(() => false);
    if (!supported) {
      Alert.alert('Calling not available', `Dial ${riderPhone} from your phone app.`);
      return;
    }
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not start the call', `Dial ${riderPhone} from your phone app.`)
    );
  };

  const steps = [
    { title: 'Order Confirmed', desc: `Received by ${restaurantName}` },
    { title: 'Kitchen Accepted', desc: 'Chef started food preparation' },
    { title: 'Cooking in Progress', desc: 'Your food is being prepared fresh' },
    {
      title: 'Out for Delivery',
      desc: riderName ? `${riderName} is on the way` : 'Rider assigned and on the way'
    },
    {
      title: 'Delivered',
      desc: isDelivered ? 'Handed over and confirmed' : 'Verify with 4-digit OTP upon arrival'
    }
  ];

  const done = (i: number) => i < currentStep;
  const active = (i: number) => i === currentStep;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backButton} onPress={onHome} activeOpacity={0.8}>
          <ArrowLeft size={17} color={c.text.primary} />
          <Text style={styles.backText}>Home</Text>
        </TouchableOpacity>
        {isClosed ? (
          <View style={[styles.liveTag, styles.doneTag]}>
            <Check size={12} color={c.dietary.veg} />
            <Text style={[styles.liveText, { color: c.dietary.veg }]}>DELIVERY COMPLETED</Text>
          </View>
        ) : (
          <View style={styles.liveTag}>
            <View style={[styles.liveDot, !liveConnected && { backgroundColor: c.text.muted }]} />
            <Text style={[styles.liveText, !liveConnected && { color: c.text.muted }]}>
              {liveConnected ? 'LIVE TRACKING' : 'RECONNECTING'}
            </Text>
          </View>
        )}
      </View>

      {/* Status hero */}
      <Card style={styles.heroCard}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderNo}>ORDER #{orderNumber}</Text>
            <Text style={styles.statusTitle}>{steps[currentStep]?.title ?? 'Order Confirmed'}</Text>
            <Text style={styles.statusSub}>{steps[currentStep]?.desc ?? ''}</Text>
          </View>
          {isDelivered ? (
            <View style={[styles.etaBox, styles.deliveredBox]}>
              <Text style={[styles.etaLabel, { color: c.dietary.veg }]}>DELIVERED</Text>
              <Text style={[styles.etaValue, { color: c.dietary.veg, fontSize: 15 }]}>
                {order?.deliveredAt ? deliveredTime(order.deliveredAt) : 'Complete'}
              </Text>
            </View>
          ) : (
            <View style={styles.etaBox}>
              <Text style={styles.etaLabel}>ARRIVING IN</Text>
              <Text style={styles.etaValue}>~{etaMinutes} min</Text>
            </View>
          )}
        </View>

        {/* Stepper */}
        <View style={styles.stepper}>
          {steps.map((s, i) => (
            <View key={s.title} style={styles.stepItem}>
              <View style={styles.stepTrack}>
                {i > 0 && <View style={[styles.stepLine, done(i) || active(i) ? styles.stepLineOn : null]} />}
                <View
                  style={[
                    styles.stepDot,
                    done(i) && styles.stepDotDone,
                    active(i) && styles.stepDotActive
                  ]}
                >
                  {done(i) ? <Check size={11} color="#FFFFFF" /> : null}
                </View>
                {i < steps.length - 1 && <View style={[styles.stepLine, done(i + 1) ? styles.stepLineOn : null]} />}
              </View>
              <Text style={[styles.stepLabel, (done(i) || active(i)) && styles.stepLabelOn]} numberOfLines={2}>
                {s.title}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Doorstep OTP - removed the moment the handover is verified, because a
          spent code is both useless and confusing to keep showing. */}
      {!!otp && !isClosed && (
        <View style={styles.otpCard}>
          <Text style={styles.otpLabel}>DELIVERY VERIFICATION OTP</Text>
          <Text style={styles.otpValue}>{otp.split('').join('  ')}</Text>
          <Text style={styles.otpHint}>Share only when your order is handed over</Text>
        </View>
      )}

      {/* Completion, and the rating it unlocks */}
      {isDelivered && (
        <Card style={styles.block}>
          <View style={styles.doneRow}>
            <View style={styles.doneIcon}>
              <Check size={19} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.doneTitle}>Delivery completed</Text>
              <Text style={styles.doneSub}>
                {riderName ? `Handed over by ${riderName}.` : 'Your order was handed over.'} Enjoy your meal.
              </Text>
            </View>
          </View>

          {shownRating ? (
            <View style={styles.ratedRow}>
              {[1, 2, 3, 4, 5].map(v => (
                <Star
                  key={v}
                  size={18}
                  color={v <= shownRating ? c.accent[500] : c.border.strong}
                  fill={v <= shownRating ? c.accent[500] : 'transparent'}
                />
              ))}
              <Text style={styles.ratedText}>Thanks for rating this order</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.rateBtn} onPress={() => setRatingOpen(true)} activeOpacity={0.88}>
              <Star size={17} color="#FFFFFF" />
              <Text style={styles.rateBtnText}>Rate this order</Text>
            </TouchableOpacity>
          )}
        </Card>
      )}

      {/* Live rider position - only while a delivery is actually in progress */}
      {riderAssigned && (
        <Card style={styles.block}>
          <Text style={styles.blockTitle}>Live location</Text>
          <LiveRiderMap
            rider={tracking?.riderCoordinates ?? null}
            /* Falls back to the order's own delivery coordinates. A rider ping
               can arrive over the socket before the first tracking fetch
               returns, and the merge then produces a rider with no destination -
               leaving the map stuck on "waiting for the delivery address"
               even though the order has carried that address all along. */
            destination={tracking?.destinationCoordinates ?? order?.deliveryCoordinates ?? null}
            updatedAt={tracking?.riderLocationUpdatedAt}
            riderName={tracking?.riderName ?? riderName}
          />
        </Card>
      )}

      {/* Delivery partner */}
      {riderName ? (
        <Card style={styles.block}>
          <View style={styles.riderRow}>
            <View style={styles.riderAvatar}>
              <Bike size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.riderName}>{riderName}</Text>
              <Text style={styles.riderMeta}>
                {isClosed ? 'Delivered this order' : riderPhone || 'Verified delivery partner'}
              </Text>
            </View>
          </View>

          {!isClosed && (
            <View style={styles.contactRow}>
              <TouchableOpacity
                style={[styles.contactBtn, !riderPhone && { opacity: 0.45 }]}
                onPress={callRider}
                disabled={!riderPhone}
                activeOpacity={0.85}
              >
                <Phone size={16} color={c.dietary.veg} />
                <Text style={[styles.contactText, { color: c.dietary.veg }]}>Call</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.contactBtn}
                onPress={() => setChatOpen(true)}
                activeOpacity={0.85}
              >
                <MessageCircle size={16} color={c.primary[500]} />
                <Text style={[styles.contactText, { color: c.primary[500] }]}>Chat</Text>
              </TouchableOpacity>
            </View>
          )}
        </Card>
      ) : (
        <Card style={styles.block}>
          <Text style={styles.pendingRider}>A delivery partner will be assigned once your food is packed.</Text>
        </Card>
      )}

      {/* Summary. The bill can be covered: it is read at doorsteps and on buses,
          where what you ordered and what you paid is nobody else's business. */}
      <Card style={styles.block}>
        <View style={styles.blockHeaderRow}>
          <Text style={[styles.blockTitle, { marginBottom: 0 }]}>Order summary</Text>
          <TouchableOpacity
            style={styles.billToggle}
            onPress={() => setBillHidden(h => !h)}
            activeOpacity={0.75}
            accessibilityLabel={billHidden ? 'Show bill' : 'Hide bill'}
          >
            {billHidden ? <Eye size={15} color={c.text.secondary} /> : <EyeOff size={15} color={c.text.secondary} />}
            <Text style={styles.billToggleText}>{billHidden ? 'Show bill' : 'Hide bill'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Restaurant</Text>
          <Text style={styles.summaryValue}>{restaurantName}</Text>
        </View>

        {billHidden ? (
          <View style={styles.billHiddenBox}>
            <Text style={styles.billHiddenText}>Bill hidden · tap “Show bill” to reveal</Text>
          </View>
        ) : (
          <>
            {order?.items?.map((it: any, i: number) => (
              <View key={i} style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  {it.quantity}× {it.name}
                </Text>
                <Text style={styles.summaryValue}>₹{(it.totalPrice ?? 0).toFixed(0)}</Text>
              </View>
            ))}
            <View style={styles.summaryTotal}>
              <Text style={styles.summaryTotalLabel}>Total paid</Text>
              <Text style={styles.summaryTotalValue}>₹{total.toFixed(2)}</Text>
            </View>
          </>
        )}
      </Card>

      <OrderChat
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        orderId={orderId}
        apiUrl={apiUrl}
        token={token}
        riderName={riderName}
        canSend={!isClosed}
        currentUserId={currentUserId}
      />

      <RatingSheet
        visible={ratingOpen}
        onClose={() => setRatingOpen(false)}
        onRated={value => setSubmittedRating(value)}
        orderId={orderId}
        apiUrl={apiUrl}
        token={token}
        restaurantName={restaurantName}
        riderName={riderName}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  doneTag: { backgroundColor: c.dietary.vegBg },
  deliveredBox: { backgroundColor: c.dietary.vegBg },
  doneRow: { flexDirection: 'row', alignItems: 'center' },
  doneIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.dietary.veg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  doneTitle: { fontSize: 15.5, fontWeight: '800', color: c.text.primary },
  doneSub: { fontSize: 12.5, color: c.text.secondary, marginTop: 2, lineHeight: 17 },
  rateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.primary[500],
    borderRadius: 13,
    paddingVertical: 13,
    marginTop: 14
  },
  rateBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '800' },
  ratedRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 14 },
  ratedText: { marginLeft: 8, fontSize: 12.5, color: c.text.secondary, fontWeight: '600' },
  contactRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border.medium,
    backgroundColor: c.surface.card
  },
  contactText: { fontSize: 14, fontWeight: '700' },
  billToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  billToggleText: { fontSize: 12.5, fontWeight: '700', color: c.text.secondary },
  billHiddenBox: {
    backgroundColor: c.surface.sunken,
    borderRadius: 12,
    paddingVertical: 22,
    alignItems: 'center',
    marginTop: 4
  },
  billHiddenText: { color: c.text.muted, fontSize: 13, fontWeight: '600' },
  blockHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10
  },
  content: { padding: 16, paddingBottom: 40 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: c.surface.card,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: tokens.radii.full
  },
  backText: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.dietary.veg },
  liveText: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.extrabold,
    color: c.dietary.veg,
    letterSpacing: 0.4
  },

  heroCard: { marginBottom: 14 },
  heroTop: { flexDirection: 'row', gap: 12 },
  orderNo: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.bold,
    color: c.text.muted,
    letterSpacing: 0.6
  },
  statusTitle: {
    fontSize: tokens.font.size.xl,
    fontWeight: tokens.font.weight.extrabold,
    color: c.primary[500],
    marginTop: 5,
    letterSpacing: -0.4
  },
  statusSub: { fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: 4 },
  etaBox: {
    backgroundColor: c.accent[50],
    borderRadius: tokens.radii.md,
    paddingHorizontal: 13,
    paddingVertical: 10,
    alignItems: 'center',
    alignSelf: 'flex-start'
  },
  etaLabel: { fontSize: 9, fontWeight: tokens.font.weight.extrabold, color: c.accent[600], letterSpacing: 0.4 },
  etaValue: {
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.extrabold,
    color: c.accent[600],
    marginTop: 2
  },

  stepper: { flexDirection: 'row', marginTop: 22 },
  stepItem: { flex: 1, alignItems: 'center' },
  stepTrack: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'center' },
  stepLine: { flex: 1, height: 2, backgroundColor: c.border.medium },
  stepLineOn: { backgroundColor: c.dietary.veg },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.surface.sunken,
    borderWidth: 2,
    borderColor: c.border.medium,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepDotDone: { backgroundColor: c.dietary.veg, borderColor: c.dietary.veg },
  stepDotActive: { backgroundColor: c.primary[500], borderColor: c.primary[500] },
  stepLabel: {
    fontSize: 9,
    color: c.text.muted,
    marginTop: 7,
    textAlign: 'center',
    fontWeight: tokens.font.weight.semibold
  },
  stepLabelOn: { color: c.text.primary },

  otpCard: {
    backgroundColor: c.primary[600],
    borderRadius: tokens.radii.xl,
    padding: 20,
    alignItems: 'center',
    marginBottom: 14
  },
  otpLabel: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.extrabold,
    color: c.accent[400],
    letterSpacing: 1.2
  },
  otpValue: {
    fontSize: tokens.font.size['2xl'],
    fontWeight: tokens.font.weight.extrabold,
    color: c.accent[500],
    marginTop: 8,
    letterSpacing: 2
  },
  otpHint: { fontSize: tokens.font.size.xs, color: '#D9C4BB', marginTop: 8 },

  block: { marginBottom: 14 },
  blockTitle: {
    fontSize: tokens.font.size.base,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    marginBottom: 6
  },

  riderRow: { flexDirection: 'row', alignItems: 'center' },
  riderAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.primary[500],
    alignItems: 'center',
    justifyContent: 'center'
  },
  riderName: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  riderMeta: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 2 },
  callBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.dietary.vegBg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pendingRider: { fontSize: tokens.font.size.sm, color: c.text.secondary, lineHeight: 20 },

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9, gap: 12 },
  summaryLabel: { flex: 1, fontSize: tokens.font.size.sm, color: c.text.secondary },
  summaryValue: { fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: tokens.font.weight.semibold },
  summaryTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  summaryTotalLabel: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.extrabold, color: c.text.primary },
  summaryTotalValue: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.extrabold, color: c.primary[500] }
});