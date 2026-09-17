import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Android's back gesture, wired to the app's own navigation.
 *
 * None of the four apps handled it. They navigate by swapping a screen name in
 * state, and React Native does nothing with the hardware button on its own, so
 * Android's default took over and finished the activity: pressing back — or
 * swiping from the edge, which is the same event — closed the whole app from
 * any screen. A customer reading their wallet, an order, or a chat was dropped
 * onto the home screen and lost their place.
 *
 * `handler` returns the screen to go back to, or null to mean "nothing above
 * this one" — at which point the default runs and the app closes, which is what
 * a person expects from the top of the stack.
 *
 * Registered last-in-first-served by React Native, so a modal that adds its own
 * listener while open correctly takes precedence over the screen beneath it.
 */
export function useHardwareBack(handler: () => boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => subscription.remove();
  }, [handler]);
}
