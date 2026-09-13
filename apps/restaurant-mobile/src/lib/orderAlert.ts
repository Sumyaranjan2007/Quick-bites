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

/** Releases the audio handle when the partner signs out. */
export async function releaseOrderAlerts(): Promise<void> {
  await stopOrderAlert();
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
