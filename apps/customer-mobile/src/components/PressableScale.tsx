import React from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { tokens } from '../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS = tokens.motion.press;
const EASE = Easing.bezier(...tokens.motion.easeOut);

/**
 * The press feel of every card and button (design/motion/README.md `press`):
 * scale to 0.97 in 120 ms under the finger, back to 1 on release, on the UI
 * thread. With the phone's "reduce motion" on it stays still (the screen's own
 * change still explains the tap).
 */
export const PressableScale: React.FC<
  Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; children?: React.ReactNode }
> = ({ style, children, onPressIn, onPressOut, ...rest }) => {
  const scale = useSharedValue(1);
  const reduce = useReducedMotion();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const to = (value: number) => {
    if (!reduce) scale.value = withTiming(value, { duration: PRESS.duration, easing: EASE });
  };
  return (
    <AnimatedPressable
      {...rest}
      style={[style, animated]}
      onPressIn={e => {
        to(PRESS.scale);
        onPressIn?.(e);
      }}
      onPressOut={e => {
        to(1);
        onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
};
