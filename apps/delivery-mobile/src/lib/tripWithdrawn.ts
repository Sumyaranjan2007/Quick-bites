/**
 * "That trip is gone": another rider took it (R1).
 *
 * The server sends a data-only message, type RIDER_TRIP_WITHDRAWN, carrying the
 * order id; the offer it replaces was tagged `trip:<orderId>`. Without a
 * handler the alarm for a trip nobody can take any more kept ringing on every
 * other rider's phone. This clears it: the shade entry, the looping sound and
 * the offer card if it is the one on screen.
 *
 * Two paths, because the app may be open or not:
 *   - foreground: a received-notification listener (installed from App)
 *   - background / closed: a task registered with expo-notifications
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { stopOrderAlert } from './orderAlert';

export const TRIP_WITHDRAWN_TASK = 'quickbites-trip-withdrawn';

/** Pulls the order id out of whichever shape the message arrived in. */
export function withdrawnOrderId(payload: any): string | null {
  const candidates = [
    payload?.request?.content?.data,
    payload?.data?.data,
    payload?.data,
    payload?.notification?.data,
    payload
  ];
  for (const c of candidates) {
    let d = c;
    if (typeof d?.body === 'string') {
      try {
        d = { ...d, ...JSON.parse(d.body) };
      } catch {
        /* not JSON; read the fields as they are */
      }
    }
    if (d?.type === 'RIDER_TRIP_WITHDRAWN' && d?.orderId) return String(d.orderId);
  }
  return null;
}

/** Removes the offer's shade entry and stops the alarm. */
export async function clearWithdrawnTrip(orderId: string): Promise<void> {
  await stopOrderAlert().catch(() => undefined);
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const n of shown) {
      const data: any = n.request?.content?.data || {};
      const tag = (n.request as any)?.trigger?.remoteMessage?.notification?.tag;
      if (data.orderId === orderId || tag === `trip:${orderId}` || n.request?.identifier === `trip:${orderId}`) {
        await Notifications.dismissNotificationAsync(n.request.identifier);
      }
    }
  } catch {
    /* nothing shown, or the platform cannot list it: the in-app card is still cleared */
  }
}

TaskManager.defineTask(TRIP_WITHDRAWN_TASK, async ({ data }: any) => {
  const orderId = withdrawnOrderId(data);
  if (orderId) await clearWithdrawnTrip(orderId);
});

/** Registers the background path once; safe to call on every launch. */
export async function registerTripWithdrawnTask(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(TRIP_WITHDRAWN_TASK);
  } catch {
    /* unsupported here (Expo Go, web); the foreground listener still works */
  }
}
