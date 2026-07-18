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
| **Web app** (Chrome/Edge) — hosted at <https://faisal-shah.github.io/PineTimeCompanion/> | Web Bluetooth | same as desktop |

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
the only code that can't run in the emulator.

On web/desktop the same button opens the Bluetooth chooser
(`pairScan.web.ts` → `requestDevice`); in Electron the app's own picker
overlay appears, and on Windows/Linux a passkey prompt handles InfiniTime's
6-digit pairing (macOS pairing is OS-handled). Hardware-untested until a
watch exists: the Web Bluetooth GATT path itself, the passkey flow, and the
512-byte long-write assumption (`webBluetoothTransport.requestMtu`).

## Updating a watch (OTA)

The **Update** hub feature flashes InfiniTime firmware and pushes the matching
external resources — no nRF Connect needed. It lists releases from a configurable
GitHub repo (default `faisal-shah/InfiniTime`, editable in the screen) and reads
the watch's installed version from the Device Information Service.

Two independent BLE operations make up a full update:

- **Firmware** — Nordic Legacy DFU (`legacyDfu.ts`) over MCUBoot: the 9-step
  handshake streaming the image in **mandatory 20-byte** packets. The watch
  boots the new image **unvalidated**, so the screen shows a card telling the
  user to tap **Settings ▸ Firmware ▸ Validate** on the watch (skipping it rolls
  back on the next reboot), then re-reads the revision to confirm. A CRC failure
  is surfaced by timeout — the firmware sends no notification on a bad image
  (`Reset()` stops the notify timer). Firmware DFU is **native/sim only**: the
  `0x1530` service is on Chromium's Web Bluetooth blocklist, so the screen hides
  it in real browsers and points the user at the Android app.
- **Resources** — the Adafruit BLE filesystem (`fsClient.ts`, FSService
  `0xFEBB`): mkdir the parent dirs, write each file in 235-byte lockstep chunks,
  delete obsolete files. Works on every platform.

Both need **Settings ▸ "Firmware & files"** enabled on the watch (the disabled
state returns insufficient-authorization, which the app translates into a plain
"turn it on" message). The whole flow is exercised headlessly against InfiniSim:
`scripts/dfu-e2e.mjs` (real DFU zip, CRC-validate + corrupt-reject),
`scripts/resources-e2e.mjs` (real resources zip, LISTDIR-verified), and
`scripts/update-e2e.mjs` (the browser Update screen end to end).

Hardware-untested until a watch exists: the real reboot → MCUBoot swap →
on-watch Validate/rollback, real-radio 20-byte/PRN timing over BLE, the
235-byte FS chunk over a negotiated MTU, and the native-only DFU gating (that
real Web Bluetooth genuinely can't reach `0x1530`).

## Notification forwarding (Android)

The **Notifications** hub feature forwards your phone's notifications to the
watch, Gadgetbridge-style, **per watch** — one watch (yours) mirrors your alerts;
the kids' watches stay on parent-composed messages only.

It's Android-only and **fully native** (`modules/notification-forwarder/`, a
local Expo Module in Kotlin): a `NotificationListenerService` captures posts and
a `connectedDevice` foreground service holds a persistent `BluetoothGatt` link
to each forwarding-enabled watch, so it keeps working with the RN app swiped
away. JS only pushes config (per-watch on/off + a global app allowlist + a calls
switch) and reads status; the forwarding runs entirely in the services.

- Notifications write the InfiniTime ANS New Alert char (`0x2A46`, category
  `0xFA` = plain alert); incoming calls use category `0x03` so the watch rings
  and shows the caller with accept/reject/mute (v1: those buttons act on the
  watch only — phone-side call control is a later phase, but the button events
  already flow back over BLE). Filtering drops own/summary/ongoing notifications,
  dedupes, and rate-limits (the watch only holds 5).
- Needs the user to grant **Notification Access** (the screen deep-links to the
  system setting) and per-app allowlisting (default: forward nothing).
- Because it's a local module under `modules/`, CI's `expo prebuild` autolinks it
  with no config-plugin or `android/` edits; web/desktop exclude it via a
  `.web.ts` no-op. During DFU/resource uploads the app pauses this watch's
  forwarding link so the long BLE op has exclusive access.

Verified headlessly on the `tb_emu` emulator against InfiniSim: a real Android
notification captured by the listener passes the filter (ongoing ones dropped),
encodes, and renders on the sim watch; an incoming call renders the ring screen.
`scripts/notify-e2e.mjs` (`npm run notify:e2e`) drives config + inject over adb
and asserts the native forward + sim render. 19 Kotlin JUnit tests cover the
codec (byte-matches the TS encoder), filter, framing, and backoff.

Hardware-deferred (real PineTime + phone): the persistent GATT reconnect walking
in/out of range; overnight battery on both ends; Doze / OEM battery-killer
survival (connectedDevice FGS + reconnect-on-screen-on is the mitigation);
reboot → BootReceiver → auto-reconnect; the on-device Notification-Access grant
flow; and the live `onNotificationPosted` push (proven with real notifications on
the emulator; flaky only for `cmd notification post` on the preview API image).

## Music control (Android)

Bundled with the per-watch **Forward notifications** toggle (same native service
and persistent connection — no extra switch): the watch's Music app mirrors the
phone's now-playing state, and its buttons control the phone.

