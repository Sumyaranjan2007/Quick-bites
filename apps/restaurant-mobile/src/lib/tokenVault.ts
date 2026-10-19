/**
 * The sign-in token in the phone's keystore (security pass, Stage F): Android
 * Keystore / iOS Keychain through expo-secure-store, not plain app storage that
 * a backup or a rooted phone can read. Only the token goes here (the store is
 * meant for small values); the rest of the session stays in AsyncStorage.
 *
 * The browser build (/partner, /admin) has no keystore: there the token stays in
 * the session record as before. A token saved by an older version in plain
 * storage is moved here the first time it is read, so nobody is signed out.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SECURE = Platform.OS !== 'web';

export async function readToken(key: string, plain?: string): Promise<string | undefined> {
  if (!SECURE) return plain;
  return (await SecureStore.getItemAsync(key).catch(() => null)) || plain;
}

/** Saves the token; returns what the plain session record may still hold (nothing on a phone). */
export async function writeToken(key: string, token: string): Promise<string | undefined> {
  if (!SECURE) return token;
  try {
    await SecureStore.setItemAsync(key, token);
    return undefined;
  } catch (error) {
    // A keystore that refuses (some phones after a restore) must not sign the person out every launch.
    console.warn('[session] keystore unavailable, token kept in app storage', error);
    return token;
  }
}

export async function forgetToken(key: string): Promise<void> {
  if (SECURE) await SecureStore.deleteItemAsync(key).catch(() => undefined);
}
