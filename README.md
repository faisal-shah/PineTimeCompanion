# PineTime Companion

Android companion app for PineTime watches running [our InfiniTime fork](../InfiniTime)
(branch `scheduler`). Create named watches, build each one a schedule of recurring
events (once / every-N-days / weekly / monthly), and sync over the InfiniTime
Schedule Service. Also: turn a watch into a Find My / OpenHaystack beacon and
**locate it in-app on a map** (see below); configure per-watch
Islamic prayer times (calculation
method, Asr madhab, location via phone GPS or manual entry, UTC offset, alerts)
that the watch then computes locally and vibrates for; set the watch clock, read
battery, send a message that pops up as a notification on the watch.

Stack: Expo + React Native + TypeScript (same toolchain as tajweed-bytes).

## Find My (locate a watch)

The Find My section (open a watch → Find My) turns the watch into an OpenHaystack
beacon and then shows its crowd-sourced location on a map — no external
macless-haystack server needed:

1. **Generate a key** — a P-224 keypair on the phone; the private key goes to the
   OS keystore (`expo-secure-store`), never the plaintext store.
2. **Provision to watch** — writes the 28-byte advertisement key over BLE.
3. **Turn on Find My** — the watch drops the connection, goes non-connectable, and
   broadcasts. (Off is only reachable on the watch — Settings → Find My.)
4. **Sign in to Apple** — with a **burner Apple ID that uses SMS 2FA** (see the
   warning in-app). Login runs entirely in TypeScript against public anisette-v3
   servers (no native anisette): SRP-6a GrandSlam + SMS 2FA + the search-party
   token. The session persists in the keystore and the device identity is stable,
   so you sign in (and do 2FA) rarely.
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
npx expo run:android          # or: npx expo start + a previously installed dev build

# 3. in the app: add a watch -> Pair -> "Use simulator"
```

The emulator reaches the host's bridge at `10.0.2.2:18632`. Every protocol byte and
firmware code path is identical to real BLE; only the radio is replaced by TCP
(`src/ble/tcpTransport.ts` vs `src/ble/bleTransport.ts`, selected per watch by
device-id shape in `src/ble/transportFactory.ts`).

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

## Architecture

- `src/model/` — types + recurrence math (TS twin of the firmware's `ScheduleRules.h`,
  drives the "next occurrences" preview in the event editor)
- `src/ble/scheduleProtocol.ts` — byte-level encoders for the Schedule Service
- `src/ble/syncManager.ts` — transport-agnostic sync (full-replace transaction with
  digest verification) + companion functions (CTS time, New Alert message, battery)
- `src/storage/store.ts` — AsyncStorage-persisted watch list
- `src/screens/` — WatchList, WatchDetail, EventEdit, WatchPair
