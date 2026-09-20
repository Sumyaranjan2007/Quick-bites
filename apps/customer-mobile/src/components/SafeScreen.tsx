import React from 'react';
import { StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The outermost frame of every screen.
 *
 * This used to pad only the TOP, from `StatusBar.currentHeight`. That fixed the
 * title row colliding with the clock, and it left the other three edges wrong:
 *
 *   - **The bottom.** Nothing was reserved for the navigation bar, so on the
 *     very common three-button layout the system's back, home and recents keys
 *     sat directly on top of the app's own bottom row. The last item in a list,
 *     the "Place order" button, the tab bar — all of them were partly or wholly
 *     unreachable. On a gesture-navigation phone there is only a thin pill and
 *     the fault is invisible, which is exactly why it survived: it is a defect
 *     you cannot see on the device you happen to be testing on.
 *   - **The sides.** A cutout or a curved edge in landscape clipped content.
 *   - **Changes.** `StatusBar.currentHeight` is a number read once. It does not
 *     move when the keyboard opens, when the device rotates, or when Android
 *     switches between gesture and three-button navigation while the app is
 *     running — all of which change the real inset.
 *
 * `useSafeAreaInsets` reports what the window manager actually says, per edge,
 * and re-renders when it changes. It is the same mechanism React Navigation
 * uses, so it behaves the way the rest of the ecosystem expects.
 *
 * Applied once here rather than screen by screen, so a new screen cannot
 * reintroduce the bug by forgetting to pad itself.
 */
export const SafeScreen: React.FC<{
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Screens that paint their own full-bleed header can opt out of the top pad. */
  edgeToEdge?: boolean;
  /**
   * Opt out of the bottom pad — for a screen that puts its own bar flush to the
   * bottom and handles the inset itself. Rare, and deliberate when used.
   */
  noBottomInset?: boolean;
  backgroundColor?: string;
}> = ({ children, style, edgeToEdge, noBottomInset, backgroundColor }) => {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.frame,
        backgroundColor ? { backgroundColor } : null,
        {
          paddingTop: edgeToEdge ? 0 : insets.top,
          // The three-button navigation bar. This is the edge that was missing.
          paddingBottom: noBottomInset ? 0 : insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right
        },
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
