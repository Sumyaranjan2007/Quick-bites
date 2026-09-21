import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { currentApiUrl } from './partnerApi';

/**
 * Tells the platform how to reach this phone.
 *
 * The kitchen alert already works while the app is open — the shell rings on
 * `order:created` over the socket. This is the other half: an order that
 * arrives while the app is backgrounded, or while the phone is locked, which
 * on a propped-up kitchen phone is most of a shift.
 *
 * EVERYTHING HERE FAILS QUIETLY, ON PURPOSE.
 *
 * A device token needs `google-services.json`, which needs a Firebase project.
 * Until the owner creates one, `getDevicePushTokenAsync` throws — and a
 * partner must not see an error about push infrastructure when they sign in to
 * take orders. So this returns silently and the app works exactly as it does
 * today, over the socket. The moment the Firebase file is added to a build,
 * the same code starts registering with no other change.
 */

let lastRegistered: string | null = null;

export async function registerForPush(token: string): Promise<void> {
  try {
    const permission = await Notifications.getPermissionsAsync();
    let granted = permission.granted;

    if (!granted && permission.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    // Refused is a decision, not a failure. Asking again on every launch is
    // how an app gets its notifications switched off at the OS level.
    if (!granted) return;

    const device = await Notifications.getDevicePushTokenAsync();
    const value = String(device?.data || '');
    if (!value) return;

    // Registering is idempotent on the server, but skipping the request when
    // nothing has changed keeps a launch from making a needless round trip on
    // a kitchen's mobile data.
    if (value === lastRegistered) return;

    const res = await fetch(`${currentApiUrl()}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        token: value,
        platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        appVersion: '1.0.0'
      })
    });

    if (res.ok) lastRegistered = value;
  } catch {
    // Deliberately silent. See above: with no Firebase project this throws on
    // every launch, and it is not something a partner can act on.
  }
}

/**
 * Stops this phone receiving the restaurant's orders.
 *
 * A kitchen phone changes hands between shifts, so signing out has to actually
 * unregister rather than waiting for the token to fail on its own.
 */
export async function unregisterForPush(token: string): Promise<void> {
  try {
    if (!lastRegistered) return;
    await fetch(`${currentApiUrl()}/devices/${encodeURIComponent(lastRegistered)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    lastRegistered = null;
  } catch {
    // Same reasoning. Sign-out must never fail because a network call did.
  }
}
