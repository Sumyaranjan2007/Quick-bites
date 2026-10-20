import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Modal } from './Modal';
import { KeyboardLift, Button, Chip } from './ui';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';
import type { PickedLocation } from './MapAddressPicker';

const c = tokens.colors;

/**
 * "Save this address" from the home screen's location (owner, 20 Oct 2026, item 10):
 * the spot just picked on the map or from GPS, plus what no map knows — the flat or
 * house — and a name: Home, Work, or the customer's own. The same request and the
 * same checks as the Address book (`POST /addresses`), so the server measures the
 * road distance to kitchens the same way for both.
 */
export const SaveAddressSheet: React.FC<{
  picked: PickedLocation | null;
  apiUrl?: string;
  token?: string;
  onClose: () => void;
  onSaved: (addressId: string) => void;
}> = ({ picked, apiUrl, token, onClose, onSaved }) => {
  const [house, setHouse] = useState('');
  const [landmark, setLandmark] = useState('');
  const [kind, setKind] = useState<'Home' | 'Work' | 'Other'>('Home');
  const [name, setName] = useState('');
  const [pincode, setPincode] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!picked) return;
    setHouse('');
    setLandmark('');
    setKind('Home');
    setName('');
    setPincode(picked.pincode || '');
    setCity(picked.city || '');
    setError(null);
  }, [picked]);

  const save = async () => {
    if (!picked || !apiUrl || !token) return;
    if (house.trim().length < 2) return setError('Enter your flat, house or building.');
    if (!/^[1-9][0-9]{5}$/.test(pincode.trim())) return setError('Enter a valid 6-digit PIN code.');
    if (!city.trim()) return setError('Enter the town or city.');
    if (kind === 'Other' && !name.trim()) return setError('Give this address a name, like "Mom\'s place".');
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`${apiUrl}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          label: kind === 'Other' ? name.trim().slice(0, 40) : kind,
          addressLine: [house.trim(), picked.addressLine].filter(Boolean).join(', '),
          landmark: landmark.trim() || undefined,
          city: city.trim(),
          pincode: pincode.trim(),
          coordinates: picked.coordinates
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error?.details?.[0]?.message || data?.error?.message || 'That address could not be saved.');
      }
      onSaved(data.data?.address?.id);
    } catch (err: any) {
      setError(err?.message || 'Could not reach Quick Bites. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={Boolean(picked)} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardLift>
        <View style={s.backdrop}>
          <ScrollView style={s.sheet} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>Save this address</Text>
            <Text style={s.where} numberOfLines={2}>
              {picked?.addressLine || 'The spot you chose'}
            </Text>

            <Text style={s.label}>Flat, house or building</Text>
            <TextInput style={s.input} value={house} onChangeText={v => {
                setHouse(v);
                setError(null);
              }} placeholder="Flat 302, Green Residency" placeholderTextColor={c.text.muted} autoFocus />
            <Text style={s.label}>Landmark (optional)</Text>
            <TextInput style={s.input} value={landmark} onChangeText={setLandmark} placeholder="Near the temple" placeholderTextColor={c.text.muted} />
            {!picked?.pincode && (
              <>
                <Text style={s.label}>PIN code</Text>
                <TextInput style={s.input} value={pincode} onChangeText={v => { setPincode(v); setError(null); }} keyboardType="number-pad" maxLength={6} placeholder="6 digits" placeholderTextColor={c.text.muted} />
              </>
            )}
            {!picked?.city && (
              <>
                <Text style={s.label}>Town or city</Text>
                <TextInput style={s.input} value={city} onChangeText={v => { setCity(v); setError(null); }} placeholder="Town or city" placeholderTextColor={c.text.muted} />
              </>
            )}

            <Text style={s.label}>Save as</Text>
            <View style={s.chips}>
              {(['Home', 'Work', 'Other'] as const).map(k => (
                <Chip key={k} label={k} active={kind === k} onPress={() => setKind(k)} />
              ))}
            </View>
            {kind === 'Other' && (
              <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Name it, e.g. Mom's place" placeholderTextColor={c.text.muted} maxLength={40} />
            )}

            {!!error && <Text style={s.error}>{error}</Text>}
            <Button label="Save address" onPress={save} loading={saving} full size="lg" />
            <Button label="Not now" onPress={onClose} variant="ghost" full style={{ marginTop: 8 }} />
          </ScrollView>
        </View>
      </KeyboardLift>
    </Modal>
  );
};

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { flexGrow: 0, maxHeight: '90%', backgroundColor: c.surface.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  title: { fontFamily: tokens.font.family, fontSize: 18, fontWeight: '800', color: c.text.primary },
  where: { fontFamily: tokens.font.family, fontSize: 13, color: c.text.secondary, marginTop: 4, marginBottom: 8 },
  label: { fontFamily: tokens.font.family, fontSize: 12, fontWeight: '700', color: c.text.secondary, marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 46,
    fontFamily: tokens.font.family,
    fontSize: 15,
    color: c.text.primary
  },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  error: { fontFamily: tokens.font.family, color: c.semantic.error, marginVertical: 8 }
});
