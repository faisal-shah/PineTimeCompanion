package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertEquals
import org.junit.Test

class CompanionRepairTest {
  @Test
  fun `a changed reset epoch means the watch cleared its pairings`() {
    assertEquals(
      RepairReason.RESET_EPOCH_CHANGED,
      CompanionRepair.decide(storedResetEpoch = 1, storedEvictionCount = 0, currentResetEpoch = 2, currentEvictionCount = 0),
    )
  }

  @Test
  fun `an advanced eviction count means this phone was the LRU companion`() {
    assertEquals(
      RepairReason.EVICTION_ADVANCED,
      CompanionRepair.decide(storedResetEpoch = 1, storedEvictionCount = 3, currentResetEpoch = 1, currentEvictionCount = 4),
    )
  }

  @Test
  fun `reset epoch wins when both changed`() {
    assertEquals(
      RepairReason.RESET_EPOCH_CHANGED,
      CompanionRepair.decide(storedResetEpoch = 1, storedEvictionCount = 3, currentResetEpoch = 9, currentEvictionCount = 4),
    )
  }

  @Test
  fun `no observable change is a generic out-of-sync bond`() {
    assertEquals(
      RepairReason.OUT_OF_SYNC,
      CompanionRepair.decide(storedResetEpoch = 1, storedEvictionCount = 3, currentResetEpoch = 1, currentEvictionCount = 3),
    )
  }

  @Test
  fun `an unreadable public status is UNKNOWN`() {
    assertEquals(
      RepairReason.UNKNOWN,
      CompanionRepair.decide(storedResetEpoch = 1, storedEvictionCount = 3, currentResetEpoch = null, currentEvictionCount = null),
    )
  }

  @Test
  fun `missing stored metadata does not invent a reset or eviction story`() {
    assertEquals(
      RepairReason.OUT_OF_SYNC,
      CompanionRepair.decide(storedResetEpoch = null, storedEvictionCount = null, currentResetEpoch = 5, currentEvictionCount = 9),
    )
  }
}
