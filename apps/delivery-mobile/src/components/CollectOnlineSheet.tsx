import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { QrCode, CheckCircle2, X, Banknote, WifiOff } from 'lucide-react-native';
import { t } from '../theme';
import { Button } from './ui';
import { cashApi, type ApiContext, type DoorQrView } from '../lib/api';

/**
 * Taking UPI at the door instead of cash.
 *
 * -------------------------------------------------------------------------
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * -------------------------------------------------------------------------
 * Every order paid this way is one the rider does not have to carry cash for.
 * No bag to guard, no trip to the office, no counting, no shortfall to explain.
 * So the button is offered first and cash is what happens if this does not
 * work — not the other way round.
 *
 * -------------------------------------------------------------------------
 * THE RIDER CANNOT SAY IT WAS PAID
 * -------------------------------------------------------------------------
 * There is deliberately no "mark as paid" control here. Payment is confirmed by
 * the gateway and nothing else: the screen polls, and the green state appears
 * only when Razorpay says money arrived.
 *
 * That has a cost, and it is the right cost. A rider on a dead network whose
 * customer really has paid cannot force it through, and has to take cash. The
 * alternative — trusting the phone — lets every rider on the platform close any
 * order for free.
 *
 * -------------------------------------------------------------------------
 * AND IT NEVER SAYS "NOT PAID" WHEN IT MEANS "I COULD NOT CHECK"
 * -------------------------------------------------------------------------
 * A rider told "not paid" takes cash. If that happened because our network
 * blinked on an order the customer has already paid for, the rider is now
 * carrying money nobody expects and the customer has paid twice. Unreachable is
 * shown as its own state, in its own words.
 */
export const CollectOnlineSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  ctx: ApiContext;
  orderId: string;
  /** Called once the gateway confirms, so the trip screen can stop asking for cash. */
  onPaid: () => void;
}> = ({ visible, onClose, ctx, orderId, onPaid }) => {
  const [qr, setQr] = useState<DoorQrView | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  // Kept in a ref so the polling loop can stop itself without being restarted
  // by every state change it causes.
  const pollingRef = useRef(false);

  const create = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await cashApi.collectOnline(ctx, orderId);
      setQr(result.qr);
    } catch (err: any) {
      setError(err?.message || 'That QR code could not be created. Take cash for this one.');
    } finally {
      setCreating(false);
    }
  }, [ctx, orderId]);

  useEffect(() => {
    if (visible && !qr && !creating && !error) void create();
  }, [visible, qr, creating, error, create]);

  /*
   * Polling, every three seconds while the sheet is open.
   *
   * A webhook can be seconds late and the rider is standing on a doorstep. The
   * poll asks the gateway directly, which is the only authority either path
   * consults.
   */
  useEffect(() => {
    if (!visible || !qr || paid) {
      pollingRef.current = false;
      return;
    }

    pollingRef.current = true;
    let cancelled = false;

    const tick = async () => {
      while (pollingRef.current && !cancelled) {
        try {
          const status = await cashApi.doorPaymentStatus(ctx, orderId);
          if (cancelled) return;
          if (status.paid) {
            setPaid(true);
            setUnreachable(false);
            pollingRef.current = false;
            onPaid();
            return;
          }
          setUnreachable(status.status === 'unreachable');
        } catch {
          if (!cancelled) setUnreachable(true);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    };

    void tick();
    return () => {
      cancelled = true;
      pollingRef.current = false;
    };
  }, [visible, qr, paid, ctx, orderId, onPaid]);

  const takeCashInstead = async () => {
    try {
      await cashApi.cancelOnline(ctx, orderId);
    } catch {
      /* The code expires by itself. Nothing here is worth blocking a delivery. */
    }
    setQr(null);
    setPaid(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <QrCode size={20} color={t.color.brand} />
            <Text style={s.title}>Collect online</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={20} color={t.color.textMuted} />
            </TouchableOpacity>
          </View>

          {paid ? (
            <View style={s.paidBox}>
              <CheckCircle2 size={48} color={t.color.go} />
              <Text style={s.paidTitle}>Paid</Text>
              <Text style={s.paidBody}>
                Do not take cash for this order. Hand over the food and confirm the delivery as usual.
              </Text>
              <Button label="Done" variant="go" onPress={onClose} style={{ marginTop: 16 }} />
            </View>
          ) : creating ? (
            <View style={s.centre}>
              <ActivityIndicator color={t.color.brand} />
              <Text style={s.centreText}>Creating a code for this order…</Text>
            </View>
          ) : error ? (
            <View style={s.centre}>
              <Banknote size={36} color={t.color.money} />
              <Text style={s.errorText}>{error}</Text>
              <Button label="Try again" variant="secondary" onPress={create} style={{ marginTop: 12 }} />
              <Button label="Take cash instead" variant="ghost" onPress={takeCashInstead} />
            </View>
          ) : qr ? (
            <>
              <Text style={s.amount}>{qr.amountLabel}</Text>
              <Text style={s.instruction}>
                Show this to the customer. Any UPI app will scan it — GPay, PhonePe, Paytm.
              </Text>

              {!!qr.imageUrl && (
                <View style={s.qrFrame}>
                  <Image source={{ uri: qr.imageUrl }} style={s.qrImage} resizeMode="contain" />
                </View>
              )}

              {unreachable ? (
                <View style={s.waitRow}>
                  <WifiOff size={16} color={t.color.money} />
                  <Text style={s.waitTextWarn}>
                    Cannot check right now. Do not take cash until this says paid — they may have paid
                    already.
                  </Text>
                </View>
              ) : (
                <View style={s.waitRow}>
                  <ActivityIndicator size="small" color={t.color.brand} />
                  <Text style={s.waitText}>Waiting for the payment. This screen turns green by itself.</Text>
                </View>
              )}

              <Button label="Take cash instead" variant="ghost" onPress={takeCashInstead} />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(23,19,19,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 32
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  title: { color: t.color.text, fontSize: 17, fontWeight: '800', flex: 1 },

  amount: { color: t.color.text, fontSize: 32, fontWeight: '800', textAlign: 'center' },
  instruction: {
    color: t.color.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 19
  },

  qrFrame: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: 12,
    marginBottom: 16
  },
  qrImage: { width: 220, height: 220 },

  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingHorizontal: 4 },
  waitText: { color: t.color.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 },
  waitTextWarn: { color: t.color.money, fontSize: 12, flex: 1, lineHeight: 17 },

  centre: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  centreText: { color: t.color.textSecondary, fontSize: 13 },
  errorText: { color: t.color.danger, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  paidBox: { alignItems: 'center', paddingVertical: 20 },
  paidTitle: { color: t.color.go, fontSize: 24, fontWeight: '800', marginTop: 12 },
  paidBody: {
    color: t.color.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
    paddingHorizontal: 12
  }
});

export default CollectOnlineSheet;
