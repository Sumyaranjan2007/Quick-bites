import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal
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

  // Saved delivery addresses — customers must be able to say where they live,
  // and the server rejects an address that isn't theirs.
  const [addresses, setAddresses] = useState<any[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showAddressSheet, setShowAddressSheet] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [form, setForm] = useState({ label: 'Home', addressLine: '', landmark: '', city: 'Bengaluru', pincode: '' });

  const loadAddresses = async () => {
    if (!apiUrl || !token) return;
    try {
      const res = await fetch(`${apiUrl}/addresses`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.addresses)) {
        setAddresses(data.data.addresses);
        const preferred = data.data.addresses.find((a: any) => a.isDefault) ?? data.data.addresses[0];
        setSelectedAddressId(prev => prev ?? preferred?.id ?? null);
      }
    } catch {
      // Leave the picker empty; checkout will prompt for an address.
    }
  };

  useEffect(() => {
    loadAddresses();
  }, [apiUrl, token]);

  const handleSaveAddress = async () => {
    if (!apiUrl || !token) return;
    setIsSavingAddress(true);
    setAddressError(null);
    try {
      const res = await fetch(`${apiUrl}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.details?.[0]?.message || data?.error?.message || 'Address could not be saved.');
      }
      setSelectedAddressId(data.data.address.id);
      setShowAddressSheet(false);
      setForm({ label: 'Home', addressLine: '', landmark: '', city: 'Bengaluru', pincode: '' });
      await loadAddresses();
    } catch (err: any) {
      setAddressError(err?.message || 'Address could not be saved.');
    } finally {
      setIsSavingAddress(false);
    }
  };

  const selectedAddress = addresses.find(a => a.id === selectedAddressId) ?? null;

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
    if (!selectedAddressId) {
      setCheckoutError('Add a delivery address before placing your order.');
      return;
    }
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
        deliveryAddressId: selectedAddressId,
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
          {selectedAddress ? (
            <>
              <Text style={styles.addressTitle}>
                {selectedAddress.label} • {selectedAddress.city}
              </Text>
              <Text style={styles.addressDesc}>
                {[selectedAddress.addressLine, selectedAddress.landmark, selectedAddress.pincode]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
            </>
          ) : (
            <Text style={styles.addressDesc}>No delivery address saved yet.</Text>
          )}

          {addresses.length > 1 && (
            <View style={styles.addressPicker}>
              {addresses.map(a => (
                <TouchableOpacity
                  key={a.id}
                  style={[styles.addressChip, selectedAddressId === a.id && styles.addressChipActive]}
                  onPress={() => setSelectedAddressId(a.id)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[styles.addressChipText, selectedAddressId === a.id && styles.addressChipTextActive]}
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity onPress={() => setShowAddressSheet(true)} activeOpacity={0.7}>
            <Text style={styles.addressAction}>
              {addresses.length ? '+ Add another address' : '+ Add a delivery address'}
            </Text>
          </TouchableOpacity>
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

      {/* Add address sheet */}
      <Modal visible={showAddressSheet} transparent animationType="slide" onRequestClose={() => setShowAddressSheet(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Add a delivery address</Text>

            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Label</Text>
              <View style={styles.labelRow}>
                {['Home', 'Work', 'Other'].map(l => (
                  <TouchableOpacity
                    key={l}
                    style={[styles.addressChip, form.label === l && styles.addressChipActive]}
                    onPress={() => setForm({ ...form, label: l })}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.addressChipText, form.label === l && styles.addressChipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Flat / House, street</Text>
              <TextInput
                style={styles.sheetInput}
                value={form.addressLine}
                onChangeText={v => setForm({ ...form, addressLine: v })}
                placeholder="Flat 402, Green Glen Towers, 100 Feet Road"
                placeholderTextColor={c.text.muted}
              />

              <Text style={styles.fieldLabel}>Landmark (optional)</Text>
              <TextInput
                style={styles.sheetInput}
                value={form.landmark}
                onChangeText={v => setForm({ ...form, landmark: v })}
                placeholder="Opposite Indiranagar Metro"
                placeholderTextColor={c.text.muted}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>City</Text>
                  <TextInput
                    style={styles.sheetInput}
                    value={form.city}
                    onChangeText={v => setForm({ ...form, city: v })}
                    placeholderTextColor={c.text.muted}
                  />
                </View>
                <View style={{ width: 130 }}>
                  <Text style={styles.fieldLabel}>PIN code</Text>
                  <TextInput
                    style={styles.sheetInput}
                    value={form.pincode}
                    onChangeText={v => setForm({ ...form, pincode: v.replace(/[^0-9]/g, '').slice(0, 6) })}
                    placeholder="560038"
                    placeholderTextColor={c.text.muted}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              {addressError ? <Text style={styles.couponError}>{addressError}</Text> : null}
            </ScrollView>

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.sheetCancel}
                onPress={() => {
                  setShowAddressSheet(false);
                  setAddressError(null);
                }}
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetSave, isSavingAddress && { opacity: 0.6 }]}
                onPress={handleSaveAddress}
                disabled={isSavingAddress}
              >
                <Text style={styles.sheetSaveText}>{isSavingAddress ? 'Saving…' : 'Save address'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  addressPicker: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  addressChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: tokens.radii.full,
    borderWidth: 1,
    borderColor: c.border.medium,
    backgroundColor: c.surface.subtle
  },
  addressChipActive: { backgroundColor: c.primary[600], borderColor: c.primary[600] },
  addressChipText: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold, color: c.text.secondary },
  addressChipTextActive: { color: '#FFFFFF' },
  addressAction: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.bold,
    color: c.primary[500],
    marginTop: 14
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,7,16,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.card,
    borderTopLeftRadius: tokens.radii['2xl'],
    borderTopRightRadius: tokens.radii['2xl'],
    padding: 20,
    paddingBottom: 28
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border.strong,
    alignSelf: 'center',
    marginBottom: 16
  },
  sheetTitle: {
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    marginBottom: 8
  },
  fieldLabel: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.bold,
    color: c.text.secondary,
    marginTop: 12,
    marginBottom: 6
  },
  labelRow: { flexDirection: 'row', gap: 8 },
  sheetInput: {
    height: 46,
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 13,
    fontSize: tokens.font.size.base,
    color: c.text.primary,
    backgroundColor: c.surface.subtle
  },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  sheetCancel: {
    flex: 1,
    height: 48,
    borderRadius: tokens.radii.md,
    backgroundColor: c.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sheetCancelText: { color: c.text.primary, fontWeight: tokens.font.weight.bold, fontSize: tokens.font.size.sm },
  sheetSave: {
    flex: 1.4,
    height: 48,
    borderRadius: tokens.radii.md,
    backgroundColor: c.primary[600],
    alignItems: 'center',
    justifyContent: 'center'
  },
  sheetSaveText: { color: '#FFFFFF', fontWeight: tokens.font.weight.extrabold, fontSize: tokens.font.size.sm },

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