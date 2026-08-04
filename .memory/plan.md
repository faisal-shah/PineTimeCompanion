# Companion Multi-Device Plan

## Goal

Let several family phones and computers use one watch sequentially without
routine re-pairing, while making forwarding ownership, capacity, and genuine
bond repair explicit.

## Architecture

- `ConnectionCoordinator` serializes transient sessions per watch.
- Forwarding is paused before transient work and resumed after cleanup.
- Pairing reads public status, confirms full-watch eviction, then requires an
  authenticated verify read before saving.
- Repair advice compares reset epoch and eviction count with stored metadata.
- Android opens public Bluetooth settings and uses public bond APIs only.
- Generated protocol constants come from InfiniTime's manifest.

## Completed

1. Connection ownership, retries, and partial-link cleanup.
2. Verified pairing, legacy fallback, capacity confirmation, and repair UX.
3. Native pause/socket/bond helpers and event-driven status.
4. TypeScript/Kotlin tests, CI, web export, README, release notes, and guide.

## Remaining

Run real phones against the deployed watch fleet using
`pinetime-dev-tools/RELEASE.md`.
