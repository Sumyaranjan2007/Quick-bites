import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Printer } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { openKitchenTicket } from '../lib/invoice';

const WIDTH_KEY = 'qb.partner.ticketWidth';

/**
 * Print the kitchen ticket (master plan B10): a clear button on every accepted
 * order, with what the ticket is for, and the printer's roll size chosen once
 * (80 mm or 58 mm) and remembered on this phone or browser.
 */
export const KitchenTicketButton: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [width, setWidth] = useState<80 | 58>(80);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(WIDTH_KEY)
      .then(v => {
        if (v === '58') setWidth(58);
      })
      .catch(() => undefined);
  }, []);

  const choose = (next: 80 | 58) => {
    setWidth(next);
    void AsyncStorage.setItem(WIDTH_KEY, String(next)).catch(() => undefined);
  };

  const print = async () => {
    setBusy(true);
    try {
      await openKitchenTicket(orderId, width);
    } catch (err: any) {
      Alert.alert('Ticket not printed', err?.message || 'The ticket could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <TouchableOpacity style={[styles.button, busy && { opacity: 0.6 }]} onPress={() => void print()} disabled={busy} activeOpacity={0.85}>
        <Printer size={18} color={c.brand} />
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{busy ? 'Preparing the ticket…' : 'Print kitchen ticket'}</Text>
          <Text style={styles.hint}>For your cooks: dishes, options and the pickup code. No prices.</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.sizes}>
        <Text style={styles.sizeLabel}>Printer roll</Text>
        {([80, 58] as const).map(w => (
          <TouchableOpacity key={w} style={[styles.size, width === w && styles.sizeOn]} onPress={() => choose(w)}>
            <Text style={[styles.sizeText, width === w && styles.sizeTextOn]}>{w} mm</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  box: { marginTop: spacing.md, gap: spacing.sm },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: c.brand,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    backgroundColor: c.brandSoft
  },
  label: { color: c.brand, fontWeight: '700', fontSize: 15 },
  hint: { color: c.textSoft, fontSize: 12, marginTop: 2 },
  sizes: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sizeLabel: { color: c.textMuted, fontSize: 12 },
  size: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  sizeOn: { borderColor: c.brand },
  sizeText: { color: c.textMuted, fontSize: 12 },
  sizeTextOn: { color: c.brand, fontWeight: '700' }
});