- Phone→watch: `SystemMediaSource` follows the phone's media sessions
  (`MediaSessionManager` via the granted notification listener; prefers the
  PLAYING session, ignores stateless assistant/system sessions, and re-picks on
  any session's state change) and `MusicBridge` writes only changed
  characteristics (artist/track/album ≤40 bytes with UTF-8-safe truncation,
  4-byte big-endian position/duration; positions within ±2 s of the watch's own
  extrapolation are skipped). A full snapshot re-sends everything when the watch
  opens its Music app (OPEN event), reconnects, or the session switches.
- Watch→phone: play/pause/next/prev act on the session's transport controls;
  the volume buttons adjust `STREAM_MUSIC`. The NotificationsScreen shows a
  live "Now playing" line.

Fully sim-verified, both directions: `scripts/music-watch-e2e.mjs` (watch side —
metadata renders, every button/swipe event byte asserted, incl. OPEN on entry)
and `scripts/music-e2e.mjs` / `npm run music:e2e` (emulator closed loop — a
debug-hosted **real** `MediaSession` drives the real media path; watch taps come
back as `skipToNext`/`pause` on the session and a real `STREAM_MUSIC` volume
change). Needed sim enablement, no firmware change: InfiniSim now exposes the
music characteristics, tags notifications by attribute handle, reports a fake
connection handle while a bridge client is attached, and compiles with
`-funsigned-char` to match ARM char semantics. Hardware-deferred: only the
`GattWatchConnection` music-char/CCCD specifics (same residue as ANS).

## Weather

The **Weather** hub feature pushes current conditions + a 5-day forecast to the
watch's SimpleWeatherService (`00050001`), so the Weather app and watch-face
weather widget show real data instead of `---`. No firmware change — the service
already exists; the companion drives it.

- Data from **Open-Meteo** (no API key, HTTPS — matches the OpenFreeMap ethos).
  `weatherProtocol.ts` encodes the two write messages (current, 53 B; forecast,
  ≤36 B) in centidegrees Celsius with a WMO→icon mapping; the *watch* converts to
  °F per its own setting.
- Location comes from the watch's prayer-times coordinates when set, else the
  phone's GPS.
- The watch drops weather after 24h, so the app pushes fresh weather each time you
  open the Weather screen and best-effort after a schedule sync (keeping the watch
  face current). `scripts/weather-e2e.mjs` pushes to a live InfiniSim and the
  watch face renders the pushed temperature + icon.

## Step tracking

The **Steps** hub feature reads today's cumulative step count from the watch's
MotionService (`00030001`) and keeps the durable **daily history on the phone** —
the watch itself only remembers today + yesterday (RAM-only). It reads + records
on each screen open, keeping the max seen per date (the day's final total).

- `stepsStore.ts` mirrors the location-history store (per-watch, 60-day cap).
- The screen shows today vs the 10 000-step goal and a 14-day bar chart drawn with
  plain RN Views — no charting dependency, so it renders on web/desktop too; a
  single accent hue, today highlighted, a dashed goal line, tap-a-bar for the
  count. `scripts/steps-e2e.mjs` bumps the sim counter (`simctl.py key steps-up`)
  and asserts the read-back.

Both features needed a small InfiniSim bridge char each (weather write, steps
read) but **no InfiniTime firmware change**. Hardware-deferred: real BMA421 step
counts and the live step-notify cadence over BLE; real GPS→weather accuracy.

## Releases

`gh release create vX.Y.Z` (or publish one in the UI) triggers
`.github/workflows/release.yml`, which attaches every distributable to the
release: per-ABI Android APKs, Linux AppImage, Windows installer + portable
exe, macOS dmg, and the web bundle zip — and deploys the web app to
<https://faisal-shah.github.io/PineTimeCompanion/> (GitHub Pages).
Prefer `scripts/release.sh X.Y.Z`: it runs the gates, bumps the version,
and creates the release as a **prerelease** for spot-checking before
promotion (`gh release edit vX.Y.Z --prerelease=false --latest`). Builds
are stamped (tag + commit) and show it in the app's footer. Re-run for an existing tag with the
workflow's manual dispatch. Nothing runs on push/PR.

No signing anywhere: APKs use the RN debug keystore (prebuild regenerates the
same key, so CI and local builds upgrade-install over each other); desktop
builds are unsigned — macOS users right-click → Open past Gatekeeper (or
`xattr -dr com.apple.quarantine <app>`), Windows users click through
SmartScreen. The dmg is Apple-silicon (arm64) only — GitHub's macOS runners
are M-series; an Intel dmg is one `mac.target` arch entry away if ever
needed. In-browser reconnects re-show the device chooser once per session
(Chrome gates silent re-grant behind a flag); the Electron shell
auto-reconnects.

## Architecture

- `src/model/` — types + recurrence math (TS twin of the firmware's `ScheduleRules.h`,
  drives the "next occurrences" preview in the event editor)
- `src/ble/scheduleProtocol.ts` — byte-level encoders for the Schedule Service
- `src/ble/syncManager.ts` — transport-agnostic sync (full-replace transaction with
  digest verification) + companion functions (CTS time, New Alert message, battery)
- `src/storage/store.ts` — AsyncStorage-persisted watch list
- `src/screens/` — WatchList, WatchDetail, EventEdit, WatchPair
