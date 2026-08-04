# Unreleased

Notes to fold into the next release's **## Changes** section, then empty this
file. `scripts/release.sh` prints it when you cut a release.

- Pairing now verifies the watch before saving it. Selecting a scanned watch
  reads its public companion status, then reads an authenticated verify
  characteristic (triggering the OS passkey) and only saves the watch once it
  has proven over an encrypted link that it remembers this phone.
- A watch remembers up to five companion phones; pairing a sixth makes it
  forget the least-recently-used one. When the watch is full, pairing asks for
  explicit confirmation first, and cancelling leaves the app unchanged.
- Renamed **Unpair** to **Remove from app** (it only forgets the watch inside
  this app; the system bond and the watch's data are untouched).
- Replaced the cosmetic **Re-pair** with a real **Repair pairing** flow: it
  reads the watch's public status and explains whether the watch cleared all
  pairings (one-time firmware reset), or dropped this phone as the
  least-recently-used companion, or is merely out of sync — then walks the user
  through forgetting the watch in the system Bluetooth settings and pairing
  again. No hidden Android bond APIs; web/desktop get computer-specific
  instructions.
- WatchDetail shows what currently holds the watch's exclusive BLE link
  (working, in use by forwarding, connecting, reconnecting, or idle), so a
  "busy" failure no longer reads as a reason to re-pair.
- Watch operation errors are now classified (busy, authentication,
  authorization, Bluetooth off, permission, cancelled, firmware access disabled)
  with guidance appropriate to each; a busy watch suggests retry / turning
  forwarding off, never re-pairing.
- Upgrading to the firmware that introduced companion management resets the
  watch's pairings once; pair again afterward.
