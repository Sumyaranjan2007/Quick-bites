import React from 'react';
import { Modal as RNModal, Platform, StyleSheet, View, type ModalProps } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * React Native's Modal, kept clear of the Android system bars.
 *
 * Since Expo SDK 54 (React Native 0.81) every Android app is edge-to-edge, and
 * React Native then draws every Modal under the status bar and the navigation
 * bar whatever its props say. A bottom sheet's last button sat behind the
 * back/home/recents keys. Padding here, measured inside the modal (a provider
 * outside it measures a screen already padded), puts every modal back where it
 * was before the upgrade. iPhone is untouched.
 */
export const Modal: React.FC<ModalProps> = ({ children, ...props }) =>
  Platform.OS === 'android' ? (
    <RNModal {...props}>
      <SafeAreaProvider>
        <InsetFrame>{children}</InsetFrame>
      </SafeAreaProvider>
    </RNModal>
  ) : (
    <RNModal {...props}>{children}</RNModal>
  );

const InsetFrame: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{children}</View>
  );
};

const styles = StyleSheet.create({
  frame: { flex: 1 }
});
