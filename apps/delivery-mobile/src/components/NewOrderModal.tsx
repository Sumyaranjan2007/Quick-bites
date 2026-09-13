import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { Bike, IndianRupee, MapPin, Route, Store, Timer } from 'lucide-react-native';
import { t } from '../theme';
import { Button, Pill } from './ui';
import { distance, rupees } from '../lib/format';
import type { Trip } from '../lib/api';

/**
 * The offer that interrupts everything.
 *
 * A rider is usually not looking at the screen when a trip arrives, so this is
 * a full-screen modal over whatever they were doing, with the two numbers that
 * decide the answer — what it pays and how far it is — set large enough to read
 * at arm's length, and a countdown so a stale offer clears itself rather than
 * sitting there after another rider has taken it.
 */
const OFFER_SECONDS = 30;

export const NewOrderModal: React.FC<{
  trip: Trip | null;
  onAccept: (trip: Trip) => void;
  onDecline: (trip: Trip) => void;
  onExpire: (trip: Trip) => void;
  busy?: boolean;
}> = ({ trip, onAccept, onDecline, onExpire, busy }) => {
  const [remaining, setRemaining] = useState(OFFER_SECONDS);
  const pulse = useRef(new Animated.Value(0)).current;
  // Held in a ref so the countdown effect does not have to re-run — and reset —
  // every time the parent re-renders with a new callback identity.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!trip) return;
    setRemaining(OFFER_SECONDS);

    const started = Date.now();
    const timer = setInterval(() => {
      const left = OFFER_SECONDS - Math.floor((Date.now() - started) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(timer);
        onExpireRef.current(trip);
      }
    }, 250);

    return () => clearInterval(timer);
  }, [trip?.id]);

  useEffect(() => {
    if (!trip) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [trip?.id]);

  if (!trip) return null;

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const seconds = Math.max(0, remaining);

  return (
    <Modal visible animationType="slide" transparent={false} statusBarTranslucent onRequestClose={() => onDecline(trip)}>
      <View style={s.screen}>
        <View style={s.header}>
          <Animated.View style={[s.headerIcon, { transform: [{ scale }] }]}>
            <Bike size={30} color="#04231A" />
          </Animated.View>
          <Text style={s.headerTitle}>New delivery offer</Text>
          <View style={s.timerRow}>
            <Timer size={16} color={seconds <= 10 ? t.color.danger : t.color.money} />
            <Text style={[s.timerText, seconds <= 10 && { color: t.color.danger }]}>
              {seconds}s to respond
            </Text>
          </View>
        </View>

        <View style={s.body}>
          <View style={s.payRow}>
            <View style={s.payBlock}>
              <Text style={s.payLabel}>You earn</Text>
              <View style={s.payValueRow}>
                <IndianRupee size={26} color={t.color.money} strokeWidth={2.5} />
                <Text style={s.payValue}>{trip.estimatedEarnings.toFixed(0)}</Text>
              </View>
            </View>
            <View style={s.payDivider} />
            <View style={s.payBlock}>
              <Text style={s.payLabel}>Total trip</Text>
              <View style={s.payValueRow}>
                <Route size={22} color={t.color.text} strokeWidth={2.5} />
                <Text style={[s.payValue, { color: t.color.text, marginLeft: 6 }]}>
                  {distance(trip.distanceKm)}
                </Text>
              </View>
            </View>
          </View>

          <View style={s.stopsCard}>
            <View style={s.stopRow}>
              <View style={[s.stopDot, { backgroundColor: t.color.money }]}>
                <Store size={14} color="#3A2708" />
              </View>
              <View style={s.stopText}>
                <Text style={s.stopLabel}>Pick up from</Text>
                <Text style={s.stopName}>{trip.restaurantName}</Text>
                <Text style={s.stopAddress} numberOfLines={2}>
                  {trip.pickupAddress}
                </Text>
              </View>
            </View>

            <View style={s.stopConnector} />

            <View style={s.stopRow}>
              <View style={[s.stopDot, { backgroundColor: t.color.go }]}>
                <MapPin size={14} color="#04231A" />
              </View>
              <View style={s.stopText}>
                <Text style={s.stopLabel}>Deliver to</Text>
                <Text style={s.stopName}>{trip.customerName || 'Customer'}</Text>
                <Text style={s.stopAddress} numberOfLines={2}>
                  {trip.dropAddress}
                </Text>
              </View>
            </View>
          </View>

          <View style={s.metaRow}>
            <Pill label={`${trip.itemCount} item${trip.itemCount === 1 ? '' : 's'}`} />
            <Pill
              label={trip.paymentMode === 'COD' ? `Collect ${rupees(trip.cashToCollect, 0)}` : 'Prepaid'}
              tone={trip.paymentMode === 'COD' ? 'money' : 'go'}
              style={{ marginLeft: t.space[2] }}
            />
            <Pill label={`#${trip.orderNumber}`} style={{ marginLeft: t.space[2] }} />
          </View>
        </View>

        <View style={s.actions}>
          <Button label="Pass" variant="ghost" size="lg" onPress={() => onDecline(trip)} style={{ flex: 1 }} />
          <Button
            label="Accept delivery"
            size="lg"
            loading={busy}
            onPress={() => onAccept(trip)}
            style={{ flex: 2, marginLeft: t.space[3] }}
          />
        </View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.color.bg, paddingTop: t.space[12] },
  header: { alignItems: 'center', paddingHorizontal: t.space[6], paddingTop: t.space[6] },
  headerIcon: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: t.color.go,
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerTitle: {
    color: t.color.text,
    fontSize: t.font.size.xl,
    fontWeight: t.font.weight.extrabold,
    marginTop: t.space[4]
  },
  timerRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[2] },
  timerText: { color: t.color.money, fontSize: t.font.size.sm, fontWeight: t.font.weight.bold, marginLeft: 6 },
  body: { flex: 1, paddingHorizontal: t.space[5], paddingTop: t.space[6] },
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    paddingVertical: t.space[5]
  },
  payBlock: { flex: 1, alignItems: 'center' },
  payDivider: { width: 1, alignSelf: 'stretch', backgroundColor: t.color.border },
  payLabel: { color: t.color.textMuted, fontSize: t.font.size.xs, fontWeight: t.font.weight.semibold },
  payValueRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[2] },
  payValue: {
    color: t.color.money,
    fontSize: t.font.size.display,
    fontWeight: t.font.weight.extrabold,
    marginLeft: 2
  },
  stopsCard: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.space[4],
    marginTop: t.space[4]
  },
  stopRow: { flexDirection: 'row' },
  stopDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stopConnector: {
    width: 2,
    height: 22,
    backgroundColor: t.color.borderStrong,
    marginLeft: 13,
    marginVertical: 4
  },
  stopText: { flex: 1, marginLeft: t.space[3] },
  stopLabel: { color: t.color.textMuted, fontSize: t.font.size.xs, fontWeight: t.font.weight.semibold },
  stopName: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.bold, marginTop: 2 },
  stopAddress: { color: t.color.textSecondary, fontSize: t.font.size.sm, marginTop: 2, lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[4], flexWrap: 'wrap' },
  actions: {
    flexDirection: 'row',
    padding: t.space[5],
    paddingBottom: t.space[8],
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    backgroundColor: t.color.surfaceSunken
  }
});
