import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './src/navigation';
import { WatchListScreen } from './src/screens/WatchListScreen';
import { WatchDetailScreen } from './src/screens/WatchDetailScreen';
import { EventEditScreen } from './src/screens/EventEditScreen';
import { WatchPairScreen } from './src/screens/WatchPairScreen';
import { PrayerSettingsScreen } from './src/screens/PrayerSettingsScreen';
import { BeaconScreen } from './src/screens/BeaconScreen';
import { loadWatches, saveWatches, WatchStore, WatchStoreContext } from './src/storage/store';
import { Watch } from './src/model/types';
import { colors } from './src/ui/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.background, card: colors.card, primary: colors.accent, text: colors.text },
};

export default function App() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadWatches().then((w) => {
      setWatches(w);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) {
      saveWatches(watches).catch(() => undefined);
    }
  }, [watches, loaded]);

  const upsertWatch = useCallback((watch: Watch) => {
    setWatches((prev) => {
      const i = prev.findIndex((w) => w.id === watch.id);
      if (i < 0) {
        return [...prev, watch];
      }
      const next = [...prev];
      next[i] = watch;
      return next;
    });
  }, []);

  const removeWatch = useCallback((id: string) => {
    setWatches((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const store: WatchStore = useMemo(() => ({ watches, upsertWatch, removeWatch }), [watches, upsertWatch, removeWatch]);

  if (!loaded) {
    return null;
  }

  return (
    <WatchStoreContext.Provider value={store}>
      <NavigationContainer theme={theme}>
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.background },
          }}>
          <Stack.Screen name="WatchList" component={WatchListScreen} options={{ title: 'PineTime Companion' }} />
          <Stack.Screen name="WatchDetail" component={WatchDetailScreen} options={{ title: 'Watch' }} />
          <Stack.Screen name="EventEdit" component={EventEditScreen} options={{ title: 'Event' }} />
          <Stack.Screen name="WatchPair" component={WatchPairScreen} options={{ title: 'Pair watch' }} />
          <Stack.Screen name="PrayerSettings" component={PrayerSettingsScreen} options={{ title: 'Prayer times' }} />
          <Stack.Screen name="Beacon" component={BeaconScreen} options={{ title: 'Find My' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </WatchStoreContext.Provider>
  );
}
