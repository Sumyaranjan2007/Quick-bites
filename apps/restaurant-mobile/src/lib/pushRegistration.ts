import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';

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

export async function registerForPush(token: string): Promise<void> {
  latest = [token];
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
    // a kitchen's mobile data.
    if (value === lastRegistered && Date.now() - lastRegisteredAt < RESEND_MS) return;

    const res = await fetch(`${currentApiUrl()}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        token: value,
        platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        // The version and build actually installed: support sees who is out of date, and from build 48 the server
        // rings this phone on the alarm channel (round 7).
        appVersion: `${Constants.expoConfig?.version || 'unknown'} (${Constants.expoConfig?.android?.versionCode ?? '?'})`
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
 * Stops this phone receiving the restaurant's orders.
 *
 * A kitchen phone changes hands between shifts, so signing out has to actually
 * unregister rather than waiting for the token to fail on its own.
 */
export async function unregisterForPush(token: string): Promise<void> {
  try {
    latest = null;
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
