/**
 * Where this sign-in lives between launches.
 *
 * The app held its token in component state only, so closing it — or Android
 * reclaiming it in the background — returned the user to the login screen with
 * everything they were doing lost. Signing in again on every single launch is
 * not something a person tolerates from an app they use to buy dinner.
 *
 * The same shape the rider app has used since it hit this problem first. The
 * token, the account and the server address are written to device storage and
 * cleared deliberately on sign-out; every failure path is swallowed, because
 * being unable to remember a session is never a reason to refuse one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'quickbites.partner.session.v1';

export interface StoredSession {
  token: string;
  user: any;
  apiUrl: string;
  savedAt: string;
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      // Nothing stored. A first launch, a sign-out, or a reinstall — Android
      // wipes an app's storage when it is uninstalled, so re-sideloading a new
      // APK always lands here and that is not a fault.
      console.log('[session] nothing stored — signing in fresh');
      return null;
    }
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.apiUrl) {
      console.log('[session] stored record is unusable, ignoring it', {
        hasToken: Boolean(parsed?.token),
        hasApiUrl: Boolean(parsed?.apiUrl)
      });
      return null;
    }
    console.log('[session] restored', { savedAt: parsed.savedAt, apiUrl: parsed.apiUrl });
    return parsed;
  } catch (error) {
    // Said out loud rather than swallowed. This used to return null on any
    // failure with nothing written anywhere, so "it asks for my number every
    // time" was indistinguishable from "there was nothing to restore" — and a
    // storage module that is not linked in a release build fails exactly here,
    // silently, forever.
    console.warn('[session] could not be read', error);
    return null;
  }
}

export async function saveStoredSession(session: Omit<StoredSession, 'savedAt'>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...session, savedAt: new Date().toISOString() }));
    console.log('[session] saved');
  } catch (error) {
    // This launch still works; the next one will ask again. Logged because a
    // save that never happens is the cause of a complaint made a day later,
    // and nothing else records it.
    console.warn('[session] could not be saved — this sign-in will not survive a restart', error);
  }
}

export async function clearStoredSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // The in-memory token is dropped by the caller regardless.
  }
}
