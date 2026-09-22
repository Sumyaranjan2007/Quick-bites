import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert
} from 'react-native';
import { ArrowLeft, MapPin, Plus, Pencil, Trash2, Navigation, Check, Map as MapIcon } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { Card, EmptyState } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';
import { useDeviceLocation } from '../lib/useDeviceLocation';
import { AddressSearchField, type ResolvedPlace } from '../components/AddressSearchField';
import { MapAddressPicker, type PickedLocation } from '../components/MapAddressPicker';

const c = tokens.colors;

interface Props {
  onBack: () => void;
  apiUrl?: string;
  token?: string;
}

interface Address {
  id: string;
  label: string;
  addressLine: string;
  landmark?: string;
  city: string;
  pincode: string;
  isDefault?: boolean;
  coordinates?: { latitude: number; longitude: number };
}

const EMPTY_FORM = { label: 'Home', addressLine: '', landmark: '', city: 'Bengaluru', pincode: '' };

/**
 * Saved delivery addresses: add, edit, delete, and choose a default.
 *
 * The profile listed "Saved addresses" as a row with no action on it, so an
 * address could be created once during a checkout and then never corrected — a
 * typo in a flat number was permanent, and a customer who had moved had no way
 * to say so. The server has supported the full set of operations all along;
 * nothing in the app had ever called them.
 */
