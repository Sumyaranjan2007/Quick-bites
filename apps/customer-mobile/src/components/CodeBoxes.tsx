import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { tokens } from '../theme/tokens';

const c = tokens.colors;

/**
 * The 6-digit code as six boxes (master plan D2). One real text field sits under
 * the boxes, so paste, the keyboard's code suggestion and backspace all work as
 * normal; the boxes only show it. `shakeKey` changing shakes the row (wrong code).
 */
export const CodeBoxes: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  shakeKey: number;
  hasError?: boolean;
}> = ({ value, onChange, onComplete, shakeKey, hasError }) => {
  const input = useRef<TextInput>(null);
  const x = useSharedValue(0);
  useEffect(() => {
    if (!shakeKey) return;
    x.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(0, { duration: 50 })
    );
  }, [shakeKey, x]);
  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // Focused after the step's slide-in: autoFocus during an animation is ignored on Android.
  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, []);

  return (
    // The real field lies OVER the boxes (round 3, item 4): a tap lands on a text field, so
    // Android always opens the keyboard. A 1-pixel hidden field under them was refused by
    // some phones, and a second tap on an already-focused field did nothing.
    <Pressable
      onPress={() => {
        input.current?.blur();
        setTimeout(() => input.current?.focus(), 50);
      }}
    >
      <Animated.View style={[styles.row, shake]}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={[styles.box, i === value.length && styles.boxActive, hasError && styles.boxError]}>
            <Text style={styles.digit}>{value[i] ?? ''}</Text>
          </View>
        ))}
      </Animated.View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={v => {
          const digits = v.replace(/[^0-9]/g, '').slice(0, 6);
          onChange(digits);
          if (digits.length === 6) onComplete(digits);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        caretHidden
        style={styles.hidden}
        accessibilityLabel="Verification code"
      />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginVertical: 8 },
  box: {
    flex: 1,
    height: 54,
    borderRadius: tokens.radii.lg,
    borderWidth: 1.5,
    borderColor: c.border.medium,
    backgroundColor: c.surface.card,
    alignItems: 'center',
    justifyContent: 'center'
  },
  boxActive: { borderColor: c.primary[600] },
  boxError: { borderColor: c.semantic.error },
  digit: { fontFamily: tokens.font.family, fontSize: 22, fontWeight: '700', color: c.text.primary },
  hidden: { ...StyleSheet.absoluteFillObject, opacity: 0.02, color: 'transparent' }
});
