import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MapPin } from 'lucide-react-native';
import { Modal } from './Modal';
import { Button } from './ui';
import { t } from '../theme';

const KEY = 'qb.rider.locationConsent.v1';

/** Whether this phone's rider has read and accepted how location is used (master plan #22). */
export async function hasLocationConsent(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'yes';
  } catch {
    return false;
  }
}

/**
 * Shown before the first "Go online" (owner #22, Google Play's prominent
 * disclosure): what is collected, when, why, and when it stops, in plain words,
 * before the system asks for the permission.
 */
export const LocationConsent: React.FC<{ visible: boolean; onAgree: () => void; onCancel: () => void }> = ({ visible, onAgree, onCancel }) => (
  <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.icon}>
        <MapPin size={34} color={t.color.brand} />
      </View>
      <Text style={s.title}>Your location while you are online</Text>
      <Text style={s.body}>
        Quick Bites uses your location while you are online, also when the app is in the background or the screen is
        off, to offer you nearby orders and to show customers where their food is.
      </Text>
      <Text style={s.body}>It stops when you go offline. You see a notification the whole time it is on.</Text>
      <Text style={s.body}>
        Next, your phone asks for location access. Choose “While using the app”.
      </Text>
      <Button
        label="I agree, go online"
        onPress={() => {
          void AsyncStorage.setItem(KEY, 'yes').catch(() => undefined);
          onAgree();
        }}
        style={{ marginTop: t.space[5] }}
      />
      <Button label="Not now" variant="ghost" onPress={onCancel} style={{ marginTop: t.space[3] }} />
    </ScrollView>
  </Modal>
);

const s = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: t.space[6], backgroundColor: t.color.bg },
  icon: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: t.color.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.space[5]
  },
  title: { fontSize: 22, fontWeight: '800', color: t.color.text, textAlign: 'center', marginBottom: t.space[4] },
  body: { fontSize: 15, lineHeight: 22, color: t.color.text, marginBottom: t.space[3] }
});
