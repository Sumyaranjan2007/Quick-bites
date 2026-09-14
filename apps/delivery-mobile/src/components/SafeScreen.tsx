import React from 'react';
import { Platform, StatusBar, StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';

/**
 * The outermost frame of every screen.
 *
 * React Native's own `SafeAreaView` **does nothing on Android** — it is
 * documented as iOS-only — so every screen that relied on it was drawing its
 * header underneath the system status bar. On a phone that showed as the title
 * row colliding with the clock and the battery icon, and as the top of the
 * screen appearing to run off the edge.
 *
 * `StatusBar.currentHeight` is the real inset Android reports for the device in
 * hand, including notches and punch-holes. The fallback of 24dp is the classic
 * status bar height and is only reached if Android declines to answer.
 *
 * Applied once here rather than screen by screen, so a new screen cannot
 * reintroduce the bug by forgetting to pad itself.
 */
export const SafeScreen: React.FC<{
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Screens that paint their own full-bleed header can opt out of the top pad. */
  edgeToEdge?: boolean;
  backgroundColor?: string;
}> = ({ children, style, edgeToEdge, backgroundColor }) => {
  const topInset = Platform.OS === 'android' && !edgeToEdge ? StatusBar.currentHeight ?? 24 : 0;
  return (
    <View
      style={[
        styles.frame,
        backgroundColor ? { backgroundColor } : null,
        { paddingTop: topInset },
        style
      ]}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  frame: { flex: 1 }
});
