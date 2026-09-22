import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Platform, Vibration } from 'react-native';
import { Audio } from 'expo-av';

/**
 * Order notifications: a bell with unread history, plus a sound.
 *
 * These are in-app notifications driven by the order socket the app is already
 * connected to, not push notifications. That distinction matters: push requires
 * a Firebase project and a server key, and would notify a phone whose app is
 * closed. This tells a customer who is holding the phone that their food moved,
 * which is the case that was silently missing.
 *
 * The sound is loaded once and replayed, because creating a Sound per event
 * leaks audio handles on Android and eventually stops playing at all.
 */
export interface AppNotification {
  id: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
}

interface NotificationsValue {
  notifications: AppNotification[];
  unreadCount: number;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  notify: (title: string, body: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

const NotificationsContext = createContext<NotificationsValue>({
  notifications: [],
  unreadCount: 0,
  enabled: true,
  setEnabled: () => {},
  notify: () => {},
  markAllRead: () => {},
  clear: () => {}
});

export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [enabled, setEnabled] = useState(true);
  const soundRef = useRef<Audio.Sound | null>(null);
  const loadingRef = useRef(false);

  const playChime = useCallback(async () => {
    try {
      if (!soundRef.current && !loadingRef.current) {
        loadingRef.current = true;
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: false, shouldDuckAndroid: true });
        const { sound } = await Audio.Sound.createAsync(require('../../assets/notification.wav'), {
          shouldPlay: false,
          volume: 0.85
        });
        soundRef.current = sound;
        loadingRef.current = false;
      }
      await soundRef.current?.replayAsync();
    } catch {
      // Audio is a courtesy, never a requirement: a phone with audio focus held
      // by something else should still get the banner and the vibration.
    }
  }, []);

  const notify = useCallback(
    (title: string, body: string) => {
      if (!enabled) return;
      setNotifications(prev => [
        {
          id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title,
          body,
          at: new Date().toISOString(),
          read: false
        },
        ...prev
      ].slice(0, 50));

      playChime();
      Vibration.vibrate(Platform.OS === 'android' ? 120 : 40);
    },
    [enabled, playChime]
  );

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => (n.read ? n : { ...n, read: true })));
  }, []);

  const clear = useCallback(() => setNotifications([]), []);

  const value = useMemo<NotificationsValue>(
    () => ({
      notifications,
      unreadCount: notifications.filter(n => !n.read).length,
      enabled,
      setEnabled,
      notify,
      markAllRead,
      clear
    }),
    [notifications, enabled, notify, markAllRead, clear]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export function useNotifications(): NotificationsValue {
  return useContext(NotificationsContext);
}

/** Wording for each status the customer can be told about. */
export const STATUS_NOTIFICATION: Record<string, { title: string; body: string }> = {
  ACCEPTED: { title: 'Order accepted', body: 'The restaurant has accepted your order.' },
  PREPARING: { title: 'Cooking started', body: 'Your food is being prepared now.' },
  READY_FOR_PICKUP: { title: 'Food is ready', body: 'Packed and waiting for a delivery partner.' },
  // NOT "picked up". A rider being assigned is a rider setting off towards
  // the restaurant - the food may still be cooking. Saying picked up here is
  // what made customers think their order was on its way while it was in the
  // pan, and it is the message the owner reported.
  RIDER_ASSIGNED: { title: 'Delivery partner assigned', body: 'A rider is on the way to collect your order.' },
  OUT_FOR_DELIVERY: { title: 'Out for delivery', body: 'Your order is on the way. Track it live.' },
  DELIVERED: { title: 'Delivered', body: 'Enjoy your meal. Tap to rate your order.' },
  CANCELLED: { title: 'Order cancelled', body: 'Your order was cancelled. Any payment is refunded.' }
};
