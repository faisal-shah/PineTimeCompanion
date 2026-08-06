// The app's one modal shell. Five screens had each hand-rolled the same
// dimmed-backdrop + centred card, so the padding, radius and dim level drifted
// apart; this owns them. Tapping the backdrop dismisses (same as Android back).
//
// Dialog     — the shell, for arbitrary content.
// TextPrompt — the common "one field + Cancel/Save" case.

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing } from './theme';

export function Dialog(props: { visible: boolean; onDismiss: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onDismiss}>
      <Pressable style={styles.backdrop} onPress={props.onDismiss}>
        {/* swallow taps inside the card so they don't dismiss */}
        <Pressable style={styles.card} onPress={() => undefined}>
          {props.children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function DialogTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function DialogSubtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

/** Right-aligned action row; the last child reads as the primary action. */
export function DialogActions({ children }: { children: React.ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

export function DialogButton(props: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      style={[
        styles.button,
        props.primary === true && { backgroundColor: colors.accent },
        props.disabled === true && styles.buttonDisabled,
      ]}
      onPress={props.onPress}
      disabled={props.disabled}
      testID={props.testID}>
      <Text style={[styles.buttonText, props.primary === true && { color: '#fff' }]}>{props.label}</Text>
    </Pressable>
  );
}

/** One text field with Cancel / Save — the shape TasksScreen needed twice. */
export function TextPrompt(props: {
  visible: boolean;
  title: string;
  subtitle?: string;
  value: string;
  onChangeText: (t: string) => void;
  maxLength?: number;
  keyboardType?: 'default' | 'number-pad';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog visible={props.visible} onDismiss={props.onCancel}>
      <DialogTitle>{props.title}</DialogTitle>
      {props.subtitle !== undefined ? <DialogSubtitle>{props.subtitle}</DialogSubtitle> : null}
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        maxLength={props.maxLength}
        keyboardType={props.keyboardType ?? 'default'}
        autoFocus
        onSubmitEditing={props.onConfirm}
        returnKeyType="done"
        testID="prompt-input"
      />
      <DialogActions>
        <DialogButton label="Cancel" onPress={props.onCancel} />
        <DialogButton label="Save" onPress={props.onConfirm} primary testID="prompt-confirm" />
      </DialogActions>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing(3) },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: 16, padding: spacing(3) },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: spacing(0.5), lineHeight: 18 },
  input: {
    height: 48,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: spacing(2),
    color: colors.text,
    fontSize: 16,
    marginTop: spacing(2),
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(1), marginTop: spacing(2) },
  button: { paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), borderRadius: 10 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
