import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Camera, type CameraRef, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import circle from '@turf/circle';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { LocationFix } from '../findmy/decrypt';
import { getWatchLocations } from '../findmy/track';
import { UnauthorizedError } from '../findmy/fetch';
import { AppleSession, loadSession } from '../findmy/apple/session';
import { getFixes } from '../storage/locationStore';
import { DEFAULT_MAP_STYLE_URL, getFindMySettings } from '../storage/findMySettings';

type Props = NativeStackScreenProps<RootStackParamList, 'FindMyMap'>;

const BATTERY_LABEL = ['Full', 'Medium', 'Low', 'Critical'];
const RECENTER_ZOOM = 16;
// Neutral world view for when there's no watch location yet — the map still renders.
const DEFAULT_VIEW = { center: [0, 20] as [number, number], zoom: 1.4 };
const PHONE_BLUE = '#3b82f6';

function relativeTime(unixSeconds: number): string {
  const secs = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (secs < 90) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  return `${Math.round(secs / 86400)} d ago`;
}

export function FindMyMapScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { watches } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const [fixes, setFixes] = useState<LocationFix[]>([]);
  const [session, setSession] = useState<AppleSession | null>(null);
  const [styleUrl, setStyleUrl] = useState(DEFAULT_MAP_STYLE_URL);
  const [phone, setPhone] = useState<{ lon: number; lat: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cameraRef = useRef<CameraRef>(null);

  useEffect(() => {
    getFindMySettings().then((s) => setStyleUrl(s.mapStyleUrl));
    loadSession().then(setSession);
    if (watch) {
      getFixes(watch.id).then(setFixes);
    }
  }, [watch]);

  const last = fixes.length ? fixes[fixes.length - 1] : null;

  const trail = useMemo(
    () => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: fixes.map((f) => [f.lon, f.lat]) },
      properties: {},
    }),
    [fixes],
  );

  const accuracyCircle = useMemo(
    () => (last ? circle([last.lon, last.lat], Math.max(last.accuracy, 5), { units: 'meters' }) : null),
    [last],
  );

  // Snap the camera back to the last-known watch pin — purely local, no network.
  const recenterWatch = () => {
    if (last) {
      cameraRef.current?.easeTo({ center: [last.lon, last.lat], zoom: RECENTER_ZOOM, duration: 400 });
    }
  };

  // Center on the PHONE's own GPS location (device location permission).
  const locateMe = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Allow location access to center the map on your phone.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const p = { lon: pos.coords.longitude, lat: pos.coords.latitude };
      setPhone(p);
      cameraRef.current?.easeTo({ center: [p.lon, p.lat], zoom: RECENTER_ZOOM, duration: 500 });
    } catch (e) {
      Alert.alert('Could not get your location', (e as Error).message);
    } finally {
      setLocating(false);
    }
  };

  const refresh = async () => {
    if (!watch) return;
    if (!session) {
      setError('Sign in to Apple first (on the Find My screen).');
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const settings = await getFindMySettings();
      const result = await getWatchLocations(watch, session, settings.anisetteServers);
      setFixes(result.fixes);
      const newest = result.fixes[result.fixes.length - 1];
      if (newest) {
        cameraRef.current?.easeTo({ center: [newest.lon, newest.lat], zoom: RECENTER_ZOOM, duration: 500 });
      }
      setNote(
        result.fixes.length
          ? `${result.reportsFetched} report(s) fetched`
          : 'No location reports yet — keep Find My on near iPhones for 15–60 min.',
      );
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        setSession(null);
        setError('Apple session expired — sign in again on the Find My screen.');
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!watch) {
    return null;
  }

  const initialCenter = last ? { center: [last.lon, last.lat] as [number, number], zoom: RECENTER_ZOOM } : DEFAULT_VIEW;

  return (
    <View style={styles.container}>
      <View style={styles.mapArea}>
        <Map style={styles.map} mapStyle={styleUrl}>
          <Camera ref={cameraRef} initialViewState={initialCenter} />
          {accuracyCircle && (
            <GeoJSONSource id="accuracy" data={accuracyCircle as any}>
              <Layer id="accuracy-fill" type="fill" paint={{ 'fill-color': colors.accent, 'fill-opacity': 0.15 }} />
            </GeoJSONSource>
          )}
          {fixes.length > 1 && (
            <GeoJSONSource id="trail" data={trail as any}>
              <Layer id="trail-line" type="line" paint={{ 'line-color': colors.accent, 'line-width': 3, 'line-opacity': 0.8 }} />
            </GeoJSONSource>
          )}
          {last && (
            <Marker id="last" lngLat={[last.lon, last.lat]}>
              <View style={styles.pin} />
            </Marker>
          )}
          {phone && (
            <Marker id="phone" lngLat={[phone.lon, phone.lat]}>
              <View style={styles.phonePin} />
            </Marker>
          )}
        </Map>

        <View style={[styles.overlay, { paddingTop: insets.top + spacing(1) }]} pointerEvents="box-none">
          {last ? (
            <View style={styles.badge}>
              <Text style={styles.badgeTitle}>Last seen {relativeTime(last.timestamp)}</Text>
              <Text style={styles.badgeBody}>
                ±{last.accuracy} m · Battery: {BATTERY_LABEL[last.battery] ?? '—'}
              </Text>
            </View>
          ) : (
            <View style={styles.badge}>
              <Text style={styles.badgeBody}>No watch location yet — sign in and refresh, or wait for the watch to be seen.</Text>
            </View>
          )}
        </View>

        <View style={styles.fabColumn}>
          <Pressable style={styles.fab} onPress={locateMe} disabled={locating} testID="map-locate-me" hitSlop={8}>
            {locating ? <ActivityIndicator color={PHONE_BLUE} /> : <Text style={[styles.fabGlyph, { color: PHONE_BLUE }]}>◉</Text>}
          </Pressable>
          {last && (
            <Pressable style={styles.fab} onPress={recenterWatch} testID="map-recenter" hitSlop={8}>
              <Text style={[styles.fabGlyph, { color: colors.accent }]}>◎</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing(1) }]}>
        {error && <Text style={styles.error}>{error}</Text>}
        {note && !error && <Text style={styles.note}>{note}</Text>}
        <Pressable style={[styles.button, busy && { opacity: 0.6 }]} onPress={refresh} disabled={busy} testID="map-refresh">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Refresh location</Text>}
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => navigation.navigate('FindMySettings')}>
          <Text style={styles.secondaryText}>Map & server settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapArea: { flex: 1 },
  map: { flex: 1 },
  fabColumn: { position: 'absolute', right: spacing(2), bottom: spacing(2), gap: spacing(1) },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(16,20,24,0.9)',
    borderWidth: 1,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlyph: { fontSize: 26, lineHeight: 28 },
  pin: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent, borderWidth: 3, borderColor: '#fff' },
  phonePin: { width: 18, height: 18, borderRadius: 9, backgroundColor: PHONE_BLUE, borderWidth: 3, borderColor: '#fff' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingHorizontal: spacing(2) },
  badge: { backgroundColor: 'rgba(16,20,24,0.85)', borderRadius: 10, paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
  badgeTitle: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  badgeBody: { color: colors.textDim, fontSize: 13, marginTop: 2, textAlign: 'center' },
  footer: { padding: spacing(2), backgroundColor: colors.background },
  error: { color: colors.danger, marginBottom: spacing(1), fontSize: 14 },
  note: { color: colors.textDim, marginBottom: spacing(1), fontSize: 13 },
  button: { backgroundColor: colors.accent, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { height: 42, alignItems: 'center', justifyContent: 'center', marginTop: spacing(0.5) },
  secondaryText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});
