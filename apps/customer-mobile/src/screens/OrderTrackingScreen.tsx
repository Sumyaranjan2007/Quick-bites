import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Linking, Alert } from 'react-native';
import { Bike, Phone, ArrowLeft, Check, MessageCircle, Eye, EyeOff, Star } from 'lucide-react-native';
import { Card } from '../components/ui';
import { LiveOrderMap } from '../components/LiveOrderMap';
import { OrderChat } from '../components/OrderChat';
import { RatingSheet } from '../components/RatingSheet';
import { useTranslation } from '../lib/i18n';
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

/*
 * Where the FOOD is, as a tick on the customer's tracker.
 *
 * RIDER_ASSIGNED used to map to step 3 - the same step as OUT_FOR_DELIVERY -
 * so a rider merely accepting the job advanced the customer's tracker as
 * though the food had left the restaurant. It had not; it was often still
 * cooking. That is the screen behind "it says out for delivery and nobody has
 * collected anything".
 *
 * The rider's own progress is not a step here at all. It is a separate line,
 * because the two genuinely move independently and squeezing them into one
 * sequence is what produced the wrong tick.
 */
const STATUS_STEP_INDEX: Record<string, number> = {
  PAYMENT_PENDING: 0,
  ORDER_PLACED: 0,
  ACCEPTED: 1,
  PREPARING: 2,
  READY_FOR_PICKUP: 2,
  HANDED_TO_RIDER: 3,
  OUT_FOR_DELIVERY: 3,
  DELIVERED: 4
};

/**
 * Where the RIDER is, in the customer's words. Shown on its own line beneath
 * the ticks, so "a rider is coming" never reads as "your food has left".
 */
