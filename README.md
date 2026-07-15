# PineTime Companion

Companion app for PineTime watches running [our InfiniTime fork](../InfiniTime)
(branch `scheduler`). Create named watches, build each one a schedule of recurring
events (once / every-N-days / weekly / monthly), and sync over the InfiniTime
Schedule Service. Also: turn a watch into a Find My / OpenHaystack beacon and
**locate it in-app on a map** (see below); configure per-watch
Islamic prayer times (calculation
method, Asr madhab, location via phone GPS or manual entry, UTC offset, alerts)
that the watch then computes locally and vibrates for; set the watch clock, read
battery, send a message that pops up as a notification on the watch.

Stack: Expo + React Native + TypeScript (same toolchain as tajweed-bytes).

## Targets

One codebase, four distributables (all built by CI on release — see
[Releases](#releases)):

| Target | BLE path | Feature set |
|---|---|---|
| **Android APK** | `react-native-ble-plx` | everything (incl. Apple Find My login + map) |
| **Windows / Linux / macOS desktop** (Electron, standalone) | Web Bluetooth (bundled Chromium) | watch management + beacon key generate/provision/export |
| **Web bundle** (Chrome/Edge) | Web Bluetooth | same as desktop |

The Apple Find My tracking + map are mobile-only: browsers block the Apple
endpoints (CORS) and the map module is native. The `.keys` export works
everywhere, so a watch provisioned from the desktop can be tracked with any
macless-haystack setup (or the Android app).

Platform splitting is bundler-level: `App.web.tsx` registers only the
web-scoped screens, and `.web.ts` siblings swap the seams
(`transportFactory`, `secrets`, `pairScan`, `alert`, `exportText`). The
transport seam (`src/ble/transport.ts`) means everything above it is
platform-agnostic; web adds `wsTransport` (sim dev) and
`webBluetoothTransport` (real watches, structural mirror of
`bleTransport.ts`).

## Find My (locate a watch)

The Find My section (open a watch → Find My) turns the watch into an OpenHaystack
beacon and then shows its crowd-sourced location on a map — no external
macless-haystack server needed:

1. **Generate a key** — a P-224 keypair on the phone; the private key goes to the
   OS keystore (`expo-secure-store`), never the plaintext store.
2. **Provision to watch** — writes the 28-byte advertisement key over BLE.
3. **Turn on Find My** — the watch drops the connection, goes non-connectable, and
   broadcasts. (Off is only reachable on the watch — Settings → Find My.)
4. **Sign in to Apple** — with a **burner Apple Account that uses SMS 2FA** (see the
   warning in-app). It must also have been signed into iCloud + Find My on a real
   Apple device once; a brand-new account is not activated and Apple rejects the
   iCloud login with "Account limit reached". Login runs entirely in TypeScript
   against public anisette-v3 servers (no native anisette): SRP-6a GrandSlam + SMS
   2FA + the search-party token. The session persists in the keystore and the
   device identity is stable, so you sign in (and do 2FA) rarely.
5. **View location on map** — fetches Apple's encrypted reports for the watch's key,
   decrypts them on-device (P-224 ECDH + AES-GCM), and draws the last-known point,
   a history trail, and an accuracy circle on OpenStreetMap tiles (MapLibre +
   OpenFreeMap by default; both the tile style URL and the anisette servers are
   overridable under "Map & server settings"). Export `.keys` is still there for
   using your own macless-haystack server instead.

The report crypto and the SRP login are locked by golden-vector tests
(`src/findmy/decrypt.test.ts`, `src/findmy/apple/srp.test.ts`). Actual beacon
advertising and network pickup are hardware-only; the fetch/decrypt/map path is
testable against any key already seeded into Apple's network.

## Development (no hardware needed)

The whole app runs against InfiniSim through its TCP GATT bridge:

```sh
# 1. watch simulator (from pinetime-dev-tools/) — bridge listens on 18632
./simctl.py start

# 2. this app on the Android emulator (tb_emu)
npm install
npx expo run:android          # first build/install of the dev client
npm run android:emu           # start Metro + open the app (use this for the day-to-day loop)

# 3. in the app: add a watch -> Pair -> "Use simulator"
```

**Dev-server note (important):** `adb reverse` is unreliable on the tb_emu emulator, so
the default `expo run:android` flow (which points the app at `localhost:8081` via reverse)
can get stuck on "Unable to load script". `npm run android:emu` (`scripts/dev-emu.sh`)
works around it by pointing both Metro and the dev client at `10.0.2.2` (the emulator's
host alias), which always works. This also depends on the network-security-config in
`plugins/withAppleRootCA.js` permitting cleartext to `10.0.2.2`/`localhost` — without that,
the plain-HTTP Metro connection is blocked. If the loop ever breaks, a cold boot of the
emulator (`-no-snapshot -wipe-data`) restores a clean state.

The emulator reaches the host's bridge at `10.0.2.2:18632`. Every protocol byte and
firmware code path is identical to real BLE; only the radio is replaced by TCP
(`src/ble/tcpTransport.ts` vs `src/ble/bleTransport.ts`, selected per watch by
device-id shape in `src/ble/transportFactory.ts`).

### Web + desktop against the simulator

Browsers can't open raw TCP, so the web/desktop builds reach the sim through a
WebSocket proxy:

```sh
# sim running as above, then:
npm run sim:proxy      # ws://localhost:18633 <-> tcp 18632
npm run web            # expo web dev server -> open in Chrome, pair "Use simulator"

# Electron dev (fast refresh; loads Metro):
npx expo start --port 8081 &
npm run desktop:dev    # needs: npm --prefix desktop install (once)

# closed-loop regressions (headless Chrome / Electron driving the real bundle
# against the live sim — pair, sync, set time, battery):
npm run web:export && npm run web:e2e
npm run desktop:export && npm run desktop:e2e

# standalone desktop build for this machine:
npm run desktop:build:linux    # -> desktop/release/*.AppImage
```

Headless-box note: if Electron exits with SIGTRAP, run it with
`--no-sandbox` (the e2e scripts already do) — the SUID sandbox needs
unprivileged user namespaces, which some kernels disable.

## Tests

```sh
npm test        # protocol golden vectors (doc/ScheduleService.md) via node --test
npx tsc --noEmit
```

`pinetime-dev-tools/bridge-test.mjs` is the cross-stack protocol regression against a live
simulator.

## Real watches

Pair via "Scan for real watches" (needs Bluetooth permissions; the watch advertises
as InfiniTime). The BLE path (`bleTransport.ts`) is deliberately logic-free and is
the only code that can't run in the emulator. Firmware updates (Nordic Legacy DFU)
are not in the app yet — use nRF Connect per watch until hardware is available to
integrate and verify `react-native-nordic-dfu` (settings: `disableMtuRequest`,
`keepBond`; the release zip carries manifest + bin + dat).

On web/desktop the same button opens the Bluetooth chooser
(`pairScan.web.ts` → `requestDevice`); in Electron the app's own picker
overlay appears, and on Windows/Linux a passkey prompt handles InfiniTime's
6-digit pairing (macOS pairing is OS-handled). Hardware-untested until a
watch exists: the Web Bluetooth GATT path itself, the passkey flow, and the
512-byte long-write assumption (`webBluetoothTransport.requestMtu`).

## Releases

`gh release create vX.Y.Z` (or publish one in the UI) triggers
`.github/workflows/release.yml`, which attaches every distributable to the
release: per-ABI Android APKs, Linux AppImage, Windows installer + portable
exe, macOS dmg, and the web bundle zip. Re-run for an existing tag with the
workflow's manual dispatch. Nothing runs on push/PR.

No signing anywhere: APKs use the RN debug keystore (prebuild regenerates the
same key, so CI and local builds upgrade-install over each other); desktop
builds are unsigned — macOS users right-click → Open past Gatekeeper (or
`xattr -dr com.apple.quarantine <app>`), Windows users click through
SmartScreen. In-browser reconnects re-show the device chooser once per
session (Chrome gates silent re-grant behind a flag); the Electron shell
auto-reconnects.

## Architecture

- `src/model/` — types + recurrence math (TS twin of the firmware's `ScheduleRules.h`,
  drives the "next occurrences" preview in the event editor)
- `src/ble/scheduleProtocol.ts` — byte-level encoders for the Schedule Service
- `src/ble/syncManager.ts` — transport-agnostic sync (full-replace transaction with
  digest verification) + companion functions (CTS time, New Alert message, battery)
- `src/storage/store.ts` — AsyncStorage-persisted watch list
- `src/screens/` — WatchList, WatchDetail, EventEdit, WatchPair
