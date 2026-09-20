import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { ArrowLeft, Crown, Check, BadgeCheck } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { Card, EmptyState } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';
import { SafeScreen } from '../components/SafeScreen';
import {
  razorpayAvailable,
  openRazorpay,
  isCancellation,
  paymentErrorMessage
} from '../lib/nativePayments';

const c = tokens.colors;

interface Props {
  onBack: () => void;
  apiUrl?: string;
  token?: string;
  /** So the profile screen can re-read the gold badge once this changes it. */
  onChanged?: () => void;
}

interface Plan {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  extraDiscountPercent: number;
  benefits: string[];
}

interface Status {
  active: boolean;
  planName?: string;
  expiresAt?: string;
  daysRemaining?: number;
  extraDiscountPercent: number;
}

/**
 * Quick Bites Gold: what it costs, what it gives, and when it runs out.
 *
 * This screen is what the wallet top-up was replaced BY. Loading money onto a
 * stored balance would make this platform the issuer of a prepaid payment
 * instrument, which in India needs an RBI licence; selling a membership does
 * not, and it is the thing customers actually wanted the balance for.
 *
 * The expiry is shown, prominently, for a member who has one. A subscription
 * that never tells you when it renews is how people end up feeling tricked by
 * one, and "when does this run out" is the single question a member has.
 */