export const RIDER_STAGE_TEXT: Record<string, string> = {
  UNASSIGNED: '',
  OFFERED: '',
  HEADING_TO_RESTAURANT: 'Your rider is on the way to the restaurant',
  AT_RESTAURANT: 'Your rider is at the restaurant',
  PICKED_UP: 'Your rider has collected your order',
  AT_DOORSTEP: 'Your rider is at your door',
  DELIVERED: ''
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
  // The tracking screen is the one a customer stares at, so it speaks their
  // language; the cancellation reasons are fetched in it too.
  const { t, language } = useTranslation();
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

  /*
   * WHEN THERE IS A MAP AT ALL, and which phase it is in.
   *
   * The map appears once the kitchen has ACCEPTED — before that there is nothing
   * honest to show a customer about a restaurant that may still decline — and it
   * goes when the order closes, because a delivered order does not need a live
   * view of anything.
   *
   * `carryingNow` reads `pickedUpAt` rather than the status. The two-track model
   * keeps the food's progress and the rider's progress apart on purpose, and the
   * server withholds the rider's coordinates on this same field, so the screen
   * and the server cannot end up in different phases.
   */
  const ACCEPTED_ONWARD = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'HANDED_TO_RIDER', 'OUT_FOR_DELIVERY'];
  const carryingNow = Boolean(tracking?.pickedUpAt);
  const mapVisible = !isClosed && (ACCEPTED_ONWARD.includes(status) || riderAssigned);

  // Push updates arrive instantly; the poll below is only a fallback for
  // networks where websockets are blocked.
  const { connected: liveConnected } = useOrderSocket(orderId, apiUrl, token, {
    onStatus: u => {
      setCurrentStep(STATUS_STEP_INDEX[u.status] ?? 0);
      // The order object drives everything that must vanish on delivery - OTP,
      // map, call and chat - so the pushed status has to land on it too. Waiting
      // for the next poll left a delivered order still showing a live delivery
      // for up to twenty seconds, which is the whole complaint.
      setOrder((prev: any) =>
        prev
          ? {
              ...prev,
              status: u.status,
              // Only when the update actually carries one. Most status changes
              // are about the food and say nothing about the rider, and
              // overwriting with `undefined` would blank the rider's line
              // every time the kitchen pressed a button.
              riderStage: u.riderStage ?? prev.riderStage,
              deliveredAt: u.status === 'DELIVERED' ? u.updatedAt : prev.deliveredAt
            }
          : prev
      );
    },
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
  const riderStageText = RIDER_STAGE_TEXT[order?.riderStage as string] || '';
  const riderPhone: string | undefined = order?.riderPhone || tracking?.riderPhone;
  const existingRating: number | null = order?.rating ?? null;
  const shownRating = submittedRating ?? existingRating;

  /**
   * The arrival estimate, computed by the server from this order.
   *
   * This screen used to derive it from a table of constants — ten minutes once
   * out for delivery, fifteen once ready, whatever the kitchen promised before
   * that. Those numbers were the same at minute one and minute forty, so the
   * screen kept saying "~10 min" long after the customer knew it was wrong.
   *
   * The server measures the real distance, counts down the kitchen's own
   * promise, and switches to the rider's actual position after pickup. The
   * local figure survives only as a fallback for the seconds before the first
   * tracking response lands, so the box is never empty.
   */
  const serverEta = tracking?.eta;
  const fallbackEtaMinutes = (Number(order?.preparationMinutes) || 20) + 10;
  const etaMinutes: number | null =
    typeof serverEta?.minutesRemaining === 'number'
      ? serverEta.minutesRemaining
      : isClosed
        ? null
        : fallbackEtaMinutes;

  const etaCaption = (() => {
    switch (serverEta?.basis) {
      case 'RIDER_EN_ROUTE':
        return t('tracking.etaEnRoute');
      case 'KITCHEN_ESTIMATE':
      case 'PREP_AND_TRAVEL':
        return t('tracking.etaPrep');
      default:
        return null;
    }
  })();

  /**
   * Cancelling.
   *
   * The reasons are fetched rather than listed here, so the wording and the
   * translations live in one place on the server and a new reason does not need
   * a new build of this app.
   */
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReasons, setCancelReasons] = useState<Array<{ code: string; label: string; allowsNote: boolean }>>([]);
  const [cancelCode, setCancelCode] = useState<string>('');
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Cancellable exactly while the server's state machine allows it. Showing the
  // button later would offer something that can only fail.
  const canCancel = ['PAYMENT_PENDING', 'ORDER_PLACED', 'ACCEPTED', 'PREPARING'].includes(status);

  // What cancelling NOW costs and returns (U1). Asked every time the sheet
  // opens, because the answer changes the moment the kitchen starts cooking.
  const [cancelQuote, setCancelQuote] = useState<{ canCancel: boolean; fee: number; refund: number; message: string } | null>(null);

  const openCancel = async () => {
    setCancelOpen(true);
    setCancelQuote(null);
    if (apiUrl && token && orderId) {
      apiFetch(`${apiUrl}/orders/${orderId}/cancellation-quote`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (data?.success && data.data) setCancelQuote(data.data);
        })
        .catch(() => {
          // Without a quote the server still decides; the sheet just cannot say the fee first.
        });
    }
    if (cancelReasons.length || !apiUrl || !token) return;
    try {
      const res = await apiFetch(`${apiUrl}/orders/cancellation-reasons?language=${language}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data?.success && Array.isArray(data.data?.reasons)) {
        setCancelReasons(data.data.reasons);
        setCancelCode(data.data.reasons[0]?.code ?? '');
      }
    } catch {
      // The sheet stays open with no reasons and the confirm button disabled,
      // which is honest: without a reason the server will refuse anyway.
    }
  };

  const confirmCancel = async () => {
    if (!apiUrl || !token || !orderId || !cancelCode) return;
    setCancelling(true);
    try {
      const res = await apiFetch(`${apiUrl}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          status: 'CANCELLED',
          cancellationReasonCode: cancelCode,
          ...(cancelNote.trim() ? { cancellationNote: cancelNote.trim() } : {})
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        Alert.alert(
          t('tracking.cancelOrder'),
          data?.error?.message || t('tracking.cancelTooLate')
        );
        return;
      }
      setCancelOpen(false);
      setOrder((prev: any) => (prev ? { ...prev, ...data.data } : data.data));
      if (data.data?.refund) {
        Alert.alert(t('tracking.cancelOrder'), t('tracking.refundStarted'));
      }
    } catch {
      Alert.alert(t('tracking.cancelOrder'), t('tracking.cancelTooLate'));
    } finally {
      setCancelling(false);
    }
  };

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
      /*
       * This step is about the FOOD leaving the restaurant, and its wording
       * used to say "rider assigned and on the way" - reached whenever a rider
       * merely accepted the job, while the food was often still cooking. That
       * sentence, on that step, is the screen behind "it says out for delivery
       * and nobody has collected anything".
       *
       * Where the rider is now has its own line below, because the two move
       * independently.
       */
      title: 'Out for Delivery',
      desc: riderName ? `On its way with ${riderName}` : 'On its way to you'
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
              <Text style={styles.etaLabel}>{t('tracking.eta').toUpperCase()}</Text>
              <Text style={styles.etaValue}>
                {etaMinutes === null ? '—' : t('tracking.etaMinutes', { minutes: etaMinutes })}
              </Text>
            </View>
          )}
        </View>

        {/* Cancelling is offered on the hero, where the customer is already
            looking, rather than buried in support. A cancellation that is hard
            to find becomes a phone call to the restaurant. */}
        {canCancel && (
          <TouchableOpacity style={styles.cancelLink} onPress={openCancel} activeOpacity={0.75}>
            <Text style={styles.cancelLinkText}>{t('tracking.cancelOrder')}</Text>
          </TouchableOpacity>
        )}

        {!!etaCaption && !isClosed && <Text style={styles.etaCaption}>{etaCaption}</Text>}

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

      {/*
        THE MAP APPEARS WHEN THE KITCHEN ACCEPTS, not when a rider is assigned.

        It used to be gated on `riderAssigned`, so a customer whose order had
        been accepted and was being cooked saw a line of text saying live
        location would start later. The owner asked for the restaurant and the
        distance to it in that window — "when partner accepts the order then also
        customer should be able to see the map".
      */}
      {mapVisible && (
        <Card style={styles.block}>
          <Text style={styles.blockTitle}>{carryingNow ? 'Live location' : 'Your order'}</Text>
          <LiveOrderMap
            rider={tracking?.riderCoordinates ?? null}
            restaurant={tracking?.restaurantCoordinates ?? null}
            /* Falls back to the order's own delivery coordinates. A rider ping
               can arrive over the socket before the first tracking fetch
               returns, and the merge then produces a rider with no destination -
               leaving the map stuck on "waiting for the delivery address"
               even though the order has carried that address all along. */
            destination={tracking?.destinationCoordinates ?? order?.deliveryCoordinates ?? null}
            pickedUpAt={tracking?.pickedUpAt ?? null}
            updatedAt={tracking?.riderLocationUpdatedAt}
            riderName={tracking?.riderName ?? riderName}
            restaurantName={tracking?.restaurantName ?? order?.restaurantName ?? null}
          />
        </Card>
      )}

      {/*
        THE RIDER'S OWN LINE, which is the second of the two tracks.

        The ticks above are the food. This is the rider, and it is deliberately
        not a tick: a rider who has accepted and is riding over has not moved
        the customer's order along, and showing it as progress is exactly what
        made the tracker claim a delivery that had not started.

        Rendered only when there is something to say. UNASSIGNED, OFFERED and
        DELIVERED map to an empty string - before a rider exists there is
        nothing to report, and afterwards the delivered card says it better.
      */}
      {!isClosed && !!riderStageText && (
        <Card style={styles.block}>
          <View style={styles.riderTrackRow}>
            <Bike size={16} color={c.primary[500]} />
            <Text style={styles.riderTrackText}>{riderStageText}</Text>
          </View>
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

      {/* Cancelling, with a reason.
          The reasons come from the server so this app and the partner app agree
          on the list, and so a reason can be added or reworded without a
          release. A paid order refunds itself as part of the same request. */}
      <Modal visible={cancelOpen} transparent animationType="slide" onRequestClose={() => setCancelOpen(false)}>
        <View style={styles.cancelBackdrop}>
          <View style={styles.cancelSheet}>
            <Text style={styles.cancelTitle}>{t('tracking.cancelTitle')}</Text>
            <Text style={styles.cancelBody}>{t('tracking.cancelBody')}</Text>
            {cancelQuote ? (
              <View style={[styles.cancelQuote, cancelQuote.fee > 0 && styles.cancelQuoteFee]}>
                <Text style={styles.cancelQuoteText}>
                  {cancelQuote.canCancel ? cancelQuote.message : t('tracking.cancelTooLate')}
                </Text>
              </View>
            ) : null}

            <ScrollView style={{ maxHeight: 260 }}>
              {cancelReasons.map(reason => {
                const selected = cancelCode === reason.code;
                return (
                  <TouchableOpacity
                    key={reason.code}
                    style={[styles.cancelReason, selected && styles.cancelReasonOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setCancelCode(reason.code);
                      // A note only belongs to a reason that accepts one; the
                      // server drops it otherwise, so leaving it visible would
                      // promise the customer it had been read.
                      if (!reason.allowsNote) setCancelNote('');
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.cancelRadio, selected && styles.cancelRadioOn]} />
                    <Text style={styles.cancelReasonText}>{reason.label}</Text>
                  </TouchableOpacity>
                );
              })}

              {cancelReasons.find(r => r.code === cancelCode)?.allowsNote && (
                <TextInput
                  style={styles.cancelNote}
                  placeholder={t('tracking.cancelNote')}
                  placeholderTextColor={c.text.muted}
                  value={cancelNote}
                  onChangeText={setCancelNote}
                  maxLength={300}
                  multiline
                />
              )}
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.cancelConfirm,
                (!cancelCode || cancelling || cancelQuote?.canCancel === false) && styles.cancelDisabled
              ]}
              disabled={!cancelCode || cancelling || cancelQuote?.canCancel === false}
              onPress={confirmCancel}
              activeOpacity={0.9}
            >
              {cancelling ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.cancelConfirmText}>{t('tracking.cancelConfirm')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelKeep} onPress={() => setCancelOpen(false)} activeOpacity={0.8}>
              <Text style={styles.cancelKeepText}>{t('tracking.cancelKeep')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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

  etaCaption: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 10 },
  cancelLink: { marginTop: 12, alignSelf: 'flex-start' },
  cancelLinkText: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.bold,
    color: c.semantic.error
  },
  cancelBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  cancelSheet: {
    backgroundColor: c.surface.card,
    borderTopLeftRadius: tokens.radii.xl,
    borderTopRightRadius: tokens.radii.xl,
    padding: 20
  },
  cancelTitle: {
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary
  },
  cancelBody: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 6, marginBottom: 14 },
  cancelQuote: { borderRadius: 10, padding: 12, marginBottom: 12, backgroundColor: c.surface.subtle ?? '#F4F1EE' },
  cancelQuoteFee: { backgroundColor: '#FFF4E5' },
  cancelQuoteText: { fontSize: tokens.font.size.sm, color: c.text.primary, lineHeight: 19 },
  cancelReason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  cancelReasonOn: { opacity: 1 },
  cancelRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: c.border.strong
  },
  cancelRadioOn: { borderColor: c.primary[500], backgroundColor: c.primary[500] },
  cancelReasonText: { flex: 1, fontSize: tokens.font.size.sm, color: c.text.primary },
  cancelNote: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: tokens.radii.md,
    padding: 12,
    minHeight: 72,
    textAlignVertical: 'top',
    fontSize: tokens.font.size.sm,
    color: c.text.primary
  },
  cancelConfirm: {
    marginTop: 16,
    backgroundColor: c.semantic.error,
    borderRadius: tokens.radii.md,
    paddingVertical: 14,
    alignItems: 'center'
  },
  cancelDisabled: { opacity: 0.45 },
  cancelConfirmText: { color: '#FFFFFF', fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold },
  cancelKeep: { marginTop: 10, paddingVertical: 12, alignItems: 'center' },
  cancelKeepText: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold, color: c.text.secondary },

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
  riderTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  riderTrackText: { flex: 1, fontSize: tokens.font.size.sm, color: c.text.secondary, lineHeight: 19 },
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