import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Card, DietMark } from '../components/ui';

const c = tokens.colors;
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import { ArrowLeft, Tag, MapPin, CreditCard, Sparkles, Plus, Minus } from 'lucide-react-native';
import { CartItem } from './RestaurantDetailScreen';

interface Props {
  cart: CartItem[];
  onUpdateQuantity: (cartItemId: string, delta: number) => void;
  onBack: () => void;
  onOrderPlaced: (orderData: { orderNumber: string; total: number; otp: string; orderId?: string }) => void;
  restaurantId?: string;
  apiUrl?: string;
  token?: string;
  packagingFee?: number;
  distanceKm?: number;
}

export const CartAndCheckoutScreen: React.FC<Props> = ({
  cart,
  onUpdateQuantity,
  onBack,
  onOrderPlaced,
  restaurantId,
  apiUrl,
  token,
  packagingFee,
  distanceKm
}) => {
  const [couponCode, setCouponCode] = useState('WELCOME50');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>('WELCOME50');
  const [isGoldMember] = useState(true); // Rahul Sharma is a Quick Bites Gold subscriber
  const [isProcessing, setIsProcessing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Map cart items for pricing engine
  const pricingItems = cart.map(item => ({
    unitPrice: item.price,
    quantity: item.quantity
  }));

  const pricingResult = calculateOrderPricing({
    items: pricingItems,
    isGold: isGoldMember,
    packagingFee: packagingFee ?? 25.0,
    distanceKm: distanceKm ?? 2.5,
    coupon: appliedCoupon === 'WELCOME50'
      ? {
          discountType: 'PERCENTAGE',
          discountValue: 50,
          maxDiscountCap: 100,
          minOrderValue: 200
        }
      : appliedCoupon === 'FREEDEL'
      ? {
          discountType: 'FREE_DELIVERY',
          discountValue: 0,
          minOrderValue: 0
        }
      : undefined
  });

  const handleApplyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    if (code === 'WELCOME50' || code === 'FREEDEL') {
      setAppliedCoupon(code);
      setCouponError(null);
    } else {
      setAppliedCoupon(null);
      setCouponError(`'${code || 'This code'}' is not a valid coupon.`);
    }
  };

  const handleCheckout = async () => {
    setIsProcessing(true);
    setCheckoutError(null);
    const effectiveBase = apiUrl || 'https://quick-bites-production-9f45.up.railway.app/api';

    try {
      const generatedUUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });

      const payload = {
        restaurantId: restaurantId || 'rst_bbh_01',
        deliveryAddressId: 'addr_indiranagar_01',
        items: cart.map(item => ({
          dishId: item.dishId,
          quantity: item.quantity,
          ...(item.selectedOptions ? { selectedOptions: item.selectedOptions } : {})
        })),
        // Cash on delivery is the only method this build can honestly complete:
        // there is no Razorpay SDK integrated, and the server (correctly) refuses
        // simulated payment signatures outside demo mode.
        paymentMethod: 'CASH_ON_DELIVERY',
        couponCode: appliedCoupon || undefined,
        idempotencyKey: generatedUUID,
        distanceKm: distanceKm ?? 2.5
      };

      const res = await fetch(`${effectiveBase}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      let order = data?.data?.order;

      if (!res.ok || !data.success || !order) {
        throw new Error(
          data?.error?.message || 'We could not place your order. Please try again.'
        );
      }

      // A Razorpay order is created as PAYMENT_PENDING; it only reaches the kitchen
      // once payment is confirmed. Demo mode accepts the simulated sandbox signature.
      if (order.status === 'PAYMENT_PENDING') {
        const payRes = await fetch(`${effectiveBase}/orders/${order.id}/confirm-payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            razorpayPaymentId: `pay_test_${Date.now()}`,
            razorpaySignature: 'simulated_valid_signature'
          })
        });
        const payData = await payRes.json();
        if (!payRes.ok || !payData.success) {
          throw new Error(payData?.error?.message || 'Payment could not be confirmed. You have not been charged.');
        }
        order = payData.data?.order ?? order;
      }

      onOrderPlaced({
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: order.bill?.totalAmount ?? pricingResult.totalAmount,
        otp: order.deliveryOtp || ''
      });
    } catch (err: any) {
      setCheckoutError(
        err?.message === 'Failed to fetch' || err?.name === 'TypeError'
          ? 'Could not reach the Quick Bites server. Check your connection and try again.'
          : err?.message || 'We could not place your order. Please try again.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  if (cart.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>Your Cart is Empty</Text>
        <Text style={styles.emptySubtitle}>Explore delicious dishes and add them to your cart.</Text>
        <TouchableOpacity style={styles.backToMenuBtn} onPress={onBack}>
          <Text style={styles.backToMenuText}>Browse Menu</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.8}>
          <ArrowLeft size={18} color={c.text.primary} />
          <Text style={styles.backText}>Back to menu</Text>
        </TouchableOpacity>

        <Text style={styles.pageTitle}>Your Order</Text>
        <Text style={styles.pageSub}>Review items, apply a coupon and confirm.</Text>

        {/* Items */}
        <Card style={styles.block}>
          <Text style={styles.blockTitle}>Items</Text>
          {cart.map(item => (
            <View key={item.id} style={styles.itemRow}>
              <DietMark isVeg={item.isVeg} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemUnit}>₹{item.price.toFixed(0)} each</Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => onUpdateQuantity(item.id, -1)} activeOpacity={0.7}>
                  <Minus size={13} color={c.primary[500]} />
                </TouchableOpacity>
                <Text style={styles.stepCount}>{item.quantity}</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => onUpdateQuantity(item.id, 1)} activeOpacity={0.7}>
                  <Plus size={13} color={c.primary[500]} />
                </TouchableOpacity>
              </View>
              <Text style={styles.itemTotal}>₹{(item.price * item.quantity).toFixed(0)}</Text>
            </View>
          ))}
        </Card>

        {/* Address */}
        <Card style={styles.block}>
          <View style={styles.blockHead}>
            <MapPin size={16} color={c.primary[500]} />
            <Text style={styles.blockTitle}>Delivering to</Text>
          </View>
          <Text style={styles.addressTitle}>Home • Indiranagar</Text>
          <Text style={styles.addressDesc}>Flat 402, Green Glen Towers, 100 Feet Road, Bengaluru</Text>
        </Card>

        {/* Coupon */}
        <Card style={styles.block}>
          <View style={styles.blockHead}>
            <Tag size={16} color={c.primary[500]} />
            <Text style={styles.blockTitle}>Coupons</Text>
          </View>
          <View style={styles.couponRow}>
            <TextInput
              style={styles.couponInput}
              value={couponCode}
              onChangeText={setCouponCode}
              placeholder="Enter code"
              placeholderTextColor={c.text.muted}
              autoCapitalize="characters"
            />
            <TouchableOpacity style={styles.applyBtn} onPress={handleApplyCoupon} activeOpacity={0.85}>
              <Text style={styles.applyBtnText}>APPLY</Text>
            </TouchableOpacity>
          </View>
          {appliedCoupon ? (
            <Text style={styles.couponSuccess}>'{appliedCoupon}' applied</Text>
          ) : couponError ? (
            <Text style={styles.couponError}>{couponError}</Text>
          ) : null}
        </Card>

        {isGoldMember && (
          <View style={styles.goldCard}>
            <Sparkles size={16} color={c.dietary.gold} />
            <Text style={styles.goldText}>
              Gold applied — {pricingResult.deliveryFee === 0 ? 'delivery fee waived' : 'free delivery above ₹199'}
            </Text>
          </View>
        )}

        {/* Bill */}
        <Card style={styles.block}>
          <Text style={styles.blockTitle}>Bill details</Text>

          <View style={styles.billRow}>
            <Text style={styles.billLabel}>Item total</Text>
            <Text style={styles.billValue}>₹{pricingResult.itemsTotal.toFixed(2)}</Text>
          </View>
          <View style={styles.billRow}>
            <Text style={styles.billLabel}>GST on food (5%)</Text>
            <Text style={styles.billValue}>₹{pricingResult.gstAmount.toFixed(2)}</Text>
          </View>
          <View style={styles.billRow}>
            <Text style={styles.billLabel}>Packaging</Text>
            <Text style={styles.billValue}>₹{pricingResult.packagingFee.toFixed(2)}</Text>
          </View>
          <View style={styles.billRow}>
            <Text style={styles.billLabel}>Delivery fee</Text>
            <Text style={[styles.billValue, pricingResult.deliveryFee === 0 && { color: c.dietary.veg }]}>
              {pricingResult.deliveryFee === 0 ? 'FREE' : `₹${pricingResult.deliveryFee.toFixed(2)}`}
            </Text>
          </View>
          <View style={styles.billRow}>
            <Text style={styles.billLabel}>Platform fee</Text>
            <Text style={styles.billValue}>₹{pricingResult.platformFee.toFixed(2)}</Text>
          </View>
          {pricingResult.couponDiscount > 0 && (
            <View style={styles.billRow}>
              <Text style={[styles.billLabel, { color: c.dietary.veg }]}>Coupon discount</Text>
              <Text style={[styles.billValue, { color: c.dietary.veg }]}>
                -₹{pricingResult.couponDiscount.toFixed(2)}
              </Text>
            </View>
          )}

          <View style={styles.billTotalRow}>
            <Text style={styles.billTotalLabel}>To pay</Text>
            <Text style={styles.billTotalValue}>₹{pricingResult.totalAmount.toFixed(2)}</Text>
          </View>
        </Card>

        {checkoutError && (
          <View style={styles.checkoutErrorBox}>
            <Text style={styles.checkoutErrorText}>{checkoutError}</Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky pay bar */}
      <View style={styles.payBar}>
        <View>
          <Text style={styles.payBarAmount}>₹{pricingResult.totalAmount.toFixed(2)}</Text>
          <Text style={styles.payBarSub}>Cash on delivery</Text>
        </View>
        <TouchableOpacity
          style={[styles.payButton, isProcessing && { opacity: 0.6 }]}
          onPress={handleCheckout}
          disabled={isProcessing}
          activeOpacity={0.88}
        >
          <CreditCard size={17} color={c.text.onAccent} />
          <Text style={styles.payButtonText}>{isProcessing ? 'Placing…' : 'Place Order'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  content: { padding: 16, paddingBottom: 130 },

  backButton: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 },
  backText: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold, color: c.text.primary },

  pageTitle: {
    fontSize: tokens.font.size.xl,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    letterSpacing: -0.4
  },
  pageSub: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 4, marginBottom: 18 },

  block: { marginBottom: 14 },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  blockTitle: {
    fontSize: tokens.font.size.base,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    marginBottom: 2
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  itemName: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.semibold, color: c.text.primary },
  itemUnit: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 2 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.primary[100],
    backgroundColor: c.primary[50],
    borderRadius: tokens.radii.sm,
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginRight: 12
  },
  stepBtn: { paddingHorizontal: 7, paddingVertical: 3 },
  stepCount: {
    minWidth: 18,
    textAlign: 'center',
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.extrabold,
    color: c.primary[500]
  },
  itemTotal: {
    minWidth: 54,
    textAlign: 'right',
    fontSize: tokens.font.size.base,
    fontWeight: tokens.font.weight.bold,
    color: c.text.primary
  },

  addressTitle: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  addressDesc: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 3, lineHeight: 19 },

  couponRow: { flexDirection: 'row', gap: 10 },
  couponInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: tokens.radii.sm,
    paddingHorizontal: 12,
    fontSize: tokens.font.size.sm,
    color: c.text.primary,
    backgroundColor: c.surface.subtle
  },
  applyBtn: {
    paddingHorizontal: 18,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radii.sm,
    backgroundColor: c.primary[600]
  },
  applyBtnText: { color: '#FFFFFF', fontWeight: tokens.font.weight.extrabold, fontSize: tokens.font.size.xs },
  couponSuccess: {
    fontSize: tokens.font.size.xs,
    color: c.dietary.veg,
    fontWeight: tokens.font.weight.semibold,
    marginTop: 8
  },
  couponError: {
    fontSize: tokens.font.size.xs,
    color: c.dietary.nonveg,
    fontWeight: tokens.font.weight.semibold,
    marginTop: 8
  },

  goldCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: c.dietary.goldBg,
    borderWidth: 1,
    borderColor: '#F0DCA8',
    borderRadius: tokens.radii.md,
    padding: 13,
    marginBottom: 14
  },
  goldText: { flex: 1, fontSize: tokens.font.size.sm, color: c.dietary.gold, fontWeight: tokens.font.weight.semibold },

  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  billLabel: { fontSize: tokens.font.size.sm, color: c.text.secondary },
  billValue: { fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: tokens.font.weight.medium },
  billTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  billTotalLabel: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.extrabold, color: c.text.primary },
  billTotalValue: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.extrabold, color: c.primary[500] },

  checkoutErrorBox: {
    backgroundColor: c.dietary.nonvegBg,
    borderWidth: 1,
    borderColor: '#F5C9C9',
    borderRadius: tokens.radii.md,
    padding: 13
  },
  checkoutErrorText: { color: c.dietary.nonveg, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold },

  payBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.surface.card,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 22
  },
  payBarAmount: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.extrabold, color: c.text.primary },
  payBarSub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 2 },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: c.accent[500],
    paddingHorizontal: 26,
    height: 50,
    borderRadius: tokens.radii.md,
    justifyContent: 'center'
  },
  payButtonText: { color: c.text.onAccent, fontWeight: tokens.font.weight.extrabold, fontSize: tokens.font.size.base },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: c.surface.app
  },
  emptyTitle: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.extrabold, color: c.text.primary },
  emptySubtitle: {
    fontSize: tokens.font.size.sm,
    color: c.text.secondary,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20
  },
  backToMenuBtn: {
    marginTop: 20,
    backgroundColor: c.primary[600],
    paddingHorizontal: 26,
    height: 46,
    borderRadius: tokens.radii.md,
    justifyContent: 'center'
  },
  backToMenuText: { color: '#FFFFFF', fontWeight: tokens.font.weight.bold, fontSize: tokens.font.size.base }
});