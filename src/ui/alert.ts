// Cross-platform alert seam. RN-web ships no Alert implementation, so screens
// call showAlert() instead of Alert.alert(); this native file just delegates.
// Only the shapes actually used in the app are supported: message-only, and
// two-button confirm (cancel + action).

import { Alert } from 'react-native';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  Alert.alert(title, message, buttons);
}
