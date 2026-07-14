import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

// Height of the on-screen keyboard in dp, or 0 when hidden.
//
// This app is edge-to-edge, so the Android window never resizes when the
// keyboard opens and KeyboardAvoidingView cannot lift content on its own. We
// track the keyboard frame directly instead. endCoordinates.height measures
// from the bottom of the screen to the top of the keyboard, already spanning
// the system navigation bar, so a bottom bar clears the keyboard by lifting
// exactly this much (and by the bottom safe-area inset when it is 0).
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
