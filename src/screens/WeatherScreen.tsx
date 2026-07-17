import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { WeatherIcon } from '../ble/weatherProtocol';
import { pushWeather } from '../weather/pushWeather';
import type { WeatherData } from '../weather/openMeteo';

type Props = NativeStackScreenProps<RootStackParamList, 'Weather'>;

const ICON_EMOJI: Record<number, string> = {
  [WeatherIcon.clear]: '☀️',
  [WeatherIcon.fewClouds]: '🌤️',
  [WeatherIcon.scattered]: '⛅',
  [WeatherIcon.broken]: '☁️',
  [WeatherIcon.shower]: '🌧️',
  [WeatherIcon.rain]: '🌦️',
  [WeatherIcon.thunder]: '⛈️',
  [WeatherIcon.snow]: '❄️',
  [WeatherIcon.mist]: '🌫️',
  [WeatherIcon.unknown]: '❓',
};
const emoji = (icon: number) => ICON_EMOJI[icon] ?? '❓';
const degC = (centi: number) => `${Math.round(centi / 100)}°`;

const dayLabel = (offset: number) => {
  if (offset === 0) return 'Today';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
};

export function WeatherScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const { watches } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);

  const [data, setData] = useState<WeatherData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async () => {
    if (!watch?.deviceId) {
      setError('Pair this watch first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setData(await pushWeather(watch));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [watch]);

  // Refresh + push whenever the screen opens (the "on connect" path).
  useFocusEffect(
    useCallback(() => {
      void update();
    }, [update]),
  );

  if (!watch) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(2), paddingBottom: spacing(2) + insets.bottom }}>
      {data && (
        <View style={styles.currentCard} testID="weather-current">
          <Text style={styles.currentIcon}>{emoji(data.current.icon)}</Text>
          <Text style={styles.currentTemp}>{degC(data.current.temp)}</Text>
          <Text style={styles.currentRange}>
            {degC(data.current.min)} / {degC(data.current.max)}
          </Text>
        </View>
      )}

      {data && (
        <View style={styles.forecastRow}>
          {data.forecast.map((day, i) => (
            <View key={i} style={styles.forecastCol}>
              <Text style={styles.forecastDay}>{dayLabel(i)}</Text>
              <Text style={styles.forecastIcon}>{emoji(day.icon)}</Text>
              <Text style={styles.forecastMax}>{degC(day.max)}</Text>
              <Text style={styles.forecastMin}>{degC(day.min)}</Text>
            </View>
          ))}
        </View>
      )}

      {busy && !data && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing(4) }} />}
      {error && <Text style={styles.error} testID="weather-error">{error}</Text>}

      <Text style={styles.note}>
        Weather is pushed to the watch (its Weather app and watch face) and refreshes each time you open this screen. The
        watch keeps it for 24 hours. Uses this watch&rsquo;s prayer-times location, or your phone&rsquo;s GPS.
      </Text>

      <Pressable style={[styles.button, busy && styles.disabled]} onPress={() => void update()} disabled={busy} testID="weather-update">
        <Text style={styles.buttonText}>{busy ? 'Updating…' : 'Update now'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  currentCard: { backgroundColor: colors.card, borderRadius: 14, padding: spacing(3), alignItems: 'center', marginBottom: spacing(1.5) },
  currentIcon: { fontSize: 52 },
  currentTemp: { color: colors.text, fontSize: 56, fontWeight: '800', marginTop: spacing(0.5) },
  currentRange: { color: colors.textDim, fontSize: 16, marginTop: spacing(0.5) },

  forecastRow: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 14, padding: spacing(1.5), justifyContent: 'space-between' },
  forecastCol: { alignItems: 'center', flex: 1 },
  forecastDay: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  forecastIcon: { fontSize: 26, marginVertical: spacing(0.5) },
  forecastMax: { color: colors.text, fontSize: 15, fontWeight: '700' },
  forecastMin: { color: colors.textDim, fontSize: 13 },

  error: { color: colors.danger, fontSize: 14, marginTop: spacing(2), textAlign: 'center' },
  note: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: spacing(2.5) },
  button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: spacing(1.5), alignItems: 'center', marginTop: spacing(2) },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
