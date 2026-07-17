// Web/desktop app root: watch management + beacon key handling only. The three
// Apple Find My screens (AppleLogin, FindMyMap, FindMySettings) are cut at the
// bundler level — FindMyMapScreen statically imports the native MapLibre module,
// so those screens must never enter the web module graph. RootStackParamList is
// shared unchanged (the extra route types erase at compile time).

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './src/navigation';
import { WatchListScreen } from './src/screens/WatchListScreen';
import { WatchDetailScreen } from './src/screens/WatchDetailScreen';
import { EventEditScreen } from './src/screens/EventEditScreen';
import { ScheduleScreen } from './src/screens/ScheduleScreen';
import { WatchPairScreen } from './src/screens/WatchPairScreen';
import { PrayerSettingsScreen } from './src/screens/PrayerSettingsScreen';
import { AlarmsScreen } from './src/screens/AlarmsScreen';
import { BeaconScreen } from './src/screens/BeaconScreen';
import { UpdateScreen } from './src/screens/UpdateScreen';
import { WatchStoreContext } from './src/storage/store';
import { navTheme, stackScreenOptions, useAppBootstrap } from './src/app/useAppBootstrap';
import { DesktopBlePicker } from './src/ui/DesktopBlePicker.web';
import { DesktopBlePairingPrompt } from './src/ui/DesktopBlePairingPrompt.web';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { loaded, store } = useAppBootstrap();

  if (!loaded) {
    return null;
  }

  return (
    <WatchStoreContext.Provider value={store}>
      <NavigationContainer theme={navTheme}>
        <StatusBar style="light" />
        <Stack.Navigator screenOptions={stackScreenOptions}>
          <Stack.Screen name="WatchList" component={WatchListScreen} options={{ title: 'PineTime Companion' }} />
          <Stack.Screen name="WatchDetail" component={WatchDetailScreen} options={{ title: 'Watch' }} />
          <Stack.Screen name="Schedule" component={ScheduleScreen} options={{ title: 'Schedule' }} />
          <Stack.Screen name="EventEdit" component={EventEditScreen} options={{ title: 'Event' }} />
          <Stack.Screen name="WatchPair" component={WatchPairScreen} options={{ title: 'Pair watch' }} />
          <Stack.Screen name="PrayerSettings" component={PrayerSettingsScreen} options={{ title: 'Prayer times' }} />
          <Stack.Screen name="Alarms" component={AlarmsScreen} options={{ title: 'Alarms' }} />
          <Stack.Screen name="Beacon" component={BeaconScreen} options={{ title: 'Find My' }} />
          <Stack.Screen name="Update" component={UpdateScreen} options={{ title: 'Update watch' }} />
        </Stack.Navigator>
        {/* Electron-only Bluetooth overlays; self-disable in plain browsers. */}
        <DesktopBlePicker />
        <DesktopBlePairingPrompt />
      </NavigationContainer>
    </WatchStoreContext.Provider>
  );
}
