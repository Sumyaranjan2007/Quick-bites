import React, { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { MapPin, MapPinOff } from 'lucide-react-native';
import { t } from '../theme';

type Gps = 'checking' | 'on' | 'off' | 'denied';

/**
 * While on shift, whether the phone can actually send its position (master
 * plan #22): "GPS on", or what is wrong with one tap that fixes it: location
 * turned off (Android asks to switch it on) or permission refused (Settings).
 * Checked every 15 s; offers stop reaching a rider whose GPS is off.
 */
export const GpsChip: React.FC = () => {
  const [gps, setGps] = useState<Gps>('checking');

  const check = async () => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') return setGps('denied');
      setGps((await Location.hasServicesEnabledAsync()) ? 'on' : 'off');
    } catch {
      setGps('off');
    }
  };

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), 15_000);
    return () => clearInterval(timer);
  }, []);

  const fix = async () => {
    try {
      if (gps === 'denied') {
        const asked = await Location.requestForegroundPermissionsAsync();
        if (asked.status !== 'granted') await Linking.openSettings();
      } else if (Platform.OS === 'android') {
        await Location.enableNetworkProviderAsync();
      } else {
        await Linking.openSettings();
      }
    } catch {
      // The rider closed the system dialog; the next check says so.
    }
    void check();
  };

  if (gps === 'checking') return null;
  if (gps === 'on') {
    return (
      <View style={[styles.chip, styles.on]}>
        <MapPin size={14} color={t.color.goText} />
        <Text style={[styles.text, { color: t.color.goText }]}>GPS on · sending your location</Text>
      </View>
    );
  }
  return (
    <TouchableOpacity style={[styles.chip, styles.off]} onPress={() => void fix()} activeOpacity={0.85}>
      <MapPinOff size={14} color={t.color.danger} />
      <Text style={[styles.text, { color: t.color.danger, flex: 1 }]}>
        {gps === 'denied' ? 'Location permission is off: you will not get offers' : 'GPS is off: you will not get offers'}
      </Text>
      <Text style={[styles.text, styles.fixText]}>Turn on</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginTop: t.space[3] },
  on: { backgroundColor: t.color.goSoft, alignSelf: 'flex-start' },
  off: { backgroundColor: '#FDECEC' },
  text: { fontSize: 12, fontWeight: '600' },
  fixText: { color: t.color.brand, fontWeight: '800' }
});
