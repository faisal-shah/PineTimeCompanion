import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';
import { colors, spacing } from './theme';
import { useLayout } from './layout';

type Variant = 'primary' | 'secondary' | 'danger';

/**
 * The shared action button. Full-width is a good primary-action shape on a
 * phone, but on a wide screen it stretches into a bar across the window; there,
 * it sizes to its label and sits at the start. This single rule de-stretches
 * every standalone button at once. A button already inside a `flexDirection:
 * 'row'` container is content-width, so `alignSelf` is a no-op there — those are
 * unaffected.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  style,
  textStyle,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  /** Extra style on the pressable (e.g. `flex: 1` inside a row). */
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const { isWide } = useLayout();
  const secondary = variant === 'secondary';
  const bg = variant === 'danger' ? colors.danger : secondary ? colors.card : colors.accent;
  const fg = secondary ? colors.accent : colors.onAccent;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || busy}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        { alignSelf: isWide ? 'flex-start' : 'stretch' },
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.label, { color: fg }, textStyle]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(3),
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { borderWidth: 1, borderColor: colors.accent },
  label: { fontSize: 16, fontWeight: '700' },
});
