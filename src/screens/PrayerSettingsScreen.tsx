import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { AsrMadhab, PrayerMethod, PrayerSettings } from '../model/types';
import { computePrayerTimes, formatMinutes, PRAYERS } from '../model/prayerTimes';
import { WireSettings } from '../ble/prayerProtocol';
import { readPrayerSettings, writePrayerSettings } from '../ble/syncManager';
import { makeTransport } from '../ble/transportFactory';

type Props = NativeStackScreenProps<RootStackParamList, 'PrayerSettings'>;

const METHOD_OPTIONS: { value: PrayerMethod; label: string }[] = [
  { value: 'mwl', label: 'Muslim World League (18°/17°)' },
  { value: 'isna', label: 'ISNA - North America (15°/15°)' },
  { value: 'egyptian', label: 'Egyptian (19.5°/17.5°)' },
  { value: 'ummAlQura', label: 'Umm al-Qura, Makkah (18.5°, Isha +90m)' },
  { value: 'karachi', label: 'Karachi (18°/18°)' },
];

const PRAYER_LABELS: Record<string, string> = {
  fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha',
};

const phoneUtcQuarters = () => -Math.round(new Date().getTimezoneOffset() / 15);

const defaultSettings = (): Omit<PrayerSettings, 'editedAt'> => ({
  method: 'mwl',
  asrMadhab: 'standard',
  alertsEnabled: true,
  latE2: 0,
  lonE2: 0,
  utcOffsetQuarters: phoneUtcQuarters(),
});

