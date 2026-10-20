import { useCallback, useRef, useState } from 'react';
import type { LayoutChangeEvent, View } from 'react-native';

/**
 * Where a KeyboardAvoidingView really sits on screen (round 3, item 4).
 *
 * The keyboard library measures a view against its parent, so one under a header
 * lifted short by the header's height and the keyboard still covered the box.
 * This measures the view in the window and hands the library the difference.
 * Spread onto the view: `<KeyboardAvoidingView {...useKeyboardOffset()} behavior="padding">`.
 * The same file in all four apps.
 */
export function useKeyboardOffset() {
  const ref = useRef<View>(null);
  const [keyboardVerticalOffset, setOffset] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const parentY = e.nativeEvent.layout.y;
    ref.current?.measureInWindow((_x, y) => {
      const next = Math.max(0, Math.round(y - parentY));
      setOffset(prev => (prev === next ? prev : next));
    });
  }, []);
  return { ref, onLayout, keyboardVerticalOffset };
}
