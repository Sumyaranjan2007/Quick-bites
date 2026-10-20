import { FONT_FAMILY } from '../theme';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Modal } from './Modal';
import { ShieldAlert, Store, MapPin } from 'lucide-react-native';
import { t } from '../theme';
import { Button } from './ui';
import { distance, rupees } from '../lib/format';
import { notifyNewOrder, startOrderAlert, stopOrderAlert } from '../lib/orderAlert';
import type { Trip } from '../lib/api';

/**
 * Operations gave this rider a trip (owner, 20 Oct 2026): full screen, ringing, and the way
 * forward is Start. Shown on every open until the rider starts it; it closes by itself when
 * Operations moves the trip to someone else (the app reloads and the trip is gone, R3-2).
 * Rings twice over: the in-app loop, and a notification on the alert channel, which sounds
 * even with the media volume at zero (R3-12, the R2-5 lesson).
 */
export const AssignedTripModal: React.FC<{
  trip: Trip | null;
  busy: boolean;
  apiUrl: string;
  onStart: (trip: Trip) => void;
}> = ({ trip, busy, apiUrl, onStart }) => {
  const [opsPhone, setOpsPhone] = useState<string | null>(null);

  useEffect(() => {
    if (!trip) return;
    void startOrderAlert();
    void notifyNewOrder({
      orderId: trip.id,
      title: `Operations assigned you order #${trip.orderNumber}`,
      restaurantName: trip.restaurantName,
      payout: trip.estimatedEarnings,
      distanceKm: trip.distanceKm
    });
    return () => void stopOrderAlert();
  }, [trip?.id]);

  useEffect(() => {
    if (!trip) return;
    fetch(`${apiUrl}/policies/business`)
      .then(r => r.json())
      .then(d => setOpsPhone(d?.data?.identity?.contactPhone || null))
      .catch(() => undefined);
  }, [trip?.id, apiUrl]);

  if (!trip) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={() => undefined}>
      <View style={s.screen}>
        <View style={s.header}>
          <ShieldAlert size={44} color={t.color.danger} />
          <Text style={s.title}>Operations has assigned you order #{trip.orderNumber}</Text>
          <Text style={s.sub}>This trip is yours and must be done. Start it now.</Text>
        </View>
        <View style={s.card}>
          <View style={s.row}>
            <Store size={18} color={t.color.money} />
            <Text style={s.rowText}>
              {trip.restaurantName}
              {typeof trip.toKitchenKm === 'number' ? ` · ${distance(trip.toKitchenKm)} from you` : ''}
            </Text>
          </View>
          <View style={s.row}>
            <MapPin size={18} color={t.color.go} />
            <Text style={s.rowText}>
              {trip.dropAddress} · {distance(trip.distanceKm)} from the restaurant
            </Text>
          </View>
          <Text style={s.pay}>
            You earn {rupees(trip.estimatedEarnings)}
            {trip.pickupPay ? ` (incl. ${rupees(trip.pickupPay)} pickup pay)` : ''}
          </Text>
          {trip.handoverNote ? <Text style={s.note}>Collect from the other rider: {trip.handoverNote}</Text> : null}
        </View>
        <Button label="Start trip" size="lg" loading={busy} onPress={() => onStart(trip)} />
        {opsPhone ? (
          <Button label="Call Operations" variant="ghost" onPress={() => void Linking.openURL(`tel:${opsPhone}`)} />
        ) : null}
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.color.bg, padding: t.space[6], justifyContent: 'center', gap: t.space[4] },
  header: { alignItems: 'center', gap: t.space[3] },
  title: { fontFamily: FONT_FAMILY, fontSize: 22, fontWeight: '800', color: t.color.text, textAlign: 'center' },
  sub: { fontFamily: FONT_FAMILY, fontSize: 15, color: t.color.danger, fontWeight: '700', textAlign: 'center' },
  card: { backgroundColor: t.color.surface, borderRadius: 16, padding: t.space[4], gap: t.space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
  rowText: { flex: 1, fontFamily: FONT_FAMILY, fontSize: 15, color: t.color.text },
  pay: { fontFamily: FONT_FAMILY, fontSize: 17, fontWeight: '800', color: t.color.money },
  note: { fontFamily: FONT_FAMILY, fontSize: 14, color: t.color.text }
});
