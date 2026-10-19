import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import { CheckCircle2, Circle } from 'lucide-react-native';
import { FONT_FAMILY, t } from '../theme';

const BATTERY_KEY = 'qb.rider.batteryAsked.v1';

type Item = { id: 'location' | 'notifications' | 'camera' | 'battery'; label: string; why: string; ok: boolean };

/**
 * Everything a rider's phone must allow to work properly (owner, 19 Oct 2026),
 * in one card on Home, each fixed with one tap: location (offers and the live
 * map), notifications (new offers ring), camera (document photos), and battery
 * saver off for Quick Bites (Android stops location in the background
 * otherwise). Hidden once all are done; re-checked when the app comes back.
 */
export const RiderPermissions: React.FC = () => {
  const [items, setItems] = useState<Item[] | null>(null);

  const check = useCallback(async () => {
    const [loc, notif, cam, battery] = await Promise.all([
      Location.getForegroundPermissionsAsync().then(p => p.status === 'granted').catch(() => false),
      Notifications.getPermissionsAsync().then(p => p.status === 'granted').catch(() => false),
      ImagePicker.getCameraPermissionsAsync().then(p => p.status === 'granted').catch(() => false),
      AsyncStorage.getItem(BATTERY_KEY).then(v => v === 'yes').catch(() => false)
    ]);
    setItems([
      { id: 'location', label: 'Location', why: 'To get nearby orders and show customers where their food is.', ok: loc },
      { id: 'notifications', label: 'Notifications', why: 'So a new order rings even when the app is closed.', ok: notif },
      { id: 'camera', label: 'Camera', why: 'To photograph your documents.', ok: cam },
      ...(Platform.OS === 'android'
        ? [{ id: 'battery' as const, label: 'Battery saver off for Quick Bites', why: 'Otherwise the phone stops your location while you ride.', ok: battery }]
        : [])
    ]);
  }, []);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', state => state === 'active' && void check());
    return () => sub.remove();
  }, [check]);

  const fix = async (item: Item) => {
    try {
      let granted = false;
      if (item.id === 'location') granted = (await Location.requestForegroundPermissionsAsync()).status === 'granted';
      if (item.id === 'notifications') granted = (await Notifications.requestPermissionsAsync()).status === 'granted';
      if (item.id === 'camera') granted = (await ImagePicker.requestCameraPermissionsAsync()).status === 'granted';
      if (item.id === 'battery') {
        await AsyncStorage.setItem(BATTERY_KEY, 'yes');
        await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings());
        granted = true;
      }
      // Refused for good: Android will not ask again, so the app's settings page is the way.
      if (!granted) await Linking.openSettings();
    } catch {
      await Linking.openSettings().catch(() => undefined);
    }
    void check();
  };

  if (!items || items.every(i => i.ok)) return null;
  return (
    <View style={s.card}>
      <Text style={s.title}>Set up your phone for deliveries</Text>
      {items.map(item => (
        <TouchableOpacity key={item.id} style={s.row} onPress={() => !item.ok && void fix(item)} disabled={item.ok} activeOpacity={0.8}>
          {item.ok ? <CheckCircle2 size={20} color={t.color.goText} /> : <Circle size={20} color={t.color.textMuted} />}
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{item.label}</Text>
            <Text style={s.why}>{item.why}</Text>
          </View>
          {!item.ok ? <Text style={s.allow}>Allow</Text> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
};

const s = StyleSheet.create({
  card: { backgroundColor: t.color.surface, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, padding: t.space[4], marginTop: t.space[3], gap: t.space[3] },
  title: { fontFamily: FONT_FAMILY, fontSize: 16, fontWeight: '800', color: t.color.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space[3] },
  label: { fontFamily: FONT_FAMILY, fontSize: 14, fontWeight: '700', color: t.color.text },
  why: { fontFamily: FONT_FAMILY, fontSize: 12, color: t.color.textMuted, marginTop: 2 },
  allow: { fontFamily: FONT_FAMILY, fontSize: 13, fontWeight: '800', color: t.color.brand }
});
