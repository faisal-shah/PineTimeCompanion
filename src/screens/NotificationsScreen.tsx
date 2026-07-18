import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import {
  forwarderAvailable,
  getInstalledApps,
  getStatus,
  isNotificationAccessGranted,
  onNowPlaying,
  openNotificationAccessSettings,
  syncForwarderConfig,
} from '../notifications/forwarder';
import type { InstalledApp, NowPlaying } from '../../modules/notification-forwarder';
import { getNotificationSettings, saveNotificationSettings } from '../storage/notificationSettings';

type Props = NativeStackScreenProps<RootStackParamList, 'Notifications'>;

export function NotificationsScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);

  const [granted, setGranted] = useState(true);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [forwardCalls, setForwardCalls] = useState(true);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [query, setQuery] = useState('');

  // Re-check Notification Access each time the screen regains focus (the user
  // may have just granted it in system settings).
  useFocusEffect(
    useCallback(() => {
      isNotificationAccessGranted().then(setGranted);
      getStatus().then((st) => setNowPlaying(st.nowPlaying ?? null)).catch(() => undefined);
      const sub = onNowPlaying((e) => setNowPlaying(e.nowPlaying));
      return () => sub.remove();
    }, []),
  );

  useEffect(() => {
    getNotificationSettings().then((s) => {
      setForwardCalls(s.forwardCalls);
      setAllowed(s.allowedPackages);
    });
    if (forwarderAvailable) {
      getInstalledApps().then(setApps).catch(() => setApps([]));
    }
  }, []);

  const persist = useCallback(
    async (next: { forwardCalls: boolean; allowedPackages: string[] }) => {
      await saveNotificationSettings(next);
      await syncForwarderConfig(watches);
    },
    [watches],
  );

  const toggleWatch = (value: boolean) => {
    if (!watch) return;
    upsertWatch({ ...watch, forwardNotifications: value }); // sync fires via bootstrap effect
  };

  const toggleCalls = (value: boolean) => {
    setForwardCalls(value);
    void persist({ forwardCalls: value, allowedPackages: allowed });
  };

  const toggleApp = (pkg: string) => {
    const next = allowed.includes(pkg) ? allowed.filter((p) => p !== pkg) : [...allowed, pkg];
    setAllowed(next);
    void persist({ forwardCalls, allowedPackages: next });
  };

  const filteredApps = useMemo(() => {
    if (!apps) return null;
    const q = query.trim().toLowerCase();
    // Selected apps first, then by label; filter by the search query.
    return apps
      .filter((a) => !q || a.label.toLowerCase().includes(q) || a.packageName.includes(q))
      .sort((a, b) => Number(allowed.includes(b.packageName)) - Number(allowed.includes(a.packageName)));
  }, [apps, query, allowed]);

  if (!watch) return null;

  if (!forwarderAvailable) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.androidOnly}>📵 Notification forwarding is available in the Android app.</Text>
        <Text style={styles.androidOnlySub}>A browser can't run the background listener needed to forward your phone's notifications.</Text>
      </View>
    );
  }

  const paired = !!watch.deviceId;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(2), paddingBottom: spacing(2) + insets.bottom }}>
      {!granted && (
        <View style={styles.banner} testID="access-banner">
          <Text style={styles.bannerTitle}>Notification access needed</Text>
          <Text style={styles.bannerBody}>
            To forward your phone's notifications, grant this app Notification Access in system settings.
          </Text>
          <Pressable style={styles.bannerButton} onPress={openNotificationAccessSettings} testID="open-access">
            <Text style={styles.bannerButtonText}>Open settings</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Forward to {watch.name}</Text>
          <Text style={styles.rowSub}>{paired ? 'Keeps this watch connected; mirrors your alerts and music' : 'Pair this watch first'}</Text>
        </View>
        <Switch
          value={!!watch.forwardNotifications}
          onValueChange={toggleWatch}
          disabled={!paired}
          testID="toggle-forward"
        />
      </View>

      {watch.forwardNotifications && (
        <View style={styles.nowPlayingRow} testID="now-playing">
          <Text style={styles.nowPlayingIcon}>{nowPlaying?.playing ? '🎵' : '🎧'}</Text>
          <Text style={styles.nowPlayingText} numberOfLines={1}>
            {nowPlaying ? `${nowPlaying.artist || 'Unknown'} — ${nowPlaying.track || 'Unknown'}` : 'Nothing playing'}
          </Text>
        </View>
      )}

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Forward incoming calls</Text>
          <Text style={styles.rowSub}>The watch rings and shows the caller. (Its buttons silence the watch; they don't answer the phone yet.)</Text>
        </View>
        <Switch value={forwardCalls} onValueChange={toggleCalls} testID="toggle-calls" />
      </View>

      <Text style={styles.sectionLabel}>Apps to forward</Text>
      <Text style={styles.sectionHint}>Only notifications from the apps you pick are forwarded. Applies to every watch with forwarding on.</Text>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search apps"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        testID="app-search"
      />
      {filteredApps === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing(2) }} />
      ) : (
        filteredApps.map((app) => {
          const on = allowed.includes(app.packageName);
          return (
            <Pressable key={app.packageName} style={styles.appRow} onPress={() => toggleApp(app.packageName)} testID={`app-${app.packageName}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.appLabel}>{app.label}</Text>
                <Text style={styles.appPkg}>{app.packageName}</Text>
              </View>
              <View style={[styles.check, on && styles.checkOn]}>{on && <Text style={styles.checkMark}>✓</Text>}</View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing(4) },
  androidOnly: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  androidOnlySub: { color: colors.textDim, fontSize: 14, textAlign: 'center', marginTop: spacing(1), lineHeight: 20 },

  banner: { backgroundColor: '#2a2410', borderWidth: 1, borderColor: colors.warn, borderRadius: 12, padding: spacing(2), marginBottom: spacing(2) },
  bannerTitle: { color: colors.warn, fontSize: 15, fontWeight: '700' },
  bannerBody: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: spacing(0.5) },
  bannerButton: { backgroundColor: colors.warn, borderRadius: 10, paddingVertical: spacing(1), alignItems: 'center', marginTop: spacing(1.5) },
  bannerButtonText: { color: '#1a1600', fontSize: 15, fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(1.5) },
  rowText: { flex: 1, marginRight: spacing(1.5) },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowSub: { color: colors.textDim, fontSize: 13, marginTop: 2, lineHeight: 18 },

  nowPlayingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(2), marginTop: -spacing(0.5), marginBottom: spacing(1.5) },
  nowPlayingIcon: { fontSize: 14, marginRight: spacing(1) },
  nowPlayingText: { color: colors.textDim, fontSize: 13, flex: 1 },

  sectionLabel: { color: colors.textDim, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing(2), marginBottom: spacing(0.5) },
  sectionHint: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginBottom: spacing(1) },
  search: { backgroundColor: colors.card, borderRadius: 10, minHeight: 44, paddingHorizontal: spacing(1.5), color: colors.text, fontSize: 15, marginBottom: spacing(1) },

  appRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(1.25), paddingHorizontal: spacing(1), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.card },
  appLabel: { color: colors.text, fontSize: 15 },
  appPkg: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  check: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.textDim, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
