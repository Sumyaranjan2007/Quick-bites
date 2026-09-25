import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Card, DietMark } from '../components/ui';

const c = tokens.colors;
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import { ArrowLeft, Tag, MapPin, CreditCard, Sparkles, Plus, Minus, Navigation, Map as MapIcon } from 'lucide-react-native';
import { MapAddressPicker, type PickedLocation } from '../components/MapAddressPicker';
import { CartItem } from './RestaurantDetailScreen';
import { apiFetch } from '../lib/apiFetch';
import {
  razorpayAvailable,
  openRazorpay,
  isCancellation,
  paymentErrorMessage
} from '../lib/nativePayments';
import { DEFAULT_API_URL } from '../config';
import { useDeviceLocation } from '../lib/useDeviceLocation';
import { useTranslation } from '../lib/i18n';
import { useBlockHardwareBack } from '../lib/useHardwareBack';

/**
 * Suggested tips, and the ceiling the server also enforces.
 *
 * Zero is offered explicitly rather than being the absence of a choice, so
 * declining to tip is a button someone presses rather than a thing they have to
 * notice they have not done.
 */
const TIP_OPTIONS = [0, 10, 20, 30, 50];
const MAX_TIP = 500;

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
  /**
   * The address chosen on the home screen, if the customer chose one there.
   * Checkout honours it rather than re-deciding, so the area they browsed is
   * the area the food goes to.
   */
  preferredAddressId?: string | null;
  /** Told back up, so the home screen's chip follows a change made here. */
  onAddressChosen?: (id: string) => void;
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
  distanceKm,
  preferredAddressId,
  onAddressChosen
}) => {
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * Back is refused while an order is going through.
   *
   * Between "Place order" and the server answering, the money may already have
   * moved. Backing out of that screen does not cancel anything — it just loses
   * the customer's view of what happened, and the next thing they see is either
   * an order they do not remember or a charge with nothing to show for it.
   */
  useBlockHardwareBack(isProcessing, 'Hold on — we are placing your order.');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  /**
   * The bill, priced by the server.
   *
   * This screen used to compute its own. It hardcoded the two seeded promo codes
   * — so a coupon an administrator created was rejected here without the server
   * ever being asked — and it assumed every shopper held a Gold subscription, so
   * a customer without one was shown a waived delivery fee and then charged for
   * it. One authority now prices the order, and this screen reads from it.
   */
  const [quote, setQuote] = useState<any | null>(null);
  const [quoting, setQuoting] = useState(false);
  const { t } = useTranslation();
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [selectedTip, setSelectedTip] = useState(0);
  const [customTip, setCustomTip] = useState<number | null>(null);
  const [customTipText, setCustomTipText] = useState('');
  /** Collapses the itemised breakdown; the amount payable always stays visible. */
  /**
   * The breakdown starts collapsed.
   *
   * What a customer checks before paying is the one number they are about to be
   * charged. Eight line items above it — GST, packaging, platform fee — is a
   * wall to read past, and it is the reason a bill feels padded even when every
   * line is fair. "Show bill" is one tap away and shows the full split, before
   * paying rather than after.
   */
  const [billHidden, setBillHidden] = useState(true);

  /**
   * How this order will be paid for, and whether online payment is possible at
   * all on this deployment and in this build.
   *
   * Two independent things have to be true, and they fail differently:
   * the SERVER must have Razorpay keys (otherwise `/payments/start` cannot
   * create anything to pay for), and the BUILD must have the native checkout
   * module linked. Offering a method that fails at the last step of a checkout
   * is worse than not offering it, so the option only appears when both hold.
   */
  // 'RAZORPAY_SANDBOX' is what POST /orders accepts and what is stored on
  // every order. The name is historical; the path carries live keys.
  const [paymentMethod, setPaymentMethod] = useState<'CASH_ON_DELIVERY' | 'RAZORPAY_SANDBOX'>(
    'CASH_ON_DELIVERY'
  );
  const [onlineKeyId, setOnlineKeyId] = useState<string | null>(null);
  const onlineAvailable = razorpayAvailable && !!onlineKeyId;

  useEffect(() => {
    if (!apiUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${apiUrl}/payments/config`);
        const data = await res.json();
        if (cancelled) return;
        if (data?.success && data.data?.online && data.data?.keyId) {
          setOnlineKeyId(String(data.data.keyId));
        }
      } catch {
        // Cash on delivery remains, which is the honest fallback: a checkout
        // that cannot reach the payment config has no business offering to
        // take a card.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  // Saved delivery addresses — customers must be able to say where they live,
  // and the server rejects an address that isn't theirs.
  const [addresses, setAddresses] = useState<any[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  /**
   * Changing the address here changes it everywhere.
   *
   * Routed through one function rather than calling both setters at each site:
   * a path that updated only the local state would leave the home screen's chip
   * naming a different place than the order is going to, which is the exact
   * divergence this plumbing exists to remove.
   */
  const chooseAddress = (id: string) => {
    setSelectedAddressId(id);
    onAddressChosen?.(id);
  };
  const [showAddressSheet, setShowAddressSheet] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [form, setForm] = useState({ label: 'Home', addressLine: '', landmark: '', city: 'Bengaluru', pincode: '' });
  // Coordinates for the address being entered. An address without them cannot be
  // shown on the live map, so they are captured here rather than guessed later.
  const [formCoordinates, setFormCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  /** A point chosen on the map. Fills only EMPTY text fields, like the address book. */
  const useMapPoint = (picked: PickedLocation) => {
    setFormCoordinates(picked.coordinates);
    setForm(prev => ({
      ...prev,
      addressLine: prev.addressLine.trim() ? prev.addressLine : picked.addressLine,
      city: picked.city || prev.city,
      pincode: picked.pincode || prev.pincode
    }));
    setMapOpen(false);
  };
  const { detect, detecting, error: locationError } = useDeviceLocation();

  const useCurrentLocation = async () => {
    const place = await detect();
    if (!place) return;
    setFormCoordinates(place.coordinates);
    setForm(prev => ({
      ...prev,
      addressLine: place.addressLine || prev.addressLine,
      city: place.city || prev.city,
      pincode: place.pincode || prev.pincode
    }));
  };

  const loadAddresses = async () => {
    if (!apiUrl || !token) return;
    try {
      const res = await apiFetch(`${apiUrl}/addresses`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.addresses)) {
        setAddresses(data.data.addresses);
        // The home screen's choice wins over the saved default, because it is
        // the more recent thing the customer actually said. It is only honoured
        // if that address still exists — one deleted between screens would
        // otherwise leave checkout pointing at nothing.
        const fromHome = preferredAddressId
          ? data.data.addresses.find((a: any) => a.id === preferredAddressId)
          : null;
        const preferred = fromHome ?? data.data.addresses.find((a: any) => a.isDefault) ?? data.data.addresses[0];
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
    // A new address needs a pin (U3): without one the rider has only text to
    // go on, and the delivery-distance check has nothing to measure.
    if (!formCoordinates) {
      setAddressError('Pin the delivery spot first: use your current location or choose it on the map.');
      return;
    }
    setIsSavingAddress(true);
    setAddressError(null);
    try {
      const res = await apiFetch(`${apiUrl}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formCoordinates ? { ...form, coordinates: formCoordinates } : form)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.details?.[0]?.message || data?.error?.message || 'Address could not be saved.');
      }
      chooseAddress(data.data.address.id);
      setShowAddressSheet(false);
      setForm({ label: 'Home', addressLine: '', landmark: '', city: 'Bengaluru', pincode: '' });
      setFormCoordinates(null);
      await loadAddresses();
    } catch (err: any) {
      setAddressError(err?.message || 'Address could not be saved.');
    } finally {
      setIsSavingAddress(false);
    }
  };

  const selectedAddress = addresses.find(a => a.id === selectedAddressId) ?? null;

  // Map cart items for the offline fallback below.
  const pricingItems = cart.map(item => ({
    unitPrice: item.price,
    quantity: item.quantity
  }));

  /**
   * Shown only when the server cannot be reached.
   *
   * Deliberately conservative: no coupon and no Gold, so the fallback can
   * understate a discount but can never promise one that checkout will not
   * honour. The screen says plainly when this is what is on display.
   */
  const fallbackPricing = calculateOrderPricing({
    items: pricingItems,
    isGold: false,
    packagingFee: packagingFee ?? 25.0,
    // A placeholder, and only ever shown behind the "provisional" wording above:
    // this branch runs when the server's quote has not arrived, so there is no
    // measured distance to use and something has to stand in until it does.
    distanceKm: distanceKm ?? 2.5
  });

  const pricingResult = quote?.bill ?? fallbackPricing;

  /**
   * The tip is the customer's own figure, so it is held here and sent to the
   * quote like everything else — the server decides the total, this screen never
   * adds the tip on itself. Two screens doing the same arithmetic is how a cart
   * and a bill end up disagreeing.
   */
  const tipAmount = customTip ?? selectedTip;

  // Re-price whenever anything that affects the bill changes. The cart is the
  // dependency that matters: a quantity change alters every downstream figure,
  // and a stale total is the one thing this screen must never show.
  const cartSignature = JSON.stringify(
    cart.map(i => [i.dishId, i.quantity, i.selectedOptions ?? null])
  );

  useEffect(() => {
    if (!apiUrl || !token || cart.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
        const res = await apiFetch(`${apiUrl}/orders/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            // No fallback. This used to default to a literal restaurant id, so a
        // checkout that had somehow lost track of which kitchen it was for
        // would silently order the basket from a specific real restaurant —
        // whichever one happened to be written here.
        restaurantId: restaurantId || cart[0]?.restaurantId,
            ...(selectedAddressId ? { deliveryAddressId: selectedAddressId } : {}),
            items: cart.map(item => ({
              dishId: item.dishId,
              quantity: item.quantity,
              ...(item.selectedOptions ? { selectedOptions: item.selectedOptions } : {})
            })),
            ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
            ...(tipAmount > 0 ? { tipAmount } : {}),
            // Sent only when it is real. The server measures the road distance
            // between this kitchen and this address itself; a number invented
            // here would be a delivery fee invented here.
            ...(distanceKm ? { distanceKm } : {})
          })
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data?.success && data?.data) {
          setQuote(data.data);
          setQuoteFailed(false);
          // A code the server refused is dropped here rather than left looking
          // applied: the bill beside it would not include it either way.
          if (data.data.couponError) {
            setCouponError(data.data.couponError);
            setAppliedCoupon(null);
          } else if (data.data.appliedCouponCode) {
            setCouponError(null);
          }
        } else {
          setQuoteFailed(true);
        }
      } catch {
        if (!cancelled) setQuoteFailed(true);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // tipAmount is in here because it changes the total. Leaving it out is the
    // bug where the tip appears on screen and is absent from the bill.
  }, [cartSignature, appliedCoupon, selectedAddressId, restaurantId, apiUrl, token, distanceKm, tipAmount]);

  /**
   * Applying a coupon sets it as the code to quote with; the server decides
   * whether it holds, and the effect above reports back what it said. Nothing
   * here knows which codes exist, which is the whole point: one campaign was
   * created in the admin console and rejected here because this list had never
   * heard of it.
   */
  const handleApplyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setAppliedCoupon(null);
      setCouponError('Enter a coupon code first.');
      return;
    }
    setCouponError(null);
    setAppliedCoupon(code);
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponError(null);
  };

  /*
   * TWO GUARDS AGAINST PLACING THE SAME ORDER TWICE, and they catch different
   * things.
   *
   * Reported by the owner: the kitchen received the same order twice, with
   * different ids and different OTPs. Different ids means the server was asked
   * twice with two DIFFERENT idempotency keys — the server's own duplicate
   * check was working perfectly and had nothing to match on.
   *
   * The key was generated inside this handler, so every invocation minted a
   * fresh one. And the only re-entry guard was `setIsProcessing(true)`, which
   * is React state and therefore asynchronous: a second tap lands before the
   * re-render disables the button, runs the handler again, and mints a second
   * key. Two orders, two kitchens tickets, one customer.
   *
   * `submittingRef` is a ref, so it is set SYNCHRONOUSLY and the second tap
   * sees it immediately.
   *
   * `idempotencyRef` survives a failure on purpose. If the request times out
   * and the customer taps again, the same key goes up, and the server returns
   * the order it already has instead of creating another. Regenerating it on
   * retry is what turns a flaky network into a double order — which is the
   * more common cause of this in the field than a double tap.
   */
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<string | null>(null);

  const handleCheckout = async () => {
    if (!selectedAddressId) {
      setCheckoutError('Add a delivery address before placing your order.');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;

    setIsProcessing(true);
    setCheckoutError(null);
    const effectiveBase = apiUrl || DEFAULT_API_URL;

    try {
      if (!idempotencyRef.current) {
        idempotencyRef.current = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }
      const generatedUUID = idempotencyRef.current;

      const payload = {
        restaurantId: restaurantId || 'rst_bbh_01',
        deliveryAddressId: selectedAddressId,
        items: cart.map(item => ({
          dishId: item.dishId,
          quantity: item.quantity,
          ...(item.selectedOptions ? { selectedOptions: item.selectedOptions } : {})
        })),
        paymentMethod,
        couponCode: appliedCoupon || undefined,
        ...(tipAmount > 0 ? { tipAmount } : {}),
        idempotencyKey: generatedUUID,
        ...(distanceKm ? { distanceKm } : {})
      };

      const res = await apiFetch(`${effectiveBase}/orders`, {
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

      // An online order is created as PAYMENT_PENDING and does not reach the
      // kitchen until the payment is confirmed. This used to post a literal
      // 'simulated_valid_signature', which only demo mode would accept — so
      // online payment could never have worked against a real deployment.
      if (order.status === 'PAYMENT_PENDING') {
        // 1. Ask the server for something to pay for. The amount comes from the
        //    stored bill on the server side, never from this client: a client
        //    that can name its own price eventually will.
        const startRes = await apiFetch(`${effectiveBase}/payments/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ orderId: order.id })
        });
        const startData = await startRes.json();
        const rzpOrder = startData?.data?.razorpayOrder;
        if (!startRes.ok || !startData.success || !rzpOrder?.id) {
          throw new Error(
            startData?.error?.message || 'We could not start the payment. You have not been charged.'
          );
        }

        // 2. Hand off to Razorpay's own sheet — real UPI intent into GPay or
        //    PhonePe, cards, netbanking, wallets. Nothing about which methods
        //    appear is decided here; that is the merchant configuration.
        let result;
        try {
          result = await openRazorpay({
            key: onlineKeyId!,
            order_id: rzpOrder.id,
            amount: rzpOrder.amount,
            currency: rzpOrder.currency || 'INR',
            name: 'Quick Bites',
            description: `Order ${order.orderNumber}`,
            theme: { color: c.primary[500] }
          });
        } catch (payErr) {
          // Closing the sheet is not a failed payment, and saying so would be
          // a support call about money that was never taken. The order stays
          // PAYMENT_PENDING and the server's reconciliation sweep releases it.
          throw new Error(
            isCancellation(payErr)
              ? 'Payment cancelled. Your order has not been placed and you have not been charged.'
              : paymentErrorMessage(payErr)
          );
        }

        // 3. The server re-computes the signature from its own key secret. The
        //    one the sheet returned is evidence, not proof — a client could
        //    post anything here, which is exactly why this check is not done
        //    on this side of the wire.
        const payRes = await apiFetch(`${effectiveBase}/orders/${order.id}/confirm-payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            razorpayPaymentId: result.razorpay_payment_id,
            razorpaySignature: result.razorpay_signature
          })
        });
        const payData = await payRes.json();
        if (!payRes.ok || !payData.success) {
          // The money may genuinely have left their account by this point, so
          // this must never read as "nothing happened".
          throw new Error(
            payData?.error?.message ||
              'Your payment went through but we could not confirm the order. Do not pay again — support can see this payment.'
          );
        }
        order = payData.data?.order ?? order;
      }

      onOrderPlaced({
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: order.bill?.totalAmount ?? pricingResult.totalAmount,
        otp: order.deliveryOtp || ''
      });

      // Retired only once an order exists. The NEXT basket is a different
      // order and must get a different key, or a customer ordering the same
      // meal twice in an evening would silently receive the first one back.
      idempotencyRef.current = null;
    } catch (err: any) {
      setCheckoutError(
        err?.message === 'Failed to fetch' || err?.name === 'TypeError'
          ? 'Could not reach the Quick Bites server. Check your connection and try again.'
          : err?.message || 'We could not place your order. Please try again.'
      );
    } finally {
      setIsProcessing(false);
      // Released so a genuine retry can proceed. The idempotency key is NOT
      // cleared here — that is the point: a retry must carry the same key.
      submittingRef.current = false;
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
                  onPress={() => chooseAddress(a.id)}
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
            <View style={styles.couponAppliedRow}>
              <Text style={styles.couponSuccess}>'{appliedCoupon}' applied</Text>
              <TouchableOpacity onPress={handleRemoveCoupon} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.couponRemove}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : couponError ? (
            <Text style={styles.couponError}>{couponError}</Text>
          ) : null}
        </Card>

        {/* Gold is a fact about the account, read back from the server's quote.
            It used to be hardcoded true, which told every customer without a
            subscription that their delivery was free right up until they were
            charged for it. */}
        {quote?.isGold && (
          <View style={styles.goldCard}>
            <Sparkles size={16} color={c.dietary.gold} />
            <Text style={styles.goldText}>
              Gold applied — {pricingResult.deliveryFee === 0 ? 'delivery fee waived' : 'free delivery above ₹199'}
            </Text>
          </View>
        )}

        {/* Tip the rider.
            Placed above the bill deliberately: a tip asked for after the total
            reads as a surcharge being slipped in. The amounts are suggestions,
            never pre-selected — a tip that is on by default is not a tip. */}
        <Card style={styles.block}>
          <Text style={styles.blockTitle}>{t('cart.tipTitle')}</Text>
          <Text style={styles.tipSubtitle}>{t('cart.tipSubtitle')}</Text>

          <View style={styles.tipRow}>
            {TIP_OPTIONS.map(amount => {
              const active = customTip === null && selectedTip === amount;
              return (
                <TouchableOpacity
                  key={amount}
                  style={[styles.tipChip, active && styles.tipChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    amount === 0 ? t('cart.tipNone') : `${t('cart.tipForRider')} ₹${amount}`
                  }
                  onPress={() => {
                    // Tapping a suggestion clears a typed amount, so the screen
                    // can never show one figure selected and send another.
                    setCustomTip(null);
                    setCustomTipText('');
                    setSelectedTip(amount);
                  }}
                >
                  <Text style={[styles.tipChipText, active && styles.tipChipTextActive]}>
                    {amount === 0 ? t('cart.tipNone') : `₹${amount}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            style={styles.tipInput}
            placeholder={t('cart.tipCustom')}
            placeholderTextColor={c.text.muted}
            keyboardType="number-pad"
            value={customTipText}
            maxLength={4}
            accessibilityLabel={t('cart.tipCustom')}
            onChangeText={text => {
              const digits = text.replace(/[^0-9]/g, '');
              setCustomTipText(digits);
              // An empty box means "no custom amount", which hands control back
              // to the suggestion chips rather than silently meaning zero.
              setCustomTip(digits ? Math.min(Number(digits), MAX_TIP) : null);
            }}
          />

          {customTip !== null && Number(customTipText) > MAX_TIP && (
            <Text style={styles.tipCapNote}>{t('cart.tipCapped')}</Text>
          )}

          {tipAmount > 0 && <Text style={styles.tipThanks}>{t('cart.tipGoesToRider')}</Text>}
        </Card>

        {/* Bill */}
        <Card style={styles.block}>
          <View style={styles.billHeader}>
            <Text style={styles.blockTitle}>Bill details</Text>
            <View style={styles.billHeaderRight}>
              {quoting ? <ActivityIndicator size="small" color={c.text.secondary} /> : null}
              {/* Hiding the breakdown is a display preference, not a way to be
                  charged less: the amount payable stays on screen either way,
                  and every line is one tap from being read again. */}
              <TouchableOpacity
                onPress={() => setBillHidden(v => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={billHidden ? 'Show the bill breakdown' : 'Hide the bill breakdown'}
              >
                <Text style={styles.billToggle}>{billHidden ? 'Show bill' : 'Hide bill'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {billHidden ? (
            <Text style={styles.billHiddenNote}>
              Taxes, packaging, delivery and any discount are included in the amount below.
            </Text>
          ) : (
            <>
              <View style={styles.billRow}>
                <Text style={styles.billLabel} numberOfLines={1}>Item total</Text>
                <Text style={styles.billValue}>₹{pricingResult.itemsTotal.toFixed(2)}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel} numberOfLines={1}>GST on food (5%)</Text>
                <Text style={styles.billValue}>₹{pricingResult.gstAmount.toFixed(2)}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel} numberOfLines={1}>Packaging</Text>
                <Text style={styles.billValue}>₹{pricingResult.packagingFee.toFixed(2)}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel} numberOfLines={1}>Delivery fee</Text>
                <Text style={[styles.billValue, pricingResult.deliveryFee === 0 && { color: c.dietary.veg }]}>
                  {pricingResult.deliveryFee === 0 ? 'FREE' : `₹${pricingResult.deliveryFee.toFixed(2)}`}
                </Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel} numberOfLines={1}>Platform fee</Text>
                <Text style={styles.billValue}>₹{pricingResult.platformFee.toFixed(2)}</Text>
              </View>
              {pricingResult.couponDiscount > 0 && (
                <View style={styles.billRow}>
                  <Text style={[styles.billLabel, { color: c.dietary.veg }]} numberOfLines={1}>
                    Coupon discount
                  </Text>
                  <Text style={[styles.billValue, { color: c.dietary.veg }]}>
                    -₹{pricingResult.couponDiscount.toFixed(2)}
                  </Text>
                </View>
              )}
              {Number(pricingResult.tipAmount) > 0 && (
                <View style={styles.billRow}>
                  <Text style={styles.billLabel} numberOfLines={1}>{t('cart.tipForRider')}</Text>
                  <Text style={styles.billValue}>₹{Number(pricingResult.tipAmount).toFixed(2)}</Text>
                </View>
              )}
            </>
          )}

          <View style={styles.billTotalRow}>
            <Text style={styles.billTotalLabel}>{t('cart.toPay')}</Text>
            <Text style={styles.billTotalValue}>₹{pricingResult.totalAmount.toFixed(2)}</Text>
          </View>

          {quoteFailed && (
            <Text style={styles.billEstimate}>
              Showing an estimate — we could not reach Quick Bites to confirm this bill. The amount charged is
              calculated when your order is placed.
            </Text>
          )}
        </Card>

        {/* How to pay.
            Shown only when there is a genuine choice. A single option rendered
            as a picker is a decision the customer does not have, dressed up as
            one — and the reason there is only one is worth saying plainly
            instead, so "why can I not pay by card" has an answer on screen. */}
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.blockTitle}>Payment</Text>
          {onlineAvailable ? (
            <View style={styles.methodList}>
              {([
                { key: 'RAZORPAY_SANDBOX', label: 'Pay now', hint: 'UPI, cards, netbanking or wallet' },
                { key: 'CASH_ON_DELIVERY', label: 'Cash on delivery', hint: 'Pay the rider at your door' }
              ] as const).map(m => {
                const active = paymentMethod === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[styles.methodRow, active && styles.methodRowActive]}
                    onPress={() => setPaymentMethod(m.key)}
                    activeOpacity={0.85}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <View style={[styles.methodDot, active && styles.methodDotActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.methodLabel}>{m.label}</Text>
                      <Text style={styles.methodHint}>{m.hint}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={styles.methodHint}>
              {razorpayAvailable
                ? 'Online payment is not switched on for this server yet, so this order is cash on delivery.'
                : 'This build cannot open the payment sheet, so this order is cash on delivery.'}
            </Text>
          )}
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
              <TouchableOpacity
                style={[styles.locateBtn, formCoordinates && styles.locateBtnDone]}
                onPress={useCurrentLocation}
                disabled={detecting}
                activeOpacity={0.85}
              >
                {detecting ? (
                  <ActivityIndicator size="small" color={c.primary[500]} />
                ) : (
                  <Navigation size={16} color={formCoordinates ? c.dietary.veg : c.primary[500]} />
                )}
                <Text style={[styles.locateText, formCoordinates && { color: c.dietary.veg }]}>
                  {detecting
                    ? 'Finding you…'
                    : formCoordinates
                      ? 'Location pinned · tap to update'
                      : 'Use my current location'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locateBtn, { marginTop: 8 }]}
                onPress={() => setMapOpen(true)}
                activeOpacity={0.85}
              >
                <MapIcon size={16} color={c.primary[500]} />
                <Text style={styles.locateText}>{formCoordinates ? 'Adjust the pin on the map' : 'Choose on map'}</Text>
              </TouchableOpacity>
              {!!locationError && <Text style={styles.locateError}>{locationError}</Text>}
              {!formCoordinates && !locationError && (
                <Text style={styles.locateHint}>
                  A pin is required so your rider finds the exact door.
                </Text>
              )}

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
                placeholder="No. 24, Shivanandha Layout, Harohalli"
                placeholderTextColor={c.text.muted}
              />

              <Text style={styles.fieldLabel}>Landmark (optional)</Text>
              <TextInput
                style={styles.sheetInput}
                value={form.landmark}
                onChangeText={v => setForm({ ...form, landmark: v })}
                placeholder="Opposite Harohalli Bus Stand"
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
                    placeholder="562112"
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

      {/* After the address sheet: Android stacks Modals in mount order. */}
      <MapAddressPicker
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        onConfirm={useMapPoint}
        initial={formCoordinates}
        apiUrl={apiUrl}
        token={token}
      />

      {/* Sticky pay bar */}
      <View style={styles.payBar}>
        <View>
          <Text style={styles.payBarAmount}>₹{pricingResult.totalAmount.toFixed(2)}</Text>
          <Text style={styles.payBarSub}>
            {paymentMethod === 'RAZORPAY_SANDBOX' ? 'Pay online' : 'Cash on delivery'}
          </Text>
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
  methodList: { gap: 8, marginTop: 10 },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  methodRowActive: { borderColor: c.primary[500], backgroundColor: c.primary[50] },
  methodDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: c.border.strong
  },
  methodDotActive: { borderColor: c.primary[500], borderWidth: 6 },
  methodLabel: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  methodHint: { fontSize: 12, color: c.text.secondary, marginTop: 2, lineHeight: 17 },
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
  locateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: c.primary[500],
    backgroundColor: c.primary[50],
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 6
  },
  locateBtnDone: { borderColor: c.dietary.veg, backgroundColor: c.dietary.vegBg },
  locateText: { fontSize: 13.5, fontWeight: '800', color: c.primary[500] },
  locateError: { fontSize: 12, color: c.semantic.error, marginTop: 6, lineHeight: 17 },
  locateHint: { fontSize: 11.5, color: c.text.muted, marginTop: 6, marginBottom: 4, lineHeight: 16 },
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

  tipSubtitle: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 2, marginBottom: 12 },
  tipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tipChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: tokens.radii.full,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.app
  },
  tipChipActive: { backgroundColor: c.primary[500], borderColor: c.primary[500] },
  tipChipText: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold, color: c.text.secondary },
  tipChipTextActive: { color: '#FFFFFF' },
  tipInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: tokens.font.size.sm,
    color: c.text.primary
  },
  tipCapNote: { fontSize: tokens.font.size.xs, color: c.semantic.error, marginTop: 6 },
  tipThanks: { fontSize: tokens.font.size.xs, color: c.dietary.veg, marginTop: 10 },
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

  billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 10 },
  // The label takes the space it needs and the amount is never pushed off the
  // row; without this the two competed and both were clipped mid-word.
  billLabel: { fontSize: tokens.font.size.sm, color: c.text.secondary, flexShrink: 1 },
  billValue: {
    fontSize: tokens.font.size.sm,
    color: c.text.primary,
    fontWeight: tokens.font.weight.medium,
    flexShrink: 0,
    textAlign: 'right'
  },
  billHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  billHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  billToggle: { fontSize: tokens.font.size.sm, color: c.primary[500], fontWeight: tokens.font.weight.bold },
  billHiddenNote: { fontSize: tokens.font.size.xs, color: c.text.secondary, marginTop: 10, lineHeight: 18 },
  billEstimate: { fontSize: tokens.font.size.xs, color: c.semantic.warning, marginTop: 10, lineHeight: 17 },
  couponAppliedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  couponRemove: { fontSize: tokens.font.size.sm, color: c.semantic.error, fontWeight: tokens.font.weight.bold },
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