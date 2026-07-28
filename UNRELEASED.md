# Unreleased

Notes to fold into the next release's **## Changes** section, then empty this
file. `scripts/release.sh` prints it when you cut a release.

First release driven by real-hardware use.

**Fixed**

- **Firmware updates no longer report a failure when they succeed.** The final
  DFU step was written with-response, but the watch resets the instant it
  arrives and can never acknowledge it — so every successful update raised
  `Characteristic 00001531-… write failed`. That error also skipped the prompt
  to tap **Validate** on the watch, and an unvalidated image reverts on the next
  reboot.
- Failures elsewhere in an update now name the step they came from instead of
  showing a bare GATT message.

**Times and dates**

- All times follow the phone's own 12/24-hour setting — Android's system
  toggle, not the locale (they disagree once you override it). The watch keeps
  its own Settings → Time format; neither device mirrors the other.
- Time and date entry use real pickers. The alarm editor's paired text boxes and
  the event editor's steppers and free-text `YYYY-MM-DD` field are gone, along
  with the invalid values they allowed.

**Clearer UI**

- Progress is shown for Bluetooth work that isn't instant. Reading the firmware
  version — a connect/read/disconnect that could sit silent for seconds — now
  shows a spinner and says why it failed rather than a bare dash.
- Gestures that had no affordance are now labelled: the schedule never mentioned
  that press-and-hold deletes.
- Daily tasks reorder by dragging a handle instead of arrow buttons.
- "Changes not synced" names the feature, and the watch screen marks which ones.
- The Notifications screen explains what it can't show: incoming calls work
  without picking a phone app (missed calls and voicemail don't), and now-playing
  needs only Notification Access. Android 13+ hides that permission for
  sideloaded apps behind a "Restricted setting" dialog — the app now deep-links
  to the right page and spells out the unlock.
