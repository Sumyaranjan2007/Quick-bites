import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

/**
 * Soft taps under a finger: a tick on a tab or a quantity, a bump when food
 * lands in the basket, a success when an order is placed (design/motion/README.md).
 *
 * Android and iPhone (owner, 17 Oct 2026). Android uses the system's own haptic
 * effects, which follow the phone's touch-vibration setting and feel softer
 * than a raw vibration. Every call is fire-and-forget: a phone with haptics off,
 * or a simulator, must never turn a tap into an error. Profile has a switch.
 */
const ios = Platform.OS === 'ios';
const android = Platform.OS === 'android';
const quiet = () => undefined;
const KEY = 'qb.haptics.off';

let enabled = true;
void AsyncStorage.getItem(KEY)
  .then(v => {
    enabled = v !== '1';
  })
  .catch(quiet);

export const hapticsEnabled = () => enabled;
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  void AsyncStorage.setItem(KEY, on ? '0' : '1').catch(quiet);
}

const run = (iosCall: () => Promise<void>, androidType: Haptics.AndroidHaptics) => {
  if (!enabled) return;
  if (ios) iosCall().catch(quiet);
  else if (android) Haptics.performAndroidHapticsAsync(androidType).catch(quiet);
};

export const haptic = {
  /** Changing a tab, a quantity, a choice. */
  select: () => run(() => Haptics.selectionAsync(), Haptics.AndroidHaptics.Segment_Tick),
  /** Something was added. */
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), Haptics.AndroidHaptics.Context_Click),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), Haptics.AndroidHaptics.Confirm),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning), Haptics.AndroidHaptics.Reject)
};
