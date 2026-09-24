/**
 * The notification channels this console creates on Android.
 *
 * -------------------------------------------------------------------------
 * WITHOUT THIS FILE, EVERY ADMIN NOTIFICATION WAS GOING TO BE DROPPED
 * -------------------------------------------------------------------------
 * The app already registers a device push token and always has. What it has
 * never done is create a notification channel — and on Android 8 and above a
 * message naming a channel the app did not create is not downgraded to a quiet
 * notification, it is DISCARDED. Nothing appears, nothing is logged on the
 * phone, and the server's own record says the push was sent successfully.
 *
 * That is exactly the defect found in the partner app: the server addressed
 * `new_orders`, the rider app had created `new-orders`, the partner app had
 * created `kitchen-orders`, and the MAX-importance alarm built specifically to
 * wake a kitchen at 11pm had been addressed to a channel that existed on no
 * phone on earth. It looked like a delivery problem for weeks.
 *
 * -------------------------------------------------------------------------
 * TWO CHANNELS, AND THE SPLIT IS THE POINT
 * -------------------------------------------------------------------------
 * A rider pressing SOS and a partner uploading a licence are both things an
 * administrator should hear about, and they are not the same kind of thing. One
 * should ring at 3am; the other should be waiting in the morning.
 *
 * Separate channels put that choice where it belongs, which is with the person
 * holding the phone: Android lets them silence "Needs attention" without
 * silencing "Urgent", one switch each, in the system settings they already know.
 * A single channel forces them to choose between being woken by a menu change
 * and missing an emergency, and everybody makes the same choice — they mute it,
 * and then the SOS arrives into a muted app.
 *
 * This is also why we do NOT try to detect night here. We do not know an
 * administrator's hours, their timezone or whether they work nights, and a rule
 * we cannot verify would be worse than the operating system feature that
 * already works: `bypassDnd` on the urgent channel and DEFAULT importance on the
 * other lets their own Do Not Disturb do exactly the right thing.
 *
 * THE IDS MUST MATCH THE SERVER. `ADMIN_CHANNEL` in
 * `apps/backend-api/src/notifications/adminNotifier.ts` names these same two
 * strings, and a test reads THIS FILE rather than comparing the server's
 * constant with itself — which is the check that would have caught the three
 * spellings above.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/** An SOS or a failed payout. Rings, wakes the phone, bypasses Do Not Disturb. */
export const URGENT_CHANNEL = 'admin-urgent';

/** A queue with somebody waiting in it. Appears; does not wake anybody. */
export const ATTENTION_CHANNEL = 'admin-attention';

let configured = false;

/**
 * Creates both channels. Called once after sign-in.
 *
 * Idempotent on Android — creating a channel that exists updates its name and
 * leaves the user's own importance choice alone, which is the behaviour we want:
 * an administrator who has turned the urgent sound down keeps it down.
 *
 * Fails silently, like `registerForPush` next door and for the same reason: a
 * console that shows an error about notification infrastructure when somebody
 * signs in to do their job has made their day worse to no purpose.
 */
export async function prepareAdminChannels(): Promise<void> {
  if (configured) return;
  configured = true;

  if (Platform.OS !== 'android') return;

  try {
    await Notifications.setNotificationChannelAsync(URGENT_CHANNEL, {
      name: 'Urgent',
      description: 'A rider has raised an emergency, or money has failed to send.',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400, 200, 600],
      lightColor: '#D64545',
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      /*
       * The one channel on this platform that may interrupt Do Not Disturb.
       *
       * A rider pressing SOS is the only event where a delayed notification
       * costs something other than money, and an administrator who has silenced
       * their phone for the night has not consented to missing that.
       */
      bypassDnd: true
    });
  } catch {
    // No permission, or an OS that refuses. The console still works over the
    // socket while it is open, which is how it has always worked.
  }

  try {
    await Notifications.setNotificationChannelAsync(ATTENTION_CHANNEL, {
      name: 'Needs attention',
      description: 'Bank accounts, documents, refunds, tickets and other queues waiting on you.',
      /*
       * DEFAULT rather than HIGH: it appears in the shade and does not take over
       * the screen. A queue is not an interruption, and treating it as one is how
       * the whole category gets muted.
       */
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#F5A623',
      enableVibrate: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      bypassDnd: false
    });
  } catch {
    // As above.
  }
}
