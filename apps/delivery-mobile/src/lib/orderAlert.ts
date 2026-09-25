/**
 * Telling a rider a trip has arrived.
 *
 * A silent card appearing somewhere on the screen is no use to someone riding
 * with the phone in a pocket, so an offer now arrives as three things at once:
 * a chime that keeps playing until the rider answers, a vibration pattern, and
 * — when the app is not in the foreground — an Android notification carrying
 * the same sound, so the alert is heard from the shade or a locked screen.
 *
 * The notification is local, raised by this app from its own socket connection.
 * That covers the app being backgrounded, which is the realistic case: a rider
 * with the app open in their pocket or sitting behind a maps screen. It cannot
 * cover the app having been swiped away by the system, which needs a push
 * credential the platform does not have.
 */
import { Platform, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';

const NEW_ORDER_CHANNEL = 'new-orders';

/** Rings until the rider deals with the offer, rather than once and gone. */
const MAX_LOOPS = 6;
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

/**
 * Prepares audio and the notification channel.
 *
 * Called once after sign-in. `playsInSilentModeIOS` and `staysActiveInBackground`
 * matter here: an order alert that respects the silent switch is an order the
 * rider misses.
 */
export async function prepareOrderAlerts(): Promise<void> {
  if (configured) return;
  configured = true;

  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      allowsRecordingIOS: false
    });
  } catch {
    // Audio is a nicety; the vibration and the on-screen card still fire.
  }

  try {
    await Notifications.requestPermissionsAsync();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(NEW_ORDER_CHANNEL, {
        name: 'New delivery offers',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'new_order.wav',
        vibrationPattern: VIBRATION_PATTERN,
        lightColor: '#24C88E',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
        bypassDnd: false
      });
      // R2: payouts and other money news. Quiet and normal importance, so a
      // payment never sounds like an order the rider or kitchen must rush to.
      // The id matches CHANNEL.PAYMENTS in the server's fcmDispatcher.
      await Notifications.setNotificationChannelAsync('payments', {
        name: 'Payments',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
        enableVibrate: false
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

/** Stops it — called the moment the rider accepts, passes, or it expires. */
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

/** Raises the shade notification for an offer the rider may not be looking at. */
export async function notifyNewOrder(params: {
  restaurantName: string;
  payout: number;
  distanceKm?: number;
}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'New delivery offer',
        body: `${params.restaurantName} · Rs ${params.payout.toFixed(0)}${
          params.distanceKm ? ` · ${params.distanceKm} km` : ''
        }. Open Quick Bites Rider to accept.`,
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

/** Releases the audio handle when the rider signs out. */
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
