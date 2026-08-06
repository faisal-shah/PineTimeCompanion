# Lessons Learned

## Gotchas

- Android has no supported public API to remove a bond.
- A successful GATT open can still fail service discovery and must be closed.
- The forwarding service owns a persistent link independently of JavaScript.
- Simulator IDs contain one colon; real BLE MACs contain five.
- Public management status must be read before the authenticated verify step.
- The 2.0.2 firmware reset is intentional format initialization, not a
  compatibility migration.
- An async DFU keeps running after a screen unmount unless navigation removal is
  explicitly prevented.
- Expo SDK 57's native fetch races in `ResponseSink.finalize` (expo/expo#47762);
  merely reading `response.body` starts that state machine, so native downloads
  must use `arrayBuffer()` and never reference the property.
- `alignItems: 'center'` centres a Text *box*, not its text. A label that wraps
  fills its container and then renders left-aligned unless `textAlign` says
  otherwise.
- `Range.getClientRects()` emits a rect for the collapsed space at a line break,
  which reads as a wildly off-centre extra line. Measure per-character rects and
  group them by line to get the true inked extent.

## Patterns

- Put every watch operation through `withConnection`.
- Keep repair diagnosis pure and test it from stored/fresh management status.
- Use generated UUIDs and access policy instead of parallel constants.
- Preserve raw operational errors; do not silently convert them to legacy mode.

## Decisions

| Decision | Rationale | Date |
|---|---|---|
| Explicit legacy pairing prompt | Older firmware remains usable without false verification | 2026-08-04 |
| Event-driven ownership status | Avoid polling and explain who holds the link | 2026-08-04 |

## Checkpoint Log

| Date | Tasks Since Last Checkpoint | Notes |
|---|---:|---|
| 2026-08-04 | 8 | Pairing, repair, ownership, tests, docs, and commit complete |
| 2026-08-05 | 1 | Active updates now block screen removal and duplicate starts |
| 2026-08-06 | 1 | Native downloads bypass the Expo fetch race; action labels centre when wrapped |
