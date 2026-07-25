# Unreleased

Notes to fold into the next release's **## Changes** section, then empty this
file. `scripts/release.sh` prints it when you cut a release.

## ⚠️ Watches are reset on upgrade from v0.16.0

The way a watch is stored on the phone changed: the schedule and daily tasks are
now each a self-contained synced list, instead of a flat set of parallel fields.
Records written by v0.16.0 don't match the new shape and are **discarded on
first launch**, so after updating you'll see an empty watch list and will need to
add and pair your watches again.

Nothing on the watch itself is touched — its schedule, tasks and alarms stay put.
Re-pair and sync, and the phone picks everything back up from the watch (that's
what watch-authoritative sync is for).

The app is pre-1.0 and deliberately carries no migration code; a format change
resets local state rather than growing compatibility shims. The store now drops
records it can't read instead of failing to start, which is what made this a
clean reset rather than a crash.

## Internal (no user-visible change)

- One generic watch-authoritative list-sync engine now backs both the schedule
  and the daily tasks; multi-alarm deliberately keeps its compare-and-swap model.
- Shared `withConnection`, `Dialog` and `useWatchOp` replace per-screen copies.
- Fixed: task edit timestamps were written as milliseconds into a 32-bit seconds
  field, so they overflowed and could make multi-phone task merges resolve
  arbitrarily.
