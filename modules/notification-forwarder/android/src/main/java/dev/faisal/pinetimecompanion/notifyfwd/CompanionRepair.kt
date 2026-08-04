package dev.faisal.pinetimecompanion.notifyfwd

/**
 * Pure decision helper: given what the app last recorded from the watch's
 * companion-management status and what a fresh public read shows now, work out
 * why an authentication failed and which repair to advise. Mirrors the TS
 * `repairAdvice` so the native side can reason about the same three stories when
 * it needs to (e.g. deciding whether to prompt a fresh createBond). No Android
 * types, so it is JVM-unit-testable.
 *
 * Every branch resolves to the same real fix — forget the watch in the phone's
 * system Bluetooth settings, then pair again — but the wording differs so the
 * user understands what happened.
 */
enum class RepairReason { RESET_EPOCH_CHANGED, EVICTION_ADVANCED, OUT_OF_SYNC, UNKNOWN }

object CompanionRepair {
  /**
   * @param storedResetEpoch    last recorded reset epoch, or null if unknown
   * @param storedEvictionCount last recorded eviction count, or null if unknown
   * @param currentResetEpoch   reset epoch from a fresh public read, or null if it failed
   * @param currentEvictionCount eviction count from a fresh public read, or null if it failed
   */
  fun decide(
    storedResetEpoch: Long?,
    storedEvictionCount: Long?,
    currentResetEpoch: Long?,
    currentEvictionCount: Long?,
  ): RepairReason {
    if (currentResetEpoch == null || currentEvictionCount == null) {
      return RepairReason.UNKNOWN
    }
    if (storedResetEpoch != null && currentResetEpoch != storedResetEpoch) {
      return RepairReason.RESET_EPOCH_CHANGED
    }
    if (storedEvictionCount != null && currentEvictionCount > storedEvictionCount) {
      return RepairReason.EVICTION_ADVANCED
    }
    return RepairReason.OUT_OF_SYNC
  }
}
