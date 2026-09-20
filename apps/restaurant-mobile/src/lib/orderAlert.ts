/**
 * Telling the kitchen an order has arrived.
 *
 * A ticket appearing silently on a phone propped by the pass is a ticket nobody
 * cooks. An order now arrives as a chime that keeps ringing until someone deals
 * with it, a vibration, and — when the app is not in front — an Android
 * notification carrying the same sound, so it is heard from the shade.
 *
 * Adapted from the rider app's version so both alerts behave the same way; the
 * kitchen rings longer, because a phone on a counter is noticed less quickly than
 * one in a pocket.
 *
 * TWO THINGS MADE THIS SILENT IN PRACTICE, and neither was visible from the code
 * in this file:
 *
 *   1. The channel below asks Android for a sound called `new_order.wav`. The
 *      partner app never packaged one. `expo-notifications` copies the files
 *      named in its `sounds` option into res/raw, and the partner app did not
 *      configure that plugin at all — the rider app did. The .wav sat in
 *      assets/, where the notification system cannot see it, and Android quietly
 *      fell back to whatever the default channel sound was.
 *
 *   2. NOTHING CALLED THE ALERT UNLESS THE ORDERS TAB WAS OPEN. The detection
 *      lived inside LiveOrdersScreen, which is mounted only while that tab is
 *      selected — so a kitchen phone resting on the dashboard, which is the
 *      default tab and where a propped-up phone naturally sits, rang for
 *      nothing. Worse, the set of already-seen orders was component state, so
 *      leaving the tab and coming back re-established a baseline and orders that
 *      arrived in between could never ring.
 *
 * Which orders have already rung is therefore kept HERE, at module scope: it
 * outlives every screen, and it lets the socket and the polling fallback both
 * report an order without it ringing twice.
 */
import { Platform, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';

const NEW_ORDER_CHANNEL = 'kitchen-orders';

/** Rings until acknowledged rather than once and gone. */
const MAX_LOOPS = 10;
const VIBRATION_PATTERN = [0, 450, 250, 450, 250, 700];

let sound: Audio.Sound | null = null;
let loopCount = 0;
let configured = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

/** Prepares audio and the notification channel. Called once after sign-in. */
export async function prepareOrderAlerts(): Promise<void> {
  if (configured) return;
  configured = true;

  try {
    await Audio.setAudioModeAsync({
      // An order alert that respects the silent switch is an order the kitchen misses.
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      allowsRecordingIOS: false
    });
  } catch {
    // Audio is a nicety; the vibration and the on-screen ticket still fire.
  }

  try {
    await Notifications.requestPermissionsAsync();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(NEW_ORDER_CHANNEL, {
        name: 'New orders',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'new_order.wav',
        vibrationPattern: VIBRATION_PATTERN,
        lightColor: '#F5A623',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
        bypassDnd: false
      });
    }
  } catch {
    // Without notification permission the in-app alert still works.
  }
}

async function loadSound(): Promise<Audio.Sound | null> {
  if (sound) return sound;
  try {
    const { sound: created } = await Audio.Sound.createAsync(require('../../assets/new-order.mp3'));
    created.setOnPlaybackStatusUpdate(status => {
      if (!status.isLoaded) return;
      if (status.didJustFinish && loopCount > 0) {
        loopCount -= 1;
        created.replayAsync().catch(() => {});
      }
    });
    sound = created;
    return created;
  } catch {
    return null;
  }
}

/** Starts the alert. Safe to call when one is already ringing. */
export async function startOrderAlert(): Promise<void> {
  Vibration.vibrate(VIBRATION_PATTERN, true);
  loopCount = MAX_LOOPS;
  const player = await loadSound();
  if (!player) return;
  try {
    await player.setPositionAsync(0);
    await player.playAsync();
  } catch {
    /* the vibration still carries the alert */
  }
}

/** Stops it — called when staff acknowledge or accept the order. */
export async function stopOrderAlert(): Promise<void> {
  loopCount = 0;
  Vibration.cancel();
  if (!sound) return;
  try {
    await sound.stopAsync();
  } catch {
    /* already stopped */
  }
}

/** Raises the shade notification for an order nobody is looking at. */
export async function notifyNewOrder(params: {
  orderNumber: string;
  itemCount: number;
  total: number;
}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `New order ${params.orderNumber}`,
        body: `${params.itemCount} item${params.itemCount === 1 ? '' : 's'} · Rs ${params.total.toFixed(
          0
        )}. Open Quick Bites Partner to accept.`,
        sound: Platform.OS === 'android' ? 'new_order.wav' : true,
        vibrate: VIBRATION_PATTERN,
        priority: Notifications.AndroidNotificationPriority.MAX,
        ...(Platform.OS === 'android' ? { channelId: NEW_ORDER_CHANNEL } : {})
      },
      trigger: null
    });
  } catch {
    /* the in-app alert has already fired */
  }
}

/**
 * Orders that have already been announced.
 *
 * Module scope, deliberately. Two things report a new order — the socket, and
 * the polling fallback for the networks where websockets are blocked — and
 * without a shared record the same order rings twice, or the record is thrown
 * away every time the kitchen changes tab.
 */
const announced = new Set<string>();

/** Keeps the set from growing without bound over a long shift. */
const MAX_REMEMBERED = 400;

/*
 * Whether the opening queue has been read yet.
 *
 * Held separately rather than inferred from `announced` being empty, which is
 * the obvious shortcut and is wrong: a kitchen that opens the app with NO
 * orders waiting leaves the set empty, so the next order to arrive would be
 * mistaken for part of the opening queue and silently marked as seen. That is
 * the first order of a quiet shift — exactly the one nobody is watching the
 * screen for.
 */
let baselineTaken = false;

export interface NewOrderSummary {
  id: string;
  orderNumber: string;
  itemCount: number;
  total: number;
}

/**
 * Announce an order, unless it has already been announced.
 *
 * Returns true if this call is what rang, so a caller can tell a genuinely new
 * order from a second report of one it already knows about.
 */
export async function announceOrder(order: NewOrderSummary): Promise<boolean> {
  if (!order?.id || announced.has(order.id)) return false;

  if (announced.size >= MAX_REMEMBERED) {
    // Oldest first. Insertion order is guaranteed for a Set.
    const oldest = announced.values().next().value;
    if (oldest) announced.delete(oldest);
  }
  announced.add(order.id);

  await startOrderAlert();
  await notifyNewOrder({
    orderNumber: order.orderNumber,
    itemCount: order.itemCount,
    total: order.total
  });
  return true;
}

/**
 * Records orders as already-seen WITHOUT ringing.
 *
 * Called with whatever is already in the queue when the app opens, so a kitchen
 * signing in mid-service is not greeted by an alarm for work it is already
 * halfway through.
 */
export function markOrdersSeen(ids: string[]): void {
  for (const id of ids) if (id) announced.add(id);
  baselineTaken = true;
}

/** True once the opening queue has been read, so no caller takes a second baseline. */
export function hasTakenBaseline(): boolean {
  return baselineTaken;
}

/** Releases the audio handle when the partner signs out. */
export async function releaseOrderAlerts(): Promise<void> {
  await stopOrderAlert();
  // Cleared on sign-out. A shared kitchen phone that changes hands between
  // shifts would otherwise keep the previous session's order ids and stay
  // silent for anything already announced to somebody who has gone home.
  announced.clear();
  baselineTaken = false;
  if (sound) {
    try {
      await sound.unloadAsync();
    } catch {
      /* nothing to release */
    }
    sound = null;
  }
  configured = false;
}
