import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';

/**
 * "Phone permissions" (owner, 22 Oct 2026, round 6): every permission this app
 * relies on, its real state on the phone, and one button that fixes it. The same
 * file in all four apps; each passes its own list, colours and, where it has
 * one, its location module.
 *
 * Android and iPhone show their own "Allow?" window only while the app may still
 * ask. Once the person has blocked it, no app can bring that window back, so
 * this explains and opens the exact settings page instead (the notification
 * page, or the one muted channel).
 */
export type PermissionId = 'notifications' | 'location' | 'camera' | 'battery';
type State = 'ok' | 'ask' | 'blocked' | 'muted';
type Answer = { granted: boolean; canAskAgain?: boolean };
export interface PermissionColours {
  brand: string;
  text: string;
  muted: string;
  border: string;
  card: string;
  ok: string;
  danger: string;
}

const LABEL: Record<PermissionId, string> = {
  notifications: 'Notifications',
  location: 'Location',
  camera: 'Camera',
  battery: 'Battery saver off for Quick Bites'
};

const pkg = String(Constants.expoConfig?.android?.package || '');

/** The app's notification page (or one channel's), falling back to the app's settings. */
async function openNotificationSettings(channelId?: string): Promise<void> {
  if (Platform.OS !== 'android' || !pkg) return Linking.openSettings();
  const extras = [
    { key: 'android.provider.extra.APP_PACKAGE', value: pkg },
    ...(channelId ? [{ key: 'android.provider.extra.CHANNEL_ID', value: channelId }] : [])
  ];
  const action = channelId ? 'android.settings.CHANNEL_NOTIFICATION_SETTINGS' : 'android.settings.APP_NOTIFICATION_SETTINGS';
  await Linking.sendIntent(action, extras).catch(() => Linking.openSettings());
}

export const AppPermissions: React.FC<{
  items: PermissionId[];
  why: Partial<Record<PermissionId, string>>;
  /** Notification channels this app relies on; one switched off reads "Muted". */
  channels?: string[];
  /** A module-level constant (a new object each render would re-check for ever). */
  location?: { get: () => Promise<Answer>; request: () => Promise<Answer> };
  /** Where "battery saver asked" is remembered (the Rider app keeps its old key). */
  batteryKey?: string;
  colours: PermissionColours;
  font?: string;
  title?: string;
  /** On Home the card hides once all is well; in Profile it always shows, with ticks. */
  alwaysShow?: boolean;
  /** Called when notifications became allowed, so the app registers this phone for pushes. */
  onNotificationsAllowed?: () => void;
}> = ({ items, why, channels = [], location, batteryKey = 'qb.batteryAsked.v1', colours: c, font, title = 'Phone permissions', alwaysShow, onNotificationsAllowed }) => {
  const [states, setStates] = useState<Partial<Record<PermissionId, State>>>({});
  const [mutedChannel, setMutedChannel] = useState<string | undefined>();

  const check = useCallback(async () => {
    const of = (a: Answer | null): State => (!a ? 'ask' : a.granted ? 'ok' : a.canAskAgain === false ? 'blocked' : 'ask');
    const next: Partial<Record<PermissionId, State>> = {};
    for (const id of items) {
      try {
        if (id === 'notifications') {
          const answer = await Notifications.getPermissionsAsync();
          next.notifications = of(answer);
          if (answer.granted && Platform.OS === 'android') {
            for (const channel of channels) {
              const found = await Notifications.getNotificationChannelAsync(channel).catch(() => null);
              if (found && found.importance === Notifications.AndroidImportance.NONE) {
                next.notifications = 'muted';
                setMutedChannel(channel);
                break;
              }
            }
          }
        }
        if (id === 'location' && location) next.location = of(await location.get());
        if (id === 'camera') next.camera = of(await ImagePicker.getCameraPermissionsAsync());
        if (id === 'battery') next.battery = (await AsyncStorage.getItem(batteryKey)) === 'yes' ? 'ok' : 'ask';
      } catch {
        next[id] = 'ask';
      }
    }
    setStates(next);
  }, [items.join(','), channels.join(','), location, batteryKey]);

  useEffect(() => {
    void check();
    // Back from Settings: read the phone again, and register for pushes if they became allowed.
    const sub = AppState.addEventListener('change', state => state === 'active' && void check());
    return () => sub.remove();
  }, [check]);

  useEffect(() => {
    if (states.notifications === 'ok') onNotificationsAllowed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states.notifications]);

  const blockedHelp = (id: PermissionId) =>
    Alert.alert(
      `${LABEL[id]} is turned off`,
      id === 'notifications'
        ? 'The phone will not show its "Allow" window again because notifications were turned off for Quick Bites. Tap Open settings, then turn on notifications.'
        : `The phone will not ask again because it was turned off for Quick Bites. Tap Open settings, then allow ${LABEL[id].toLowerCase()}.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void (id === 'notifications' ? openNotificationSettings() : Linking.openSettings()) }
      ]
    );

  const fix = async (id: PermissionId) => {
    const state = states[id];
    try {
      if (id === 'notifications' && state === 'muted') {
        Alert.alert('Notifications are muted', 'One kind of Quick Bites notification is switched off on this phone. Tap Open settings and turn it on.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => void openNotificationSettings(mutedChannel) }
        ]);
        return;
      }
      if (id === 'battery') {
        await AsyncStorage.setItem(batteryKey, 'yes');
        await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings());
        return;
      }
      if (state === 'blocked') return blockedHelp(id);
      let answer: Answer | null = null;
      if (id === 'notifications') answer = await Notifications.requestPermissionsAsync();
      if (id === 'location' && location) answer = await location.request();
      if (id === 'camera') answer = await ImagePicker.requestCameraPermissionsAsync();
      // Refused for good just now: the phone will not ask again, so say where to turn it on.
      if (answer && !answer.granted && answer.canAskAgain === false) blockedHelp(id);
    } catch {
      await Linking.openSettings().catch(() => undefined);
    } finally {
      void check();
    }
  };

  if (Platform.OS === 'web') return null;
  const shown = items.filter(id => (id === 'location' ? Boolean(location) : id === 'battery' ? Platform.OS === 'android' : true));
  if (!alwaysShow && shown.every(id => states[id] === 'ok')) return null;
  const s = styles(c, font);
  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>
      {shown.map(id => {
        const state = states[id];
        const ok = state === 'ok';
        return (
          <TouchableOpacity key={id} style={s.row} onPress={() => !ok && void fix(id)} disabled={ok || !state} activeOpacity={0.8} accessibilityRole="button">
            <View style={[s.dot, { backgroundColor: ok ? c.ok : state === 'ask' ? c.border : c.danger }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{LABEL[id]}</Text>
              <Text style={s.why}>{why[id] || ''}</Text>
            </View>
            <Text style={[s.action, ok && { color: c.ok }]}>
              {!state ? '' : ok ? 'Allowed' : state === 'blocked' ? 'Open settings' : state === 'muted' ? 'Muted · fix' : 'Allow'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = (c: PermissionColours, font?: string) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 16, gap: 14 },
    title: { fontFamily: font, fontSize: 16, fontWeight: '800', color: c.text },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    dot: { width: 12, height: 12, borderRadius: 6 },
    label: { fontFamily: font, fontSize: 14, fontWeight: '700', color: c.text },
    why: { fontFamily: font, fontSize: 12, color: c.muted, marginTop: 2 },
    action: { fontFamily: font, fontSize: 13, fontWeight: '800', color: c.brand }
  });
