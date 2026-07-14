# PineTime Companion

Android companion app for PineTime watches running [our InfiniTime fork](../InfiniTime)
(branch `scheduler`). Create named watches, build each one a schedule of recurring
events (once / every-N-days / weekly / monthly), and sync over the InfiniTime
Schedule Service. Also: set the watch clock, read battery, send a message that pops
up as a notification on the watch.

Stack: Expo + React Native + TypeScript (same toolchain as tajweed-bytes).

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
