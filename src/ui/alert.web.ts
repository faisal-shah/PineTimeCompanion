// Web implementation of the alert seam: window.alert for notices,
// window.confirm for button dialogs. RN alert convention puts the affirmative
// button last, so OK maps to the LAST non-cancel button; dismissing fires the
// explicit cancel-style button if there is one, else nothing. When several
// actions exist (rare), the prompt names the one OK will run. Works identically
// in plain Chrome and the Electron shell.

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  let text = message ? `${title}\n\n${message}` : title;
  const actions = (buttons ?? []).filter((b) => b.style !== 'cancel');
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    actions[0]?.onPress?.();
    return;
  }
  const affirmative = actions[actions.length - 1];
  const cancel = buttons.find((b) => b.style === 'cancel');
  if (actions.length > 1 && affirmative) {
    text += `\n\nOK = ${affirmative.text}`;
  }
  if (window.confirm(text)) {
    affirmative?.onPress?.();
  } else {
    cancel?.onPress?.();
  }
}
