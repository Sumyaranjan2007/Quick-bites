/**
 * Where the rider's sign-in lives between launches.
 *
 * The app used to hold the token in component state only, so closing it — or
 * Android reclaiming it while the rider was navigating — dropped them back at
 * the login screen mid-shift. The token, the server address and the rider's id
 * are written to device storage instead, and cleared deliberately on sign-out.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'quickbites.rider.session.v1';

export interface RiderSession {
  token: string;
  userId: string;
  email: string;
  apiUrl: string;
  savedAt: string;
}

export async function loadSession(): Promise<RiderSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RiderSession;
    if (!parsed?.token || !parsed?.apiUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSession(session: Omit<RiderSession, 'savedAt'>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...session, savedAt: new Date().toISOString() }));
  } catch {
    // A rider who cannot persist their session can still work through this
    // launch; failing the sign-in over it would be worse.
  }
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do — the in-memory token is dropped by the caller
    // regardless, so the rider is signed out of this session either way.
  }
}

/** Small key/value cache for content that should survive going out of signal. */
export async function cacheJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(`quickbites.rider.cache.${key}`, JSON.stringify(value));
  } catch {
    /* caching is best-effort */
  }
}

export async function readCachedJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`quickbites.rider.cache.${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
