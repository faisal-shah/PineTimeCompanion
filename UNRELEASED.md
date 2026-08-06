# Unreleased

Notes to fold into the next release's **## Changes** section, then empty this
file. `scripts/release.sh` prints it when you cut a release.

- Firmware and resource downloads no longer fail intermittently on Android with
  `java.nio.BufferOverflowException`. Expo SDK 57's native fetch finalizes its
  response sink without synchronizing the chunk queue (expo/expo#47762): it
  sizes a buffer from the queue and then fills it from that same queue, so a
  chunk arriving in between overflows it. Native downloads now take the
  completed one-shot `arrayBuffer()` path and never touch `response.body` at
  all — reading the property is itself what starts the racy streaming state
  machine. The web keeps incremental streamed progress; native reports a single
  completion tick.
- The **Repair pairing** action label is centred when it wraps. The button's
  `alignItems` only centres the Text box, so once a wrapped label filled the
  button width its text fell back to left alignment while its one-line
  neighbours stayed centred.
