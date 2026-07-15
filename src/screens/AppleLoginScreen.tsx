import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { colors, spacing } from '../ui/theme';
import { PendingLogin, login, requestSms, submit2fa } from '../findmy/apple/session';

type Props = NativeStackScreenProps<RootStackParamList, 'AppleLogin'>;

type Phase = 'form' | 'busy' | '2fa-pick' | '2fa-code';

export function AppleLoginScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: spacing(2), paddingBottom: spacing(2) + insets.bottom }}
      keyboardShouldPersistTaps="handled">
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>Use a burner Apple ID</Text>
        <Text style={styles.warningBody}>
          Signing in goes through a shared public anisette server, which carries a real risk of Apple locking the
          account. Use a throwaway Apple ID you don't care about. The account must use SMS two-factor authentication —
          app-based / push 2FA is not supported by this flow.
        </Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {(phase === 'form' || phase === 'busy') && !pending && (
        <>
          <Text style={styles.label}>Apple ID</Text>
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
          <Pressable
            style={[styles.button, (busy || !email || !password) && { opacity: 0.5 }]}
            onPress={signIn}
            disabled={busy || !email || !password}
            testID="apple-signin">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>
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
          <Pressable
            style={[styles.button, (busy || phoneId == null) && { opacity: 0.5 }]}
            onPress={sendCode}
            disabled={busy || phoneId == null}
            testID="apple-send-code">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send SMS code</Text>}
          </Pressable>
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
          <Pressable
            style={[styles.button, code.length < 4 && { opacity: 0.5 }]}
            onPress={verify}
            disabled={code.length < 4}
            testID="apple-verify">
            <Text style={styles.buttonText}>Verify</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  warning: { backgroundColor: '#2a2410', borderColor: colors.warn, borderWidth: 1, borderRadius: 10, padding: spacing(1.5), marginBottom: spacing(2) },
  warningTitle: { color: colors.warn, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  warningBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, marginBottom: spacing(1.5), fontSize: 14 },
  label: { color: colors.textDim, marginTop: spacing(1.5), marginBottom: spacing(0.5), fontSize: 13, textTransform: 'uppercase' },
  input: { backgroundColor: colors.card, borderRadius: 10, height: 48, paddingHorizontal: spacing(1.5), color: colors.text, fontSize: 16 },
  button: { backgroundColor: colors.accent, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: spacing(2) },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  phone: { backgroundColor: colors.card, borderRadius: 10, padding: spacing(1.5), marginBottom: spacing(1), borderWidth: 1, borderColor: 'transparent' },
  phoneSelected: { borderColor: colors.accent },
  phoneText: { color: colors.text, fontSize: 15 },
});
