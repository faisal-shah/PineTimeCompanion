#!/usr/bin/env bash
# Robust Android-emulator dev loop for this project.
#
# Why this exists: `adb reverse` is unreliable on this emulator (the rule lists
# but silently doesn't forward), so the usual "expo run:android" flow — which
# points the app at localhost:8081 and relies on adb reverse — leaves the app
# stuck on "Unable to load script". The emulator's host alias 10.0.2.2 always
# works, so we point Metro AND the dev client at 10.0.2.2 instead.
#
# Also required (already handled in plugins/withAppleRootCA.js): the app's
# network-security-config must permit cleartext to 10.0.2.2/localhost, or the
# plain-HTTP Metro connection is blocked ("CLEARTEXT communication ... not
# permitted").
#
# Usage:
#   ./scripts/dev-emu.sh          # start Metro (if needed) + open the app on the emulator
# Then edit code — Fast Refresh works. The app remembers the 10.0.2.2 URL across
# relaunches, so subsequent normal launches reconnect automatically.
set -euo pipefail

PKG="dev.faisal.pinetimecompanion"
SCHEME="pinetimecompanion"
PORT="8081"
DEV_URL="http://10.0.2.2:${PORT}"

cd "$(dirname "$0")/.."

if ! adb get-state >/dev/null 2>&1; then
  echo "No device/emulator. Start the tb_emu AVD first (a cold boot restores a clean state)." >&2
  exit 1
fi

# Start Metro advertising 10.0.2.2 if it isn't already serving.
if ! curl -s "http://localhost:${PORT}/status" >/dev/null 2>&1; then
  echo "Starting Metro (advertising 10.0.2.2)…"
  REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2 nohup npx expo start --dev-client --port "${PORT}" \
    > /tmp/pinetime-metro.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -s "http://localhost:${PORT}/status" >/dev/null 2>&1 && break
    sleep 1
  done
fi
echo "Metro: $(curl -s "http://localhost:${PORT}/status" || echo 'not up')"

# Open the dev client pointed explicitly at 10.0.2.2 (bypasses the broken reverse).
adb shell am start -a android.intent.action.VIEW \
  -d "${SCHEME}://expo-development-client/?url=${DEV_URL//:/%3A}" >/dev/null 2>&1 || \
  adb shell am start -a android.intent.action.VIEW \
  -d "${SCHEME}://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A${PORT}" >/dev/null 2>&1
echo "Opened ${PKG} on the emulator at ${DEV_URL}."
