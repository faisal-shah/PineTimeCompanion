import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './src/navigation';
import { WatchListScreen } from './src/screens/WatchListScreen';
import { WatchDetailScreen } from './src/screens/WatchDetailScreen';
import { EventEditScreen } from './src/screens/EventEditScreen';
import { WatchPairScreen } from './src/screens/WatchPairScreen';
import { PrayerSettingsScreen } from './src/screens/PrayerSettingsScreen';
import { AlarmsScreen } from './src/screens/AlarmsScreen';
import { BeaconScreen } from './src/screens/BeaconScreen';
import { AppleLoginScreen } from './src/screens/AppleLoginScreen';
import { FindMyMapScreen } from './src/screens/FindMyMapScreen';
import { FindMySettingsScreen } from './src/screens/FindMySettingsScreen';
import { WatchStoreContext } from './src/storage/store';
import { navTheme, stackScreenOptions, useAppBootstrap } from './src/app/useAppBootstrap';

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
          <Stack.Screen name="EventEdit" component={EventEditScreen} options={{ title: 'Event' }} />
          <Stack.Screen name="WatchPair" component={WatchPairScreen} options={{ title: 'Pair watch' }} />
          <Stack.Screen name="PrayerSettings" component={PrayerSettingsScreen} options={{ title: 'Prayer times' }} />
          <Stack.Screen name="Alarms" component={AlarmsScreen} options={{ title: 'Alarms' }} />
          <Stack.Screen name="Beacon" component={BeaconScreen} options={{ title: 'Find My' }} />
          <Stack.Screen name="AppleLogin" component={AppleLoginScreen} options={{ title: 'Apple sign-in' }} />
          <Stack.Screen name="FindMyMap" component={FindMyMapScreen} options={{ title: 'Location' }} />
          <Stack.Screen name="FindMySettings" component={FindMySettingsScreen} options={{ title: 'Find My settings' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </WatchStoreContext.Provider>
  );
}
