import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';

/*
 * Notifications that work properly (owner, 19 Oct 2026): shown while the app is
 * open too, and a tap opens the screen it is about, also when the tap is what
 * started the app.
 */
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
  });
} catch {
  // A browser build has no notification handler; nothing to show there.
}

/** Calls `onTap` with the notification's data each time the person taps one. Waits for `ready` (signed in). */
export function useNotificationTaps(onTap: (data: Record<string, any>) => void, ready = true): void {
  const latest = useRef(onTap);
  latest.current = onTap;
  useEffect(() => {
    if (!ready) return;
    let seen = '';
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (id === seen) return;
      seen = id;
      latest.current((response.notification.request.content.data || {}) as Record<string, any>);
    };
    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
    let sub: { remove(): void } | null = null;
    try {
      sub = Notifications.addNotificationResponseReceivedListener(handle);
    } catch {
      // Not available in a browser.
    }
    return () => sub?.remove();
  }, [ready]);
}