const formatOffset = (q: number) => {
  const m = q * 15;
  const abs = Math.abs(m);
  return `${m < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

export function PrayerSettingsScreen({ route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const insets = useSafeAreaInsets();
  const watch = watches.find((w) => w.id === route.params.watchId);

  // Prefill: this watch's settings, else the household's most recently edited
  // watch (configure the family once), else defaults with the phone timezone.
  const initial = useMemo(() => {
    if (watch?.prayerSettings) {
      return watch.prayerSettings;
    }
    const candidates = watches.map((w) => w.prayerSettings).filter((s): s is PrayerSettings => s !== undefined);
    if (candidates.length > 0) {
      return candidates.reduce((a, b) => (a.editedAt >= b.editedAt ? a : b));
    }
    return { ...defaultSettings(), editedAt: 0 };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [method, setMethod] = useState<PrayerMethod>(initial.method);
  const [asrMadhab, setAsrMadhab] = useState<AsrMadhab>(initial.asrMadhab);
  const [alertsEnabled, setAlertsEnabled] = useState(initial.alertsEnabled);
  const [latText, setLatText] = useState((initial.latE2 / 100).toFixed(2));
  const [lonText, setLonText] = useState((initial.lonE2 / 100).toFixed(2));
  const [utcQuarters, setUtcQuarters] = useState(initial.utcOffsetQuarters);
  const [busy, setBusy] = useState<string | null>(null);

  if (!watch) {
    return null;
  }

  const parsed = (): WireSettings | string => {
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return 'Latitude must be between -90 and 90 (south negative).';
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      return 'Longitude must be between -180 and 180 (west negative).';
    }
    return {
      method,
      asrMadhab,
      alertsEnabled,
      latE2: Math.round(lat * 100),
      lonE2: Math.round(lon * 100),
      utcOffsetQuarters: utcQuarters,
    };
  };

  const settingsOrNull = parsed();
  const valid = typeof settingsOrNull !== 'string';

  const preview = useMemo(() => {
    if (!valid) {
      return null;
    }
    const s = settingsOrNull as WireSettings;
    const now = new Date();
    return computePrayerTimes(now.getFullYear(), now.getMonth() + 1, now.getDate(),
                              s.latE2 / 100, s.lonE2 / 100, s.utcOffsetQuarters / 4, s.method, s.asrMadhab);
  }, [valid, method, asrMadhab, latText, lonText, utcQuarters]); // eslint-disable-line react-hooks/exhaustive-deps

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const nextPrayer = useMemo(() => {
    if (!preview) {
      return undefined;
    }
    let best: string | undefined;
    let bestKey = Infinity;
    const dhuhr = preview.minutes.dhuhr ?? 0;
    for (const p of PRAYERS) {
      const m = preview.minutes[p];
      if (m === undefined) {
        continue;
      }
      const key = p !== 'fajr' && p !== 'sunrise' && p !== 'dhuhr' && m < dhuhr ? m + 1440 : m;
      if (key > nowMinutes && key < bestKey) {
        bestKey = key;
        best = p;
      }
    }
    return best ?? 'fajr';
  }, [preview, nowMinutes]);

  const useGps = async () => {
    setBusy('GPS');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Grant location access, or enter coordinates manually.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLatText(pos.coords.latitude.toFixed(2));
      setLonText(pos.coords.longitude.toFixed(2));
      setUtcQuarters(phoneUtcQuarters());
    } catch (e) {
      Alert.alert('Could not get location', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const persist = (s: WireSettings) => {
    upsertWatch({ ...watch, prayerSettings: { ...s, editedAt: Math.floor(Date.now() / 1000) } });
  };

  const apply = async () => {
    if (!valid) {
      Alert.alert('Check the location', settingsOrNull as string);
      return;
    }
    if (!watch.deviceId) {
      Alert.alert('Not paired', 'Pair this watch first from its watch screen.');
      return;
    }
    const s = settingsOrNull as WireSettings;
    setBusy('Apply');
    try {
      await writePrayerSettings(makeTransport(watch.deviceId), watch.deviceId, s);
      persist(s);
      Alert.alert('Applied', `Prayer settings are on ${watch.name}'s watch (verified).`);
    } catch (e) {
      Alert.alert('Apply failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const readFromWatch = async () => {
    if (!watch.deviceId) {
      Alert.alert('Not paired', 'Pair this watch first from its watch screen.');
      return;
    }
    setBusy('Read');
    try {
      const s = await readPrayerSettings(makeTransport(watch.deviceId), watch.deviceId);
      setMethod(s.method);
      setAsrMadhab(s.asrMadhab);
      setAlertsEnabled(s.alertsEnabled);
      setLatText((s.latE2 / 100).toFixed(2));
      setLonText((s.lonE2 / 100).toFixed(2));
      setUtcQuarters(s.utcOffsetQuarters);
      persist(s);
    } catch (e) {
      Alert.alert('Read failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: spacing(2), paddingBottom: spacing(2) + insets.bottom }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <Text style={styles.label}>Calculation method</Text>
      {METHOD_OPTIONS.map((option) => (
        <Pressable
          key={option.value}
          style={[styles.radioRow, method === option.value && styles.radioRowActive]}
          onPress={() => setMethod(option.value)}
          testID={`method-${option.value}`}>
          <View style={[styles.radioDot, method === option.value && styles.radioDotActive]} />
          <Text style={[styles.radioText, method === option.value && styles.radioTextActive]}>{option.label}</Text>
        </Pressable>
      ))}

      <Text style={styles.label}>Asr madhab</Text>
      <View style={styles.segmentRow}>
        {(['standard', 'hanafi'] as AsrMadhab[]).map((m) => (
          <Pressable
            key={m}
            style={[styles.segment, asrMadhab === m && styles.segmentActive]}
            onPress={() => setAsrMadhab(m)}
            testID={`asr-${m}`}>
            <Text style={[styles.segmentText, asrMadhab === m && styles.segmentTextActive]}>
              {m === 'standard' ? 'Standard' : 'Hanafi'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.row, { justifyContent: 'space-between', marginTop: spacing(2) }]}>
        <Text style={styles.inlineLabel}>Vibrate at each prayer</Text>
        <Switch value={alertsEnabled} onValueChange={setAlertsEnabled} trackColor={{ true: colors.accent }} />
      </View>

      <Text style={styles.label}>Location</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={latText}
          onChangeText={setLatText}
          placeholder="Latitude"
          placeholderTextColor={colors.textDim}
          keyboardType="numbers-and-punctuation"
          testID="prayer-lat"
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={lonText}
          onChangeText={setLonText}
          placeholder="Longitude"
          placeholderTextColor={colors.textDim}
          keyboardType="numbers-and-punctuation"
          testID="prayer-lon"
        />
      </View>
      <Pressable style={styles.gpsButton} onPress={useGps} disabled={busy !== null} testID="use-gps">
        <Text style={styles.gpsButtonText}>{busy === 'GPS' ? 'Locating…' : 'Use phone location'}</Text>
      </Pressable>

      <Text style={styles.label}>UTC offset (prayer math needs it; synced from this phone)</Text>
      <View style={styles.row}>
        <Pressable style={styles.stepButton} onPress={() => setUtcQuarters((q) => Math.max(-48, q - 1))} testID="utc-minus">
          <Text style={styles.stepButtonText}>{'−'}</Text>
        </Pressable>
        <Text style={styles.offsetValue}>{formatOffset(utcQuarters)}</Text>
        <Pressable style={styles.stepButton} onPress={() => setUtcQuarters((q) => Math.min(56, q + 1))} testID="utc-plus">
          <Text style={styles.stepButtonText}>+</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Today at this location (what the watch will show)</Text>
      {!preview ? (
        <Text style={styles.previewNone}>{typeof settingsOrNull === 'string' ? settingsOrNull : 'n/a'}</Text>
      ) : (
        PRAYERS.map((p) => {
          const m = preview.minutes[p];
          const highlight = p === nextPrayer;
          return (
            <View key={p} style={styles.previewRow}>
              <Text style={[styles.preview, highlight && styles.previewNext]}>{PRAYER_LABELS[p]}</Text>
              <Text style={[styles.preview, highlight && styles.previewNext]}>
                {m === undefined ? '--:--' : `${preview.estimated[p] ? '~' : ''}${formatMinutes(m)}`}
              </Text>
            </View>
          );
        })
      )}

      <Pressable
        style={[styles.applyButton, (!valid || busy !== null) && { opacity: 0.5 }]}
        onPress={apply}
        disabled={!valid || busy !== null}
        testID="apply-prayer">
        <Text style={styles.applyText}>{busy === 'Apply' ? 'Applying…' : 'Apply to watch'}</Text>
      </Pressable>
      <Pressable style={styles.readButton} onPress={readFromWatch} disabled={busy !== null} testID="read-prayer">
        <Text style={styles.readText}>{busy === 'Read' ? 'Reading…' : 'Read from watch'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  label: { color: colors.textDim, marginTop: spacing(2), marginBottom: spacing(1), fontSize: 13, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  inlineLabel: { color: colors.text, fontSize: 15 },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 10, paddingHorizontal: spacing(2), height: 48 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: spacing(1.5),
    marginBottom: spacing(0.5),
  },
  radioRowActive: { backgroundColor: '#24467a33', borderColor: colors.accent, borderWidth: 1 },
  radioDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.textDim, marginRight: spacing(1.5) },
  radioDotActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  radioText: { color: colors.textDim, fontSize: 14, flex: 1 },
  radioTextActive: { color: colors.text },
  segmentRow: { flexDirection: 'row', gap: spacing(0.5), flexWrap: 'wrap' },
  segment: { backgroundColor: colors.card, borderRadius: 8, paddingVertical: spacing(1), paddingHorizontal: spacing(1.5) },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textDim, fontSize: 14 },
  segmentTextActive: { color: '#fff', fontWeight: '700' },
  gpsButton: {
    backgroundColor: colors.card,
    borderRadius: 10,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing(1),
  },
  gpsButtonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  stepButton: { backgroundColor: colors.card, borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepButtonText: { color: colors.accent, fontSize: 24, fontWeight: '700' },
  offsetValue: { color: colors.text, fontSize: 20, minWidth: 90, textAlign: 'center', fontVariant: ['tabular-nums'] },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  preview: { color: colors.text, fontSize: 15 },
  previewNext: { color: colors.accent, fontWeight: '700' },
  previewNone: { color: colors.warn, fontSize: 14 },
  applyButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing(3),
  },
  applyText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  readButton: { alignItems: 'center', justifyContent: 'center', height: 44, marginTop: spacing(1) },
  readText: { color: colors.textDim, fontSize: 15 },
});