export const AddressBookScreen: React.FC<Props> = ({ onBack, apiUrl, token }) => {
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const { detect, detecting, error: locationError, clearError } = useDeviceLocation();

  const load = useCallback(async () => {
    if (!apiUrl || !token) return;
    try {
      const res = await apiFetch(`${apiUrl}/addresses`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error('Your addresses could not be loaded.');
      setAddresses(Array.isArray(data.data?.addresses) ? data.data.addresses : []);
      setError(null);
    } catch (err: any) {
      setAddresses([]);
      setError(err?.message || 'Your addresses could not be loaded.');
    }
  }, [apiUrl, token]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setCoordinates(null);
    setFormError(null);
    clearError();
    setSheetOpen(true);
  };

  const openEdit = (address: Address) => {
    setEditingId(address.id);
    setForm({
      label: address.label || 'Home',
      addressLine: address.addressLine || '',
      landmark: address.landmark || '',
      city: address.city || '',
      pincode: address.pincode || ''
    });
    setCoordinates(address.coordinates || null);
    setFormError(null);
    clearError();
    setSheetOpen(true);
  };

  /**
   * "Use my current location" - which now OPENS THE MAP on the fix it got.
   *
   * It used to take the GPS reading, reverse-geocode it, fill in a city and a
   * pincode and stop. The customer was shown no map and given no way to tell
   * whether the point was right. Reported by the owner as exactly that: it
   * shows no real map, it just guesses a pincode.
   *
   * A phone's first fix is routinely a hundred metres out and indoors it can
   * be a different building, so "here" is a starting point, never an answer.
   * The map that opens is the same component the "Choose on map" button uses -
   * one picker, one set of behaviours - centred on the fix so the common case
   * is a glance and a confirm rather than a search.
   *
   * `addressLine` is left alone, matching `useMapPoint` and the search path.
   * It used to be overwritten with the geocoded street, which deleted a flat
   * or house number the customer had already typed - the one part of an
   * address a rider needs while standing outside the building. The comment on
   * `useMapPoint` warned that these two disagreeing would lose a customer's
   * flat number depending on which control they happened to press. They did
   * disagree.
   */
  const useCurrentLocation = async () => {
    const place = await detect();
    if (!place) return;
    setCoordinates(place.coordinates);
    setForm(prev => ({
      ...prev,
      addressLine: prev.addressLine.trim() ? prev.addressLine : place.addressLine || '',
      city: place.city || prev.city,
      pincode: place.pincode || prev.pincode
    }));
    // Opened after the state above, so the picker starts on the detected point
    // rather than on the previous pin or on the Bengaluru fallback.
    setMapOpen(true);
  };

  /**
   * A point chosen on the map.
   *
   * Same contract as search and as "use my current location": it sets the
   * coordinates and offers a street address, and it never touches the flat or
   * house number. No map knows which door is yours, and overwriting what has
   * already been typed with a street name would delete the only part of the
   * address a rider needs when they are standing outside the building.
   */
  const useMapPoint = (picked: PickedLocation) => {
    setCoordinates(picked.coordinates);
    setForm(prev => ({
      ...prev,
      // Only fills an EMPTY field. `addressLine` is where the flat or house
      // number is typed, and a geocoded street address would overwrite it —
      // deleting the one part of the address a rider needs at the door, in
      // exchange for a street name they can already see on the map.
      //
      // Same rule as picking from search, a few lines below. Getting these two
      // to disagree would mean a customer losing their flat number depending on
      // which control they happened to use.
      addressLine: prev.addressLine.trim() ? prev.addressLine : picked.addressLine,
      city: picked.city || prev.city,
      pincode: picked.pincode || prev.pincode
    }));
    setMapOpen(false);
  };

  /**
   * A place chosen from search fills the form and pins the coordinates in one
   * step. The house or flat number is deliberately left for the customer: no
   * map knows it, and overwriting what they already typed with a street name
   * would lose the only part a rider actually needs at the door.
   */
  const usePickedPlace = (place: ResolvedPlace) => {
    setCoordinates({ latitude: place.latitude, longitude: place.longitude });
    setForm(prev => ({
      ...prev,
      addressLine: prev.addressLine.trim() ? prev.addressLine : place.formattedAddress,
      city: place.locality || prev.city,
      pincode: place.postalCode || prev.pincode
    }));
    setFormError(null);
  };

  const save = async () => {
    if (!apiUrl || !token) return;
    // Checked here as well as on the server so the customer is told what is
    // wrong before a round trip, in the same words the server would use.
    if (form.addressLine.trim().length < 5) {
      setFormError('Enter the flat, house or building — at least a few characters.');
      return;
    }
    if (!/^[1-9][0-9]{5}$/.test(form.pincode.trim())) {
      setFormError('Enter a valid 6-digit PIN code.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        label: form.label.trim() || 'Home',
        addressLine: form.addressLine.trim(),
        landmark: form.landmark.trim() || undefined,
        city: form.city.trim(),
        pincode: form.pincode.trim(),
        ...(coordinates ? { coordinates } : {})
      };
      const res = await apiFetch(
        editingId ? `${apiUrl}/addresses/${editingId}` : `${apiUrl}/addresses`,
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body)
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(
          data?.error?.details?.[0]?.message || data?.error?.message || 'That address could not be saved.'
        );
      }
      setSheetOpen(false);
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'That address could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const makeDefault = async (address: Address) => {
    if (!apiUrl || !token || address.isDefault) return;
    try {
      await apiFetch(`${apiUrl}/addresses/${address.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isDefault: true })
      });
      await load();
    } catch {
      setError('That address could not be set as your default.');
    }
  };

  const remove = (address: Address) => {
    Alert.alert(
      'Delete this address?',
      `${address.label} · ${address.addressLine}`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!apiUrl || !token) return;
            try {
              const res = await apiFetch(`${apiUrl}/addresses/${address.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
              });
              if (!res.ok) throw new Error();
              await load();
            } catch {
              setError('That address could not be deleted.');
            }
          }
        }
      ]
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <ArrowLeft size={22} color={c.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved addresses</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {!!error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.addButton} onPress={openNew} activeOpacity={0.85}>
          <Plus size={18} color={c.primary[500]} />
          <Text style={styles.addButtonText}>Add a new address</Text>
        </TouchableOpacity>

        {addresses === null ? (
          <ActivityIndicator color={c.primary[500]} style={{ marginTop: 24 }} />
        ) : addresses.length === 0 ? (
          <Card>
            <EmptyState
              title="No addresses yet"
              subtitle="Add where you would like your food delivered. You can save as many as you need."
            />
          </Card>
        ) : (
          addresses.map(address => (
            <Card key={address.id} style={styles.addressCard}>
              <View style={styles.addressTop}>
                <View style={styles.addressIcon}>
                  <MapPin size={15} color={c.primary[500]} />
                </View>
                <View style={styles.addressText}>
                  <View style={styles.labelRow}>
                    <Text style={styles.addressLabel}>{address.label}</Text>
                    {address.isDefault ? (
                      <View style={styles.defaultTag}>
                        <Text style={styles.defaultTagText}>DEFAULT</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.addressLine}>
                    {[address.addressLine, address.landmark, address.city, address.pincode]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                  {!address.coordinates && (
                    <Text style={styles.noPin}>
                      No map pin saved — your rider will have the address text only.
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.addressActions}>
                {!address.isDefault && (
                  <TouchableOpacity style={styles.action} onPress={() => makeDefault(address)}>
                    <Check size={14} color={c.text.secondary} />
                    <Text style={styles.actionText}>Set default</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.action} onPress={() => openEdit(address)}>
                  <Pencil size={14} color={c.text.secondary} />
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.action} onPress={() => remove(address)}>
                  <Trash2 size={14} color={c.semantic.error} />
                  <Text style={[styles.actionText, { color: c.semantic.error }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
              <Text style={styles.sheetTitle}>{editingId ? 'Edit address' : 'Add a delivery address'}</Text>

              <AddressSearchField apiUrl={apiUrl} token={token} near={coordinates} onPick={usePickedPlace} />

              <TouchableOpacity
                style={styles.mapButton}
                onPress={() => setMapOpen(true)}
                activeOpacity={0.85}
              >
                <MapIcon size={15} color={c.text.inverse} />
                <Text style={styles.mapButtonText}>
                  {coordinates ? 'Adjust the pin on the map' : 'Choose on map'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.locateButton, coordinates && styles.locateButtonDone]}
                onPress={useCurrentLocation}
                disabled={detecting}
                activeOpacity={0.85}
              >
                {detecting ? (
                  <ActivityIndicator size="small" color={c.dietary.veg} />
                ) : (
                  <Navigation size={15} color={coordinates ? c.dietary.veg : c.primary[500]} />
                )}
                <Text style={[styles.locateText, coordinates && { color: c.dietary.veg }]}>
                  {detecting
                    ? 'Finding you…'
                    : coordinates
                      ? 'Location pinned · tap to update'
                      : 'Use my current location'}
                </Text>
              </TouchableOpacity>

              {!!locationError && <Text style={styles.formError}>{locationError}</Text>}

              <View style={styles.labelChips}>
                {['Home', 'Work', 'Other'].map(label => (
                  <TouchableOpacity
                    key={label}
                    style={[styles.labelChip, form.label === label && styles.labelChipOn]}
                    onPress={() => setForm(f => ({ ...f, label }))}
                  >
                    <Text style={[styles.labelChipText, form.label === label && styles.labelChipTextOn]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={styles.input}
                value={form.addressLine}
                onChangeText={v => setForm(f => ({ ...f, addressLine: v }))}
                placeholder="Flat / House, street"
                placeholderTextColor={c.text.muted}
              />
              <TextInput
                style={styles.input}
                value={form.landmark}
                onChangeText={v => setForm(f => ({ ...f, landmark: v }))}
                placeholder="Landmark (optional)"
                placeholderTextColor={c.text.muted}
              />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={form.city}
                  onChangeText={v => setForm(f => ({ ...f, city: v }))}
                  placeholder="City"
                  placeholderTextColor={c.text.muted}
                />
                <TextInput
                  style={[styles.input, { width: 128 }]}
                  value={form.pincode}
                  onChangeText={v => setForm(f => ({ ...f, pincode: v.replace(/[^0-9]/g, '').slice(0, 6) }))}
                  placeholder="PIN code"
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholderTextColor={c.text.muted}
                />
              </View>

              {!!formError && <Text style={styles.formError}>{formError}</Text>}

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                <TouchableOpacity
                  style={[styles.sheetButton, styles.sheetCancel]}
                  onPress={() => setSheetOpen(false)}
                >
                  <Text style={styles.sheetCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sheetButton, styles.sheetSave]}
                  onPress={save}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.sheetSaveText}>{editingId ? 'Save changes' : 'Save address'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Mounted after the form sheet, not before it. On Android every Modal is
          its own window and they stack in mount order, so a picker declared
          above the sheet opens behind it — visible only as the sheet dimming. */}
      <MapAddressPicker
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        onConfirm={useMapPoint}
        initial={coordinates}
        apiUrl={apiUrl}
        token={token}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: c.surface.card,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: c.text.primary },
  body: { padding: 20, gap: 14, paddingBottom: 48 },
  error: { color: c.semantic.error, fontSize: 13, lineHeight: 19 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: c.primary[500],
    borderStyle: 'dashed',
    backgroundColor: c.surface.subtle
  },
  addButtonText: { color: c.primary[500], fontWeight: '800', fontSize: 14 },
  addressCard: { gap: 12 },
  addressTop: { flexDirection: 'row', gap: 12 },
  addressIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: c.primary[50],
    alignItems: 'center',
    justifyContent: 'center'
  },
  addressText: { flex: 1, gap: 3 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addressLabel: { fontSize: 14, fontWeight: '800', color: c.text.primary },
  defaultTag: { backgroundColor: c.dietary.vegBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  defaultTagText: { fontSize: 9, fontWeight: '800', color: c.dietary.veg, letterSpacing: 0.4 },
  addressLine: { fontSize: 12, color: c.text.secondary, lineHeight: 18 },
  noPin: { fontSize: 11, color: c.semantic.warning, marginTop: 2 },
  addressActions: {
    flexDirection: 'row',
    gap: 18,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    paddingTop: 10,
    flexWrap: 'wrap'
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { fontSize: 12, color: c.text.secondary, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%'
  },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: c.text.primary },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.primary[500],
    borderRadius: 12,
    paddingVertical: 13
  },
  mapButtonText: { color: c.text.inverse, fontSize: 14, fontWeight: '700' },
  locateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.primary[500],
    backgroundColor: c.primary[50]
  },
  locateButtonDone: { borderColor: c.dietary.veg, backgroundColor: c.dietary.vegBg },
  locateText: { color: c.primary[500], fontWeight: '700', fontSize: 13 },
  labelChips: { flexDirection: 'row', gap: 8 },
  labelChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border.medium
  },
  labelChipOn: { backgroundColor: c.primary[500], borderColor: c.primary[500] },
  labelChipText: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  labelChipTextOn: { color: '#FFFFFF' },
  input: {
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: c.text.primary,
    backgroundColor: c.surface.subtle
  },
  formError: { color: c.semantic.error, fontSize: 12, lineHeight: 18 },
  sheetButton: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetCancel: { backgroundColor: c.surface.sunken },
  sheetCancelText: { color: c.text.secondary, fontWeight: '800', fontSize: 14 },
  sheetSave: { backgroundColor: c.primary[500] },
  sheetSaveText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 }
});
