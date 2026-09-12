import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Bike, Phone, ArrowLeft, Check } from 'lucide-react-native';
import { Card } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';

const c = tokens.colors;

interface Props {
  orderNumber: string;
  total: number;
  otp: string;
  onHome: () => void;
  orderId?: string;
  apiUrl?: string;
  token?: string;
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
  token
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [order, setOrder] = useState<any | null>(null);

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
      } catch {
        // Keep showing the last known state; the next poll may succeed.
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, apiUrl, token]);

  const restaurantName = order?.restaurantName || 'the restaurant';
  const riderName = order?.riderName;

  const steps = [
    { title: 'Order Confirmed', desc: `Received by ${restaurantName}` },
    { title: 'Kitchen Accepted', desc: 'Chef started food preparation' },
    { title: 'Cooking in Progress', desc: 'Your food is being prepared fresh' },
    {
      title: 'Out for Delivery',
      desc: riderName ? `${riderName} is on the way` : 'Rider assigned and on the way'
    },
    { title: 'Delivered', desc: 'Verify with 4-digit OTP upon arrival' }
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
        <View style={styles.liveTag}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE TRACKING</Text>
        </View>
      </View>

      {/* Status hero */}
      <Card style={styles.heroCard}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderNo}>ORDER #{orderNumber}</Text>
            <Text style={styles.statusTitle}>{steps[currentStep]?.title ?? 'Order Confirmed'}</Text>
            <Text style={styles.statusSub}>{steps[currentStep]?.desc ?? ''}</Text>
          </View>
          <View style={styles.etaBox}>
            <Text style={styles.etaLabel}>ARRIVING IN</Text>
            <Text style={styles.etaValue}>~25 min</Text>
          </View>
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

      {/* OTP */}
      {!!otp && (
        <View style={styles.otpCard}>
          <Text style={styles.otpLabel}>DELIVERY VERIFICATION OTP</Text>
          <Text style={styles.otpValue}>{otp.split('').join('  ')}</Text>
          <Text style={styles.otpHint}>Share only when your order is handed over</Text>
        </View>
      )}

      {/* Rider */}
      {riderName ? (
        <Card style={styles.block}>
          <View style={styles.riderRow}>
            <View style={styles.riderAvatar}>
              <Bike size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.riderName}>{riderName}</Text>
              <Text style={styles.riderMeta}>{order?.riderPhone || 'Verified delivery partner'}</Text>
            </View>
            <View style={styles.callBtn}>
              <Phone size={17} color={c.dietary.veg} />
            </View>
          </View>
        </Card>
      ) : (
        <Card style={styles.block}>
          <Text style={styles.pendingRider}>A delivery partner will be assigned once your food is packed.</Text>
        </Card>
      )}

      {/* Summary */}
      <Card style={styles.block}>
        <Text style={styles.blockTitle}>Order summary</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Restaurant</Text>
          <Text style={styles.summaryValue}>{restaurantName}</Text>
        </View>
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
      </Card>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
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