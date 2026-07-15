import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { BeaconConfig } from '../model/types';
import { advertisementKeyBytes, generateFindMyKey, keyFileContents, keyFileName } from '../beacon/findMyKeys';
import { enableBeacon, writeBeaconKey } from '../ble/syncManager';
import { makeTransport } from '../ble/transportFactory';
import { getBeaconPrivateKey, saveBeaconPrivateKey } from '../secure/secrets';
import { AppleSession, loadSession, signOut } from '../findmy/apple/session';

type Props = NativeStackScreenProps<RootStackParamList, 'Beacon'>;

export function BeaconScreen({ route, navigation }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const insets = useSafeAreaInsets();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const [busy, setBusy] = useState<string | null>(null);
  const [session, setSession] = useState<AppleSession | null>(null);

  useEffect(() => {
    const refresh = () => loadSession().then(setSession);
    refresh();
    return navigation.addListener('focus', refresh);
  }, [navigation]);

  if (!watch) {
    return null;
  }
  const beacon = watch.beacon;

  const setBeacon = (b: BeaconConfig) => upsertWatch({ ...watch, beacon: b });

  // Generate a keypair, stash the private key in the OS keystore, and persist
  // only the non-secret parts on the watch record.
  const doGenerate = async () => {
    const k = generateFindMyKey();
    await saveBeaconPrivateKey(watch.id, k.privateKeyB64!);
    setBeacon({ advertisementKeyB64: k.advertisementKeyB64, hashedKeyId: k.hashedKeyId, provisioned: false });
  };

  const generate = () => {
    if (beacon) {
      Alert.alert('Replace key?', 'This watch already has a Find My key. Generating a new one abandons the old one (any pending location reports for it become unreachable).', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => void doGenerate() },
      ]);
      return;
    }
    void doGenerate();
  };

  const provision = async () => {
    if (!beacon) {
      return;
    }
    if (!watch.deviceId) {
      Alert.alert('Not paired', 'Pair this watch first from its watch screen.');
      return;
    }
    setBusy('Provision');
    try {
      await writeBeaconKey(makeTransport(watch.deviceId), watch.deviceId, advertisementKeyBytes(beacon));
      setBeacon({ ...beacon, provisioned: true });
      Alert.alert('Key on the watch', 'The advertisement key is stored. Turn Find My on from here or on the watch (Settings -> Find My).');
    } catch (e) {
      Alert.alert('Provision failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const turnOn = () => {
    if (!watch.deviceId || !beacon?.provisioned) {
      return;
    }
    Alert.alert(
      'Turn on Find My?',
      'The watch will disconnect and become hidden (non-connectable) so it can broadcast. You can only turn it back off on the watch itself (Settings -> Find My).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn on',
          onPress: async () => {
            setBusy('Enable');
            try {
              await enableBeacon(makeTransport(watch.deviceId!), watch.deviceId!);
              Alert.alert('Find My is on', 'The watch is now hidden and broadcasting. Turn it off on the watch when you want to reconnect.');
            } catch (e) {
              Alert.alert('Could not enable', (e as Error).message);
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const exportKeys = async () => {
    if (!beacon) {
      return;
    }
    try {
      const privateKeyB64 = await getBeaconPrivateKey(watch.id);
      if (!privateKeyB64) {
        Alert.alert('No private key', 'This key was made on another phone; only the phone that generated it can export it.');
        return;
      }
      const full = { ...beacon, privateKeyB64 };
      await Share.share({ message: keyFileContents(full), title: keyFileName(full) });
    } catch (e) {
      Alert.alert('Export failed', (e as Error).message);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: spacing(2), paddingBottom: spacing(2) + insets.bottom }}>
      <Text style={styles.body}>
        Find My turns this watch into an OpenHaystack beacon: nearby iPhones report its location to Apple's Find My network,
        which you retrieve on your own macless-haystack server using the exported keys. Only use it to locate your own device.
      </Text>

      <Text style={styles.label}>1. Key</Text>
      {beacon ? (
        <View style={styles.card}>
          <Text style={styles.mono}>id {beacon.hashedKeyId}</Text>
          <Text style={styles.status}>{beacon.provisioned ? 'On the watch' : 'Not yet on the watch'}</Text>
        </View>
      ) : (
        <Text style={styles.status}>No key yet.</Text>
      )}
      <Pressable style={styles.secondaryButton} onPress={generate} testID="beacon-generate">
        <Text style={styles.secondaryText}>{beacon ? 'Generate a new key' : 'Generate key'}</Text>
      </Pressable>

      <Text style={styles.label}>2. Put it on the watch</Text>
      <Pressable
        style={[styles.button, (!beacon || busy !== null) && { opacity: 0.5 }]}
        onPress={provision}
        disabled={!beacon || busy !== null}
        testID="beacon-provision">
        <Text style={styles.buttonText}>{busy === 'Provision' ? 'Writing…' : 'Provision to watch'}</Text>
      </Pressable>

      <Text style={styles.label}>3. Turn on (optional here; also on the watch)</Text>
      <Pressable
        style={[styles.button, (!beacon?.provisioned || busy !== null) && { opacity: 0.5 }]}
        onPress={turnOn}
        disabled={!beacon?.provisioned || busy !== null}
        testID="beacon-enable">
        <Text style={styles.buttonText}>{busy === 'Enable' ? 'Enabling…' : 'Turn on Find My'}</Text>
      </Pressable>

      <Text style={styles.label}>4. Export keys for your server</Text>
      <Pressable
        style={[styles.secondaryButton, !beacon && { opacity: 0.5 }]}
        onPress={exportKeys}
        disabled={!beacon}
        testID="beacon-export">
        <Text style={styles.secondaryText}>Export .keys file</Text>
      </Pressable>
      <Text style={styles.hint}>
        The exported file (macless-haystack format) holds the private key — keep it safe. Load it into your macless-haystack
        instance to see this watch's location.
      </Text>

      <Text style={styles.label}>5. Locate this watch</Text>
      <Pressable
        style={[styles.button, !beacon && { opacity: 0.5 }]}
        onPress={() => navigation.navigate('FindMyMap', { watchId: watch.id })}
        disabled={!beacon}
        testID="beacon-map">
        <Text style={styles.buttonText}>View location on map</Text>
      </Pressable>
      {session ? (
        <View style={styles.card}>
          <Text style={styles.status}>Signed in to Apple as {session.info.accountName || session.username}</Text>
          <Pressable onPress={() => signOut().then(() => setSession(null))}>
            <Text style={styles.secondaryText}>Sign out</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('AppleLogin')} testID="beacon-signin">
          <Text style={styles.secondaryText}>Sign in to Apple</Text>
        </Pressable>
      )}
      <Text style={styles.hint}>
        Sign in with a burner Apple ID to pull this watch's crowd-sourced location from Apple's Find My network and show it
        on a map.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: spacing(1) },
  label: { color: colors.textDim, marginTop: spacing(2.5), marginBottom: spacing(1), fontSize: 13, textTransform: 'uppercase' },
  card: { backgroundColor: colors.card, borderRadius: 10, padding: spacing(1.5), marginBottom: spacing(1) },
  mono: { color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  status: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  button: { backgroundColor: colors.accent, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: colors.card,
    borderRadius: 12,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: spacing(1) },
});
