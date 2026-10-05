import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * The small taps an iPhone gives under a finger: a tick on a tab, a bump when
 * food lands in the basket, a success when an order is placed.
 *
 * iPhone only. Android keeps exactly the feel it has always had, and every
 * call is fire-and-forget: a phone with haptics switched off in Settings, or a
 * Simulator with no Taptic Engine, must never turn a tap into an error.
 */
const ios = Platform.OS === 'ios';
const quiet = () => undefined;

export const haptic = {
  /** Changing a tab, a quantity, a choice. */
  select: () => {
    if (ios) Haptics.selectionAsync().catch(quiet);
  },
  /** Something was added. */
  tap: () => {
    if (ios) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(quiet);
  },
  success: () => {
    if (ios) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(quiet);
  },
  warning: () => {
    if (ios) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(quiet);
  }
};
