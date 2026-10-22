import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';

// The rider app carries its api url in the session rather than in a module,
// so it is passed in rather than read.

/**
 * Tells the platform how to reach this phone.
 *
 * Delivery offers already reach the app while it is open, over the socket.
 * This is the other half, and for a rider it is the important one: a rider
 * is riding, with the phone in a mount or a pocket and the screen off, which
 * is exactly when an offer they cannot see expires.
 *
 * EVERYTHING HERE FAILS QUIETLY, ON PURPOSE.
 *
 * A device token needs `google-services.json`, which needs a Firebase project.
 * Until the owner creates one, `getDevicePushTokenAsync` throws — and a
 * rider must not see an error about push infrastructure when they sign in to
 * start a shift. So this returns silently and the app works exactly as it does
 * today, over the socket. The moment the Firebase file is added to a build,
 * the same code starts registering with no other change.
 */

let lastRegistered: string | null = null;
let lastRegisteredAt = 0;
/*
 * Registered again when the app comes back to the front (round 6): a person who
 * allowed notifications in Settings is reachable at once, not after a restart,
 * and a token the server marked dead is sent again within 12 hours.
 */
let latest: Parameters<typeof registerForPush> | null = null;
let listening = false;
const RESEND_MS = 12 * 3_600_000;
let askedThisRun = false;

export async function registerForPush(apiUrl: string, token: string): Promise<void> {
  latest = [apiUrl, token];
  if (!listening) {
    listening = true;
    AppState.addEventListener('change', state => {
      if (state === 'active' && latest) void registerForPush(...latest);
    });
  }
  try {
    const permission = await Notifications.getPermissionsAsync();
    let granted = permission.granted;

    // Asked once per app start: coming back to the front never pops the window again.
    if (!granted && permission.canAskAgain && !askedThisRun) {
      askedThisRun = true;
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
    // a rider's own mobile data.
    if (value === lastRegistered && Date.now() - lastRegisteredAt < RESEND_MS) return;

    const res = await fetch(`${apiUrl}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        token: value,
        platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        // The version actually installed, so support can see who is out of date.
        appVersion: Constants.expoConfig?.version || 'unknown'
      })
    });

    if (res.ok) {
      lastRegistered = value;
      lastRegisteredAt = Date.now();
    }
  } catch {
    // Deliberately silent. See above: with no Firebase project this throws on
    // every launch, and it is not something a partner can act on.
  }
}

/**
 * Stops this phone receiving delivery offers.
 *
 * A rider who has signed out has finished for the day. Offers arriving after
 * that are both useless to them and lost to whoever would have taken them.
 */
export async function unregisterForPush(apiUrl: string, token: string): Promise<void> {
  try {
    latest = null;
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
