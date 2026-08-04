# Lessons Learned

## Gotchas

- Android has no supported public API to remove a bond.
- A successful GATT open can still fail service discovery and must be closed.
- The forwarding service owns a persistent link independently of JavaScript.
- Simulator IDs contain one colon; real BLE MACs contain five.
- Public management status must be read before the authenticated verify step.

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
