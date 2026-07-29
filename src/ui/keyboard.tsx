import React from 'react';
import { ScrollViewProps, StyleProp, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView, KeyboardProvider, KeyboardStickyView } from 'react-native-keyboard-controller';

/**
 * Keyboard handling, native side. See `keyboard.web.tsx` for the web half.
 *
 * Under Android edge-to-edge — the default from Expo SDK 54 — two things break
 * at once and neither announces itself: `adjustResize` no longer shrinks the
 * window, so the keyboard *overlays* content, and React Native's own `Keyboard`
 * events never fire. The obvious fix (listen for `keyboardDidShow`, add bottom
 * padding) compiles, runs, throws nothing and does nothing.
 *
 * react-native-keyboard-controller tracks the IME through WindowInsets, which
 * is the only mechanism that survives edge-to-edge. It has no web build, hence
 * the seam.
 */
export { KeyboardProvider };

/** A ScrollView that keeps the focused field above the keyboard. */
export function KeyboardAwareScroll({
  children,
  bottomOffset = 96,
  ...rest
}: ScrollViewProps & { children: React.ReactNode; bottomOffset?: number }) {
  return (
    <KeyboardAwareScrollView bottomOffset={bottomOffset} keyboardShouldPersistTaps="handled" {...rest}>
      {children}
    </KeyboardAwareScrollView>
  );
}

/**
 * Lifts a fixed footer above the keyboard. Screens that are a list plus a
 * compose row cannot use the scroll variant — the list is already the scroller
 * — so the footer rides the IME instead.
 */
export function KeyboardStickyFooter({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <KeyboardStickyView style={style}>{children}</KeyboardStickyView>;
}
