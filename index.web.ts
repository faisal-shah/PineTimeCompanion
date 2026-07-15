// Web entry: browsers ship crypto.getRandomValues natively, so the
// react-native-get-random-values shim (a native module) must not load here.
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
