import { FONT_FAMILY } from '../theme';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Modal } from './Modal';
import { ShieldAlert, Store, MapPin } from 'lucide-react-native';
import { t } from '../theme';
import { Button } from './ui';
import { distance, rupees } from '../lib/format';
import { startOrderAlert, stopOrderAlert } from '../lib/orderAlert';
import type { Trip } from '../lib/api';

/**
 * Operations gave this rider a trip (owner, 20 Oct 2026): full screen, the order
 * sound ringing, and one way out — start it. Shown again on every open until the
 * rider does (`assignedByOperations` clears when they tap Start).
 */
export const AssignedTripModal: React.FC<{ trip: Trip | null; busy: boolean; onStart: (trip: Trip) => void }> = ({ trip, busy, onStart }) => {
  useEffect(() => {
    if (!trip) return;
    void startOrderAlert();
    return () => void stopOrderAlert();
  }, [trip?.id]);

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
              {trip.dropAddress} · {distance(trip.distanceKm)}
            </Text>
          </View>
          <Text style={s.pay}>
            You earn {rupees(trip.estimatedEarnings)}
            {trip.pickupPay ? ` (incl. ${rupees(trip.pickupPay)} pickup pay)` : ''}
          </Text>
          {trip.handoverNote ? <Text style={s.note}>Collect from the other rider: {trip.handoverNote}</Text> : null}
        </View>
        <Button label="Start trip" size="lg" loading={busy} onPress={() => onStart(trip)} />
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.color.bg, padding: t.space[6], justifyContent: 'center', gap: t.space[6] },
  header: { alignItems: 'center', gap: t.space[3] },
  title: { fontFamily: FONT_FAMILY, fontSize: 22, fontWeight: '800', color: t.color.text, textAlign: 'center' },
  sub: { fontFamily: FONT_FAMILY, fontSize: 15, color: t.color.danger, fontWeight: '700', textAlign: 'center' },
  card: { backgroundColor: t.color.surface, borderRadius: 16, padding: t.space[4], gap: t.space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
  rowText: { flex: 1, fontFamily: FONT_FAMILY, fontSize: 15, color: t.color.text },
  pay: { fontFamily: FONT_FAMILY, fontSize: 17, fontWeight: '800', color: t.color.money },
  note: { fontFamily: FONT_FAMILY, fontSize: 14, color: t.color.text }
});
