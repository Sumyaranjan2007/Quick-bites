import { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';

/**
 * Android's back gesture, wired to the app's own navigation.
 *
 * The apps navigate by swapping a screen name in state, and React Native does
 * nothing with the hardware button on its own, so without this the platform
 * default runs and finishes the activity: back — or an edge swipe, which is the
 * same event — closes the whole app from any screen.
 *
 * `handler` returns true when it has handled the press, or false to mean
 * "nothing above this one".
 *
 * Registered last-in-first-served by React Native, so a modal that adds its own
 * listener while open correctly takes precedence over the screen beneath it.
 *
 * NOTE: this hook is only half the fix. If Android's predictive back gesture is
 * active, the system never calls the legacy path `BackHandler` listens on, and
 * nothing here runs at all. The `withLegacyBackGesture` config plugin opts the
 * app out of predictive back so these listeners keep receiving events; without
 * that plugin this file is dead code on newer Android versions.
 */
export function useHardwareBack(handler: () => boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => subscription.remove();
  }, [handler]);
}

/**
 * The same, plus "press back again to exit" at the top of the stack.
 *
 * Closing an app on a single unconfirmed press is how people lose a half-filled
 * cart to a misplaced thumb. Android's convention is a brief toast and a short
 * window in which a second press really does leave — familiar enough that
 * nobody has to be taught it, and forgiving enough that an accidental press
 * costs nothing.
 *
 * `handler` still owns everything above the top of the stack. This only decides
 * what happens once the handler has said "nothing above this one".
 */
export function useHardwareBackWithExitConfirm(
  handler: () => boolean,
  message = 'Press back again to exit'
): void {
  const lastPress = useRef(0);

  const guarded = useCallback(() => {
    if (handler()) return true;

    const now = Date.now();
    // Two seconds: long enough to be a deliberate second press, short enough
    // that a press a minute later is treated as a fresh one rather than
    // completing an exit the person has long forgotten starting.
    if (now - lastPress.current < 2000) return false;

    lastPress.current = now;
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return true;
  }, [handler, message]);

  useHardwareBack(guarded);
}

/**
 * Refuses the back press outright and says why.
 *
 * For the screens where going back is not a navigation question but a wrong
 * answer — mid-payment, part-way through registration — where silently
 * returning would abandon something the person has not finished.
 *
 * `active` lets a screen turn the block on and off as its own state changes, so
 * a checkout screen can block only while a payment is actually in flight.
 */
export function useBlockHardwareBack(active: boolean, reason: string): void {
  const block = useCallback(() => {
    if (!active) return false;
    ToastAndroid.show(reason, ToastAndroid.SHORT);
    return true;
  }, [active, reason]);

  useHardwareBack(block);
}
