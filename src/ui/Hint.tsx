import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import { colors, spacing } from './theme';

/**
 * Small dim explanatory text. Screens had grown three near-identical local
 * `hint` styles at differing sizes; this is the single one.
 *
 * Use it for anything the UI cannot show on its own — gestures with no visible
 * affordance (long-press to delete), and rules that aren't obvious from the
 * controls (calls bypass the app allowlist).
 */
export function Hint({
  children,
  center,
  style,
  testID,
}: {
  children: React.ReactNode;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  return (
    <Text style={[styles.hint, center && styles.center, style]} testID={testID}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  // Horizontal padding matters: these often sit outside a list's padded content
  // container and would otherwise run edge to edge.
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: spacing(1), paddingHorizontal: spacing(2) },
  center: { textAlign: 'center' },
});
