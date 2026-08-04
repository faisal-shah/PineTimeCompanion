// Promise wrapper over the callback-based alert seam, for flows that must await
// a user's yes/no before continuing (the pairing eviction confirmation, the
// legacy-pairing confirmation). Resolves true for the affirmative button, false
// for cancel or dismissal. Works over both the native Alert and the web
// window.confirm implementations of showAlert.

import { showAlert } from './alert';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Affirmative button label (defaults to "OK"). */
  confirmLabel?: string;
  /** Cancel button label (defaults to "Cancel"). */
  cancelLabel?: string;
  /** Render the affirmative button as destructive (red). */
  destructive?: boolean;
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    showAlert(opts.title, opts.message, [
      { text: opts.cancelLabel ?? 'Cancel', style: 'cancel', onPress: () => done(false) },
      {
        text: opts.confirmLabel ?? 'OK',
        style: opts.destructive ? 'destructive' : 'default',
        onPress: () => done(true),
      },
    ]);
  });
}
