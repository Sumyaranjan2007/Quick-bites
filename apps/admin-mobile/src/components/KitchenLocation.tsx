import { FONT_FAMILY, tokens } from '../theme/tokens';
import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card, Button, Field, KeyValue } from './ui';
import { useSession } from '../lib/session';

type Point = { latitude: number; longitude: number };

/**
 * "lat, lng" typed, or a Google Maps link pasted (".../@12.68,77.47,17z" or "?q=12.68,77.47").
 * Exported for the gate's check.
 */
export function pointFrom(text: string): Point | null {
  const m = text.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const point = { latitude: Number(m[1]), longitude: Number(m[2]) };
  return Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180 ? point : null;
}

/**
 * Where the kitchen really is, set by Operations (owner, 19 Oct 2026: "even the
 * exact location through maps"). Search the address, or drop a pin in Google
 * Maps and paste its link; "View on map" checks it. Works the same on the
 * /admin website, where an in-app map cannot run.
 */
export const KitchenLocation: React.FC<{ restaurantId: string; current?: Point | null; onSaved: () => void }> = ({
  restaurantId,
  current,
  onSaved
}) => {
  const { api } = useSession();
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ placeId: string; primary: string; secondary: string }>>([]);
  const [pasted, setPasted] = useState('');
  const [picked, setPicked] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  const find = async () => {
    if (!search.trim()) return;
    try {
      const data = await api.get<any>(`/places/suggest?q=${encodeURIComponent(search.trim())}`);
      setSuggestions(data?.suggestions || []);
      setSearched(true);
    } catch (err: any) {
      Alert.alert('Search failed', err?.message || 'Try again.');
    }
  };

  const choose = async (placeId: string) => {
    try {
      const data = await api.get<any>(`/places/resolve?placeId=${encodeURIComponent(placeId)}`);
      const place = data?.place;
      if (place) setPicked({ latitude: place.latitude, longitude: place.longitude });
      setSuggestions([]);
    } catch (err: any) {
      Alert.alert('Could not use that place', err?.message || 'Try another.');
    }
  };

  // The sign-up placeholder (central Bengaluru) is "not set", not a place (R2-13).
  const realCurrent = current && !(current.latitude === 12.9716 && current.longitude === 77.5946) ? current : null;
  const shown = picked || pointFrom(pasted) || realCurrent || null;
  const save = async () => {
    const point = picked || pointFrom(pasted);
    if (!point && /goo\.gl|maps\.app/i.test(pasted)) {
      return Alert.alert(
        'Short share links cannot be read',
        'Open the link in Google Maps, press and hold the pin, copy the numbers it shows (like 12.68123, 77.45012) and paste them here.'
      );
    }
    if (!point) return Alert.alert('No location yet', 'Search the address, or paste a Google Maps link or "latitude, longitude".');
    setBusy(true);
    try {
      await api.patch(`/admin/restaurants/${restaurantId}`, { coordinates: point, reason: 'Location set by Operations' });
      setPicked(null);
      setPasted('');
      onSaved();
      Alert.alert('Location saved', "Customers now see this kitchen's real distance and delivery time.");
    } catch (err: any) {
      Alert.alert('Not saved', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={s.heading}>Location</Text>
      <KeyValue label="On the map" value={shown ? `${shown.latitude.toFixed(5)}, ${shown.longitude.toFixed(5)}` : 'Not set'} />
      {shown ? (
        <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps?q=${shown.latitude},${shown.longitude}`)}>
          <Text style={s.link}>View on map</Text>
        </TouchableOpacity>
      ) : null}
      <Field label="Search the address" value={search} onChangeText={setSearch} />
      {suggestions.map(sg => (
        <TouchableOpacity key={sg.placeId} style={s.suggestion} onPress={() => void choose(sg.placeId)}>
          <Text style={s.primary}>{sg.primary}</Text>
          <Text style={s.secondary}>{sg.secondary}</Text>
        </TouchableOpacity>
      ))}
      {searched && suggestions.length === 0 ? (
        <Text style={s.secondary}>No places found. Try the area or road name, or paste a link or coordinates below.</Text>
      ) : null}
      <Button label="Search" variant="secondary" onPress={() => void find()} />
      <Field label="Or paste a Google Maps link / latitude, longitude" value={pasted} onChangeText={setPasted} autoCapitalize="none" />
      <Button label="Save location" onPress={() => void save()} loading={busy} />
    </Card>
  );
};

const s = StyleSheet.create({
  heading: { fontFamily: FONT_FAMILY, fontSize: 15, fontWeight: '800', color: tokens.colors.text.primary, marginBottom: 6 },
  link: { fontFamily: FONT_FAMILY, color: tokens.colors.brand.maroon, fontWeight: '700', marginVertical: 6 },
  suggestion: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.colors.border.subtle },
  primary: { fontFamily: FONT_FAMILY, fontWeight: '700', color: tokens.colors.text.primary },
  secondary: { fontFamily: FONT_FAMILY, fontSize: 12, color: tokens.colors.text.muted }
});
