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

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    const isLastResort = i === candidates.length - 1;

    // `canOpenURL` is only a hint, and on Android 11+ a misleading one: it
    // answers false for any scheme the manifest has not declared in <queries>,
    // whether or not a handler is installed. Gating on it is what produced
    // "No maps app" on phones with Google Maps plainly working. A true answer
    // still saves a pointless throw, so it is consulted — but a false answer on
    // the final candidate is overruled rather than believed.
    const supported = await Linking.canOpenURL(url).catch(() => false);
    if (!supported && !isLastResort) continue;

    try {
      await Linking.openURL(url);
      return;
    } catch {
      // Genuinely unhandled. Fall through to the next candidate.
    }
  }

  Alert.alert(
    'Could not open a map',
    `No app on this phone offered to show ${label}. Install Google Maps, or open the address manually.`
  );
}

export async function callNumber(phone?: string): Promise<void> {
  if (!phone) {
    Alert.alert('No number', 'No phone number is on file for this contact.');
    return;
  }
  // Dialled without a `canOpenURL` gate for the same reason as above: every
  // phone has a dialler, and asking first is what made this fail on Android 11+.
  const url = `tel:${phone.replace(/[^\d+]/g, '')}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not place the call', phone);
  }
}
