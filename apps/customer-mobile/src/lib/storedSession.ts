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

const KEY = 'quickbites.customer.session.v1';

export interface StoredSession {
  token: string;
  user: any;
  apiUrl: string;
  savedAt: string;
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.apiUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: Omit<StoredSession, 'savedAt'>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...session, savedAt: new Date().toISOString() }));
  } catch {
    // This launch still works; the next one will ask for a password again.
  }
}

export async function clearStoredSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // The in-memory token is dropped by the caller regardless.
  }
}
