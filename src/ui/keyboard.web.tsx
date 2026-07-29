import React from 'react';
import { ScrollView, ScrollViewProps, StyleProp, View, ViewStyle } from 'react-native';

/**
 * Web half of the keyboard seam. react-native-keyboard-controller is native
 * only — importing it here would break the web bundle — and browsers already
 * scroll a focused input into view, so plain components are the right answer.
 */
export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function KeyboardAwareScroll({
  children,
  bottomOffset: _bottomOffset,
  ...rest
}: ScrollViewProps & { children: React.ReactNode; bottomOffset?: number }) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" {...rest}>
      {children}
    </ScrollView>
  );
}

export function KeyboardStickyFooter({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={style}>{children}</View>;
}
