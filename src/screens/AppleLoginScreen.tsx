import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { colors, spacing } from '../ui/theme';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { PendingLogin, login, requestSms, submit2fa } from '../findmy/apple/session';

type Props = NativeStackScreenProps<RootStackParamList, 'AppleLogin'>;

type Phase = 'form' | 'busy' | '2fa-pick' | '2fa-code';

export function AppleLoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [phoneId, setPhoneId] = useState<number | null>(null);
  const [code, setCode] = useState('');

  const busy = phase === 'busy';

  const signIn = async () => {
    setError(null);
    setPhase('busy');
    try {
      const res = await login(email.trim(), password);
      if (res.status === 'logged-in') {
        navigation.goBack();
        return;
      }
      setPending(res.pending);
      setPhoneId(res.pending.phoneNumbers[0]?.id ?? null);
      setPhase('2fa-pick');
    } catch (e) {
      setError((e as Error).message);
      setPhase('form');
    }
  };

  const sendCode = async () => {
    if (!pending || phoneId == null) {
      return;
    }
    setError(null);
    setPhase('busy');
    try {
      await requestSms(pending, phoneId);
      setPhase('2fa-code');
    } catch (e) {
      setError((e as Error).message);
      setPhase('2fa-pick');
    }
  };

  const verify = async () => {
    if (!pending || phoneId == null) {
      return;
    }
    setError(null);
    setPhase('busy');
    try {
      await submit2fa(pending, phoneId, code.trim());
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setPhase('2fa-code');
    }
  };

  return (
    <Screen width="read">
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>Use a burner Apple Account</Text>
        <Text style={styles.warningBody}>
          Signing in goes through a shared public anisette server, which carries a real risk of Apple locking the
          account. Use a throwaway Apple Account you don't care about. It must use SMS two-factor authentication
          (app-based / push 2FA is not supported), and it must have been signed into iCloud + Find My on a real Apple
          device once — a brand-new account is not activated and Apple will reject it.
        </Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {(phase === 'form' || phase === 'busy') && !pending && (
        <>
          <Text style={styles.label}>Apple Account</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="burner@icloud.com"
            placeholderTextColor={colors.textDim}
            editable={!busy}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="password"
            placeholderTextColor={colors.textDim}
            editable={!busy}
          />
          <Button
            label="Sign in"
            onPress={signIn}
            disabled={busy || !email || !password}
            busy={busy}
            testID="apple-signin"
            style={{ marginTop: spacing(2) }}
          />
        </>
      )}

      {pending && (phase === '2fa-pick' || phase === 'busy') && (
        <>
          <Text style={styles.label}>Send a code to</Text>
          {pending.phoneNumbers.map((n) => (
            <Pressable
              key={n.id}
              style={[styles.phone, phoneId === n.id && styles.phoneSelected]}
              onPress={() => setPhoneId(n.id)}>
              <Text style={styles.phoneText}>{n.numberWithDialCode}</Text>
            </Pressable>
          ))}
          <Button
            label="Send SMS code"
            onPress={sendCode}
            disabled={busy || phoneId == null}
            busy={busy}
            testID="apple-send-code"
            style={{ marginTop: spacing(2) }}
          />
        </>
      )}

      {phase === '2fa-code' && (
        <>
          <Text style={styles.label}>Enter the 6-digit code</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            placeholder="123456"
            placeholderTextColor={colors.textDim}
          />
          <Button label="Verify" onPress={verify} disabled={code.length < 4} testID="apple-verify" style={{ marginTop: spacing(2) }} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  warning: { backgroundColor: '#2a2410', borderColor: colors.warn, borderWidth: 1, borderRadius: 10, padding: spacing(1.5), marginBottom: spacing(2) },
  warningTitle: { color: colors.warn, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  warningBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, marginBottom: spacing(1.5), fontSize: 14 },
  label: { color: colors.textDim, marginTop: spacing(1.5), marginBottom: spacing(0.5), fontSize: 13, textTransform: 'uppercase' },
  input: { backgroundColor: colors.card, borderRadius: 10, height: 48, paddingHorizontal: spacing(1.5), color: colors.text, fontSize: 16 },
  phone: { backgroundColor: colors.card, borderRadius: 10, padding: spacing(1.5), marginBottom: spacing(1), borderWidth: 1, borderColor: 'transparent' },
  phoneSelected: { borderColor: colors.accent },
  phoneText: { color: colors.text, fontSize: 15 },
});