export const MembershipScreen: React.FC<Props> = ({ onBack, apiUrl, token, onChanged }) => {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [online, setOnline] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiUrl) return;
    setError(null);
    try {
      const [plansRes, meRes] = await Promise.all([
        apiFetch(`${apiUrl}/membership/plans`),
        token
          ? apiFetch(`${apiUrl}/membership/me`, { headers: { Authorization: `Bearer ${token}` } })
          : Promise.resolve(null as any)
      ]);
      const plansData = await plansRes.json();
      if (plansData?.success) {
        setPlans(plansData.data.plans || []);
        setOnline(Boolean(plansData.data.online));
      }
      if (meRes) {
        const meData = await meRes.json();
        if (meData?.success) setStatus(meData.data);
      }
    } catch {
      setError('Could not load memberships. Check your connection and try again.');
      setPlans([]);
    }
  }, [apiUrl, token]);

  useEffect(() => {
    load();
  }, [load]);

  const buy = useCallback(
    async (plan: Plan) => {
      if (!apiUrl || !token) return;
      setError(null);
      setNotice(null);
      setBusyPlanId(plan.id);
      try {
        // 1. Something to pay for. The price comes from the server's copy of the
        //    plan, never from this screen — a client that can name its own price
        //    for a year of free delivery certainly will.
        const startRes = await apiFetch(`${apiUrl}/membership/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ planId: plan.id })
        });
        const startData = await startRes.json();
        const rzpOrder = startData?.data?.razorpayOrder;
        if (!startRes.ok || !startData.success || !rzpOrder?.id) {
          throw new Error(startData?.error?.message || 'We could not start that purchase.');
        }

        // 2. Razorpay's own sheet.
        let result;
        try {
          result = await openRazorpay({
            key: startData.data.keyId,
            order_id: rzpOrder.id,
            amount: rzpOrder.amount,
            currency: rzpOrder.currency || 'INR',
            name: 'Quick Bites Gold',
            description: plan.name,
            theme: { color: c.primary[500] }
          });
        } catch (payErr) {
          throw new Error(
            isCancellation(payErr)
              ? 'Payment cancelled. Nothing has been charged.'
              : paymentErrorMessage(payErr)
          );
        }

        // 3. The server re-computes the signature. Nothing is granted until it
        //    agrees — a benefit granted on a client's say-so is a benefit
        //    anyone can grant themselves.
        const confirmRes = await apiFetch(`${apiUrl}/membership/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            planId: plan.id,
            razorpayOrderId: rzpOrder.id,
            razorpayPaymentId: result.razorpay_payment_id,
            razorpaySignature: result.razorpay_signature
          })
        });
        const confirmData = await confirmRes.json();
        if (!confirmRes.ok || !confirmData.success) {
          throw new Error(
            confirmData?.error?.message ||
              'Your payment went through but we could not activate the membership. Do not pay again — support can see this payment.'
          );
        }

        setStatus(confirmData.data);
        setNotice(`${plan.name} is active. Your benefits apply from your next order.`);
        onChanged?.();
      } catch (err: any) {
        setError(err?.message || 'That did not work. Please try again.');
      } finally {
        setBusyPlanId(null);
      }
    },
    [apiUrl, token, onChanged]
  );

  const canBuy = online && razorpayAvailable;

  return (
    <SafeScreen>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={c.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Quick Bites Gold</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {status?.active && (
          <Card style={styles.activeCard}>
            <View style={styles.activeRow}>
              <BadgeCheck size={22} color={c.dietary.gold} />
              <Text style={styles.activeTitle}>{status.planName || 'Gold'} is active</Text>
            </View>
            {typeof status.daysRemaining === 'number' && (
              <Text style={styles.activeSub}>
                {status.daysRemaining === 0
                  ? 'Ends today.'
                  : `${status.daysRemaining} day${status.daysRemaining === 1 ? '' : 's'} left.`}
                {status.expiresAt
                  ? ` Renews nothing automatically — buy again to extend.`
                  : ''}
              </Text>
            )}
          </Card>
        )}

        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}

        {plans === null ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={c.primary[500]} />
        ) : plans.length === 0 ? (
          <EmptyState title="No memberships yet" subtitle="Check back soon." />
        ) : (
          plans.map(plan => (
            <Card key={plan.id} style={styles.planCard}>
              <View style={styles.planHead}>
                <Crown size={20} color={c.dietary.gold} />
                <Text style={styles.planName}>{plan.name}</Text>
              </View>
              <Text style={styles.planPrice}>
                ₹{plan.price}
                <Text style={styles.planPer}> for {plan.durationDays} days</Text>
              </Text>
              <View style={styles.benefits}>
                {plan.benefits.map(b => (
                  <View key={b} style={styles.benefitRow}>
                    <Check size={14} color={c.dietary.veg} />
                    <Text style={styles.benefitText}>{b}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.buyBtn, (!canBuy || busyPlanId === plan.id) && styles.buyBtnOff]}
                onPress={() => buy(plan)}
                disabled={!canBuy || busyPlanId !== null}
                activeOpacity={0.85}
              >
                {busyPlanId === plan.id ? (
                  <ActivityIndicator size="small" color={c.text.inverse} />
                ) : (
                  <Text style={styles.buyText}>
                    {status?.active ? 'Extend' : 'Get'} {plan.name}
                  </Text>
                )}
              </TouchableOpacity>
            </Card>
          ))
        )}

        {/* Said out loud rather than shown as a button that fails. Both reasons
            are real and they need different fixes, so they are named. */}
        {plans !== null && plans.length > 0 && !canBuy && (
          <Text style={styles.unavailable}>
            {razorpayAvailable
              ? 'Online payment is not switched on for this server yet, so memberships cannot be bought here.'
              : 'This build cannot open the payment sheet, so memberships cannot be bought here.'}
          </Text>
        )}
      </ScrollView>
    </SafeScreen>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: c.surface.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border.subtle
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: c.text.primary },

  content: { padding: 16, gap: 12, paddingBottom: 32 },

  activeCard: { backgroundColor: c.dietary.goldBg, borderColor: c.dietary.gold, borderWidth: 1 },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeTitle: { fontSize: 16, fontWeight: '800', color: c.text.primary },
  activeSub: { fontSize: 13, color: c.text.secondary, marginTop: 6, lineHeight: 19 },

  notice: { fontSize: 13, color: c.dietary.veg, fontWeight: '600' },
  error: { fontSize: 13, color: c.semantic.error, fontWeight: '600' },

  planCard: { gap: 8 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planName: { fontSize: 16, fontWeight: '700', color: c.text.primary },
  planPrice: { fontSize: 24, fontWeight: '800', color: c.text.primary },
  planPer: { fontSize: 13, fontWeight: '500', color: c.text.secondary },
  benefits: { gap: 6, marginTop: 4 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  benefitText: { fontSize: 13, color: c.text.secondary },
  buyBtn: {
    marginTop: 8,
    backgroundColor: c.primary[500],
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center'
  },
  buyBtnOff: { opacity: 0.5 },
  buyText: { color: c.text.inverse, fontSize: 15, fontWeight: '700' },

  unavailable: { fontSize: 12, color: c.text.muted, lineHeight: 18, textAlign: 'center' }
});
