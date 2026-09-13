/**
 * Handing a destination to whatever maps app the rider actually uses.
 *
 * `geo:` is Android's own intent for "navigate here" and lets the rider pick
 * their map once and keep it; iOS has no equivalent, so it gets Apple Maps
 * directions, and a browser URL is the last resort if neither opens.
 */
import { Alert, Linking, Platform } from 'react-native';

export interface Destination {
  latitude: number;
  longitude: number;
  label?: string;
}

export async function openDirections(destination: Destination | undefined, fallbackQuery?: string): Promise<void> {
  const label = destination?.label || fallbackQuery || 'Destination';

  const candidates: string[] = [];
  if (destination) {
    const { latitude, longitude } = destination;
    if (Platform.OS === 'android') {
      candidates.push(`google.navigation:q=${latitude},${longitude}&mode=d`);
      candidates.push(`geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodeURIComponent(label)})`);
    } else {
      candidates.push(`maps://?daddr=${latitude},${longitude}&dirflg=d`);
    }
    candidates.push(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`);
  } else if (fallbackQuery) {
    // No coordinates recorded for this stop — search the address text instead,
    // which is still better than leaving the rider to type it out themselves.
    candidates.push(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fallbackQuery)}`);
  }

  for (const url of candidates) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Try the next candidate.
    }
  }

  Alert.alert('No maps app', `Could not open a maps app for ${label}.`);
}

export async function callNumber(phone?: string): Promise<void> {
  if (!phone) {
    Alert.alert('No number', 'No phone number is on file for this contact.');
    return;
  }
  const url = `tel:${phone.replace(/[^\d+]/g, '')}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not place the call', phone);
  }
}
