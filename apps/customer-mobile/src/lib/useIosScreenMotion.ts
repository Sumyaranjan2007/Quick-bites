import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Platform, useWindowDimensions } from 'react-native';

/**
 * How an iPhone expects screens to move: a deeper screen slides in from the
 * right, going back reveals the previous one from the left, and a swipe from
 * the left edge goes back.
 *
 * Android has the hardware back button for that (useHardwareBack) and its own
 * conventions, so on Android this returns a still screen and no gesture — the
 * Android app is unchanged.
 *
 * One screen is mounted at a time (App.tsx switches on state), so the swipe
 * moves the current screen off to the right and the previous one then slides
 * in, rather than being visible underneath as in a native stack. With Reduce
 * Motion on, screens change without sliding; the swipe still works.
 */
const EDGE = 24;
const ios = Platform.OS === 'ios';

function useReduceMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!ios) return;
    AccessibilityInfo.isReduceMotionEnabled().then(setOn).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn);
    return () => sub.remove();
  }, []);
  return on;
}

export function useIosScreenMotion(screen: string, depth: number, onSwipeBack: (() => void) | null) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  const previousDepth = useRef(depth);
  const back = useRef(onSwipeBack);
  back.current = onSwipeBack;

  // Before paint, so the new screen never flashes in place before sliding.
  useLayoutEffect(() => {
    const from = previousDepth.current;
    previousDepth.current = depth;
    if (!ios || reduceMotion || depth === from) {
      x.setValue(0);
      return;
    }
    const forward = depth > from;
    x.setValue(forward ? width : -width * 0.3);
    Animated.timing(x, {
      toValue: 0,
      duration: forward ? 320 : 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
    // Only the screen decides; depth and width are read as of this change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Capture phase, so a horizontal list near the edge cannot keep the gesture —
        // the same priority iOS gives its own edge swipe. Taps are never captured.
        // Where the finger started is pageX minus the distance moved: `g.x0` is not
        // filled in until the gesture is granted, so it reads 0 here.
        onMoveShouldSetPanResponderCapture: (e, g) =>
          !!back.current &&
          e.nativeEvent.pageX - g.dx < EDGE &&
          g.dx > 10 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderMove: (_, g) => x.setValue(Math.max(0, g.dx)),
        onPanResponderRelease: (_, g) => {
          if (g.dx > width / 3 || g.vx > 0.5) {
            Animated.timing(x, {
              toValue: width,
              duration: 180,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true
            }).start(() => back.current?.());
          } else {
            Animated.spring(x, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () =>
          Animated.spring(x, { toValue: 0, bounciness: 0, useNativeDriver: true }).start()
      }),
    [width, x]
  );

  return {
    style: { transform: [{ translateX: x }] },
    panHandlers: ios ? pan.panHandlers : {}
  };
}
