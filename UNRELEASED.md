# Unreleased

Notes to fold into the next release's **## Changes** section, then empty this
file. `scripts/release.sh` prints it when you cut a release.

- Firmware flashing and resource uploads now request a low-latency BLE
  connection, which is the main lever on transfer speed on Android.
- The version footer shows the build date, so a cached page is
  distinguishable from a stale deploy.
