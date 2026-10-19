import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { io, type Socket } from 'socket.io-client';

/**
 * Real time for every screen (round 3, item 1). The server sends `sync` to an
 * account whenever something it can see changes; every screen that loads data
 * calls `useLiveSync(load)` and reloads quietly. Also on reconnect and when the
 * app comes back to the front, because sockets die in the background.
 * The same file in all four apps.
 *
 * seniordev: its own socket beside the per-screen ones (order, chat); merge them
 * into this one if connections per device ever matter.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let socket: Socket | null = null;
let current = '';

export function notifyLiveSync(): void {
  listeners.forEach(listener => listener());
}

/** Called by the app root whenever the signed-in session changes; no token stops it. */
export function startLiveSync(apiUrl: string | undefined, token: string | null | undefined): void {
  const key = apiUrl && token ? `${apiUrl}|${token}` : '';
  if (key === current) return;
  current = key;
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  if (!apiUrl || !token) return;
  socket = io(apiUrl.replace(/\/api(\/v1)?\/?$/, ''), {
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });
  let first = true;
  socket.on('connect', () => {
    if (!first) notifyLiveSync(); // missed events while away
    first = false;
  });
  socket.on('sync', notifyLiveSync);
}

AppState.addEventListener('change', state => {
  if (state === 'active') notifyLiveSync();
});
// A push that lands while the app is open means something changed (covers networks that block sockets).
if (Platform.OS !== 'web') Notifications.addNotificationReceivedListener(() => notifyLiveSync());

/** Reload this screen's data whenever the server says something changed (bursts coalesced). */
export function useLiveSync(reload: () => unknown): void {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A burst of changes (a busy Operations console hears every write) is one reload.
    const listener = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void latest.current();
      }, 600);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      clearTimeout(timer);
    };
  }, []);
}
