import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from 'react-native';
import { tokens } from '@quick-bites/design-system';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import { ArrowLeft, Tag, MapPin, CreditCard, Sparkles, Plus, Minus } from 'lucide-react-native';
import { CartItem } from './RestaurantDetailScreen';

interface Props {
  cart: CartItem[];
  onUpdateQuantity: (cartItemId: string, delta: number) => void;
  onBack: () => void;
  onOrderPlaced: (orderData: { orderNumber: string; total: number; otp: string }) => void;
  restaurantId?: string;
  apiUrl?: string;
  token?: string;
}

export const CartAndCheckoutScreen: React.FC<Props> = ({
  cart,
  onUpdateQuantity,
  onBack,
  onOrderPlaced,
  restaurantId,
  apiUrl,
  token
}) => {
  const [couponCode, setCouponCode] = useState('WELCOME50');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>('WELCOME50');
  const [isGoldMember] = useState(true); // Rahul Sharma is a Quick Bite Gold subscriber
  const [isProcessing, setIsProcessing] = useState(false);

  // Map cart items for pricing engine
  const pricingItems = cart.map(item => ({
    unitPrice: item.price,
    quantity: item.quantity
  }));

  const pricingResult = calculateOrderPricing({
    items: pricingItems,
    isGold: isGoldMember,
    packagingFee: 25.00,
    distanceKm: 2.5,
    coupon: appliedCoupon === 'WELCOME50'
      ? {
          discountType: 'PERCENTAGE',
          discountValue: 50,
          maxDiscountCap: 100,
          minOrderValue: 200
        }
      : undefined
  });

  const handleApplyCoupon = () => {
    if (couponCode.trim().toUpperCase() === 'WELCOME50') {
      setAppliedCoupon('WELCOME50');
    } else if (couponCode.trim().toUpperCase() === 'FREEDEL') {
      setAppliedCoupon('FREEDEL');
    } else {
      setAppliedCoupon(null);
    }
  };

  const handleCheckout = async () => {
    setIsProcessing(true);
    const effectiveBase = apiUrl || 'http://10.0.2.2:5000/api';
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
          dishId: item.id,
          quantity: item.quantity
        })),
        paymentMethod: 'RAZORPAY_SANDBOX',
        couponCode: appliedCoupon || undefined,
        idempotencyKey: generatedUUID,
        distanceKm: 2.5
      };

      const res = await fetch(`${effectiveBase}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : 'Bearer demo-customer-token'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success && data.data?.order) {
        setIsProcessing(false);
        onOrderPlaced({
          orderNumber: data.data.order.orderNumber,
          total: data.data.order.pricing?.totalAmount || pricingResult.totalAmount,
          otp: data.data.order.deliveryOtp || `${Math.floor(1000 + Math.random() * 9000)}`
        });
        return;
      }
    } catch {
      // Backend not reachable, use fallback
    }

    setIsProcessing(false);
    const randomOrderNo = `QB-${Math.floor(100000 + Math.random() * 900000)}`;
    const randomOtp = `${Math.floor(1000 + Math.random() * 9000)}`;
    onOrderPlaced({
      orderNumber: randomOrderNo,
      total: pricingResult.totalAmount,
      otp: randomOtp
    });
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
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Header */}
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <ArrowLeft size={20} color="#0F172A" />
        <Text style={styles.backText}>Back to Restaurant</Text>
      </TouchableOpacity>

      <Text style={styles.pageTitle}>Order Summary & Checkout</Text>

      {/* Cart Items List */}
      <View style={styles.cardSection}>
        <Text style={styles.sectionHeader}>Selected Items</Text>
        {cart.map(item => (
          <View key={item.id} style={styles.cartItemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>Rs {(item.price * item.quantity).toFixed(2)}</Text>
            </View>

            <View style={styles.stepperContainer}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => onUpdateQuantity(item.id, -1)}
              >
                <Minus size={14} color={tokens.colors.primary[500]} />
              </TouchableOpacity>
              <Text style={styles.stepperCount}>{item.quantity}</Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => onUpdateQuantity(item.id, 1)}
              >
                <Plus size={14} color={tokens.colors.primary[500]} />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Delivery Address */}
      <View style={styles.cardSection}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <MapPin size={18} color={tokens.colors.primary[500]} />
          <Text style={styles.sectionHeader}>Delivery Location</Text>
        </View>
        <Text style={styles.addressTitle}>Home • Indiranagar</Text>
        <Text style={styles.addressDesc}>Flat 402, Green Glen Towers, 100 Feet Road, Bengaluru</Text>
      </View>

      {/* Coupon Box */}
      <View style={styles.cardSection}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Tag size={18} color={tokens.colors.primary[500]} />
          <Text style={styles.sectionHeader}>Apply Coupons</Text>
        </View>
        <View style={styles.couponRow}>
          <TextInput
            style={styles.couponInput}
            value={couponCode}
            onChangeText={setCouponCode}
            placeholder="Enter coupon code (e.g. WELCOME50)"
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.applyBtn} onPress={handleApplyCoupon}>
            <Text style={styles.applyBtnText}>APPLY</Text>
          </TouchableOpacity>
        </View>
        {appliedCoupon && (
          <Text style={styles.couponSuccess}>Coupon '{appliedCoupon}' applied successfully!</Text>
        )}
      </View>

      {/* Gold Member Highlight */}
      {isGoldMember && (
        <View style={styles.goldCard}>
          <Sparkles size={18} color="#D97706" />
          <Text style={styles.goldText}>
            Quick Bite Gold applied: Rs {pricingResult.deliveryFee === 0 ? '40 Delivery Fee Waived' : 'Free Delivery'}
          </Text>
        </View>
      )}

      {/* Bill Breakdown Powered by @quick-bites/pricing-engine */}
      <View style={styles.cardSection}>
        <Text style={styles.sectionHeader}>Bill Details</Text>

        <View style={styles.billRow}>
          <Text style={styles.billLabel}>Item Total</Text>
          <Text style={styles.billValue}>Rs {pricingResult.itemsTotal.toFixed(2)}</Text>
        </View>

        <View style={styles.billRow}>
          <Text style={styles.billLabel}>GST on Food (5%)</Text>
          <Text style={styles.billValue}>Rs {pricingResult.gstAmount.toFixed(2)}</Text>
        </View>

        <View style={styles.billRow}>
          <Text style={styles.billLabel}>Restaurant Packaging Charges</Text>
          <Text style={styles.billValue}>Rs {pricingResult.packagingFee.toFixed(2)}</Text>
        </View>

        <View style={styles.billRow}>
          <Text style={styles.billLabel}>Delivery Partner Fee</Text>
          <Text style={[styles.billValue, pricingResult.deliveryFee === 0 && { color: tokens.colors.dietary.veg }]}>
            {pricingResult.deliveryFee === 0 ? 'FREE' : `Rs ${pricingResult.deliveryFee.toFixed(2)}`}
          </Text>
        </View>

        <View style={styles.billRow}>
          <Text style={styles.billLabel}>Platform Fee (incl. 18% GST)</Text>
          <Text style={styles.billValue}>Rs {pricingResult.platformFee.toFixed(2)}</Text>
        </View>

        {pricingResult.couponDiscount > 0 && (
          <View style={styles.billRow}>
            <Text style={[styles.billLabel, { color: tokens.colors.dietary.veg }]}>Coupon Discount</Text>
            <Text style={[styles.billValue, { color: tokens.colors.dietary.veg }]}>
              -Rs {pricingResult.couponDiscount.toFixed(2)}
            </Text>
          </View>
        )}

        <View style={styles.billTotalRow}>
          <Text style={styles.billTotalLabel}>Grand Total To Pay</Text>
          <Text style={styles.billTotalValue}>Rs {pricingResult.totalAmount.toFixed(2)}</Text>
        </View>
      </View>

      {/* Pay Now Button (Razorpay Simulated Flow) */}
      <TouchableOpacity
        style={styles.payButton}
        onPress={handleCheckout}
        disabled={isProcessing}
      >
        <CreditCard size={18} color="#FFFFFF" />
        <Text style={styles.payButtonText}>
          {isProcessing ? 'Verifying with Razorpay...' : `Pay Rs ${pricingResult.totalAmount.toFixed(2)} via UPI / Card`}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16
  },
  backText: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600'
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 16
  },
  cardSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 10
  },
  cartItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC'
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A'
  },
  itemPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.colors.primary[500],
    marginTop: 2
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: tokens.colors.primary[500],
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 8
  },
  stepperBtn: {
    padding: 2
  },
  stepperCount: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.colors.primary[500]
  },
  addressTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A'
  },
  addressDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
  },
  couponRow: {
    flexDirection: 'row',
    gap: 8
  },
  couponInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
    fontSize: 13,
    fontWeight: '700'
  },
  applyBtn: {
    backgroundColor: tokens.colors.primary[50],
    borderWidth: 1,
    borderColor: tokens.colors.primary[500],
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  applyBtnText: {
    color: tokens.colors.primary[500],
    fontWeight: '800',
    fontSize: 12
  },
  couponSuccess: {
    fontSize: 11,
    color: tokens.colors.dietary.veg,
    fontWeight: '600',
    marginTop: 6
  },
  goldCard: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14
  },
  goldText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    flex: 1
  },
  billRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4
  },
  billLabel: {
    fontSize: 13,
    color: '#64748B'
  },
  billValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A'
  },
  billTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0'
  },
  billTotalLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A'
  },
  billTotalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: tokens.colors.primary[500]
  },
  payButton: {
    backgroundColor: tokens.colors.primary[500],
    borderRadius: 12,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6
  },
  payButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20
  },
  backToMenuBtn: {
    backgroundColor: tokens.colors.primary[500],
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8
  },
  backToMenuText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14
  }
});
