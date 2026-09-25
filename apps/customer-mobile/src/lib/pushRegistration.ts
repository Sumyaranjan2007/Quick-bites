import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// The api url lives in the app's session rather than in a module, so it is
// passed in rather than read.

/**
 * Tells the platform how to reach this phone.
 *
 * Order updates already reach the app while it is open, over the socket.
 * This is the other half, and for a customer it is most of the value: nobody
 * watches a food app for thirty minutes. They put the phone down, and the
 * whole point is being told when the rider is outside.
 *
 * EVERYTHING HERE FAILS QUIETLY, ON PURPOSE.
 *
 * A device token needs `google-services.json`, which needs a Firebase project.
 * Until the owner creates one, `getDevicePushTokenAsync` throws — and a
 * customer must not see an error about push infrastructure when they sign in to
 * order food. So this returns silently and the app works exactly as it does
 * today, over the socket. The moment the Firebase file is added to a build,
 * the same code starts registering with no other change.
 */

let lastRegistered: string | null = null;

export async function registerForPush(apiUrl: string, token: string): Promise<void> {
  try {
    const permission = await Notifications.getPermissionsAsync();
    let granted = permission.granted;

    if (!granted && permission.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    // Refused is a decision, not a failure. Asking again on every launch is
    // how an app gets its notifications switched off at the OS level.
    if (!granted) return;

    // U5: order updates get their own channel, so Android files them as
    // "Order updates" (heads-up, with sound) and not as "Miscellaneous". The
    // id matches CHANNEL.ORDER_UPDATES in the server's fcmDispatcher.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('order-updates', {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 150, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
      }).catch(() => undefined);
    }

    const device = await Notifications.getDevicePushTokenAsync();
    const value = String(device?.data || '');
    if (!value) return;

    // Registering is idempotent on the server, but skipping the request when
    // nothing has changed keeps a launch from making a needless round trip on
    // a customer's own mobile data.
    if (value === lastRegistered) return;

    const res = await fetch(`${apiUrl}/devices`, {
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
 * Stops this phone receiving order updates.
 *
 * Somebody who has signed out should not keep being told about orders on
 * an account they are no longer using - a shared phone, a borrowed one.
 */
export async function unregisterForPush(apiUrl: string, token: string): Promise<void> {
  try {
    if (!lastRegistered) return;
    await fetch(`${apiUrl}/devices/${encodeURIComponent(lastRegistered)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    lastRegistered = null;
  } catch {
    // Same reasoning. Sign-out must never fail because a network call did.
  }
}
