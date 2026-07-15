// Polyfill global.crypto.getRandomValues so `elliptic` (Find My key generation)
// has a secure RNG on device. Must be imported before anything that generates keys.
import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
