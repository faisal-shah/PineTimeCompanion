package dev.faisal.pinetimecompanion.notifyfwd

import java.util.concurrent.ConcurrentHashMap

/**
 * Reference-counted per-device pause registry for the forwarding links.
 *
 * A JS-driven watch op (sync, OTA) pauses a watch's forwarding link so it gets
 * exclusive GATT access, then resumes it. Ops on the same watch can overlap — a
 * sync fired while an update is still running, say — so the pause is counted,
 * not a boolean: only the first acquire actually pauses the link, only the last
 * release actually resumes it, and a stray release can neither drive the count
 * below zero nor spuriously restart a connection.
 *
 * Pure JVM, no Android: the [ConnectionManager] delegates its pause policy here
 * so the counting and underflow rules are unit-testable without an emulator.
 */
class PauseCounter {
  private val depths = ConcurrentHashMap<String, Int>()

  /**
   * Add a hold on [deviceId]. Returns true iff this was the 0 -> 1 transition,
   * i.e. the caller should now actually pause (tear down) the link. Nested
   * acquires return false so the link is not torn down again.
   */
  @Synchronized
  fun acquire(deviceId: String): Boolean {
    val next = (depths[deviceId] ?: 0) + 1
    depths[deviceId] = next
    return next == 1
  }

  /**
   * Drop a hold on [deviceId]. Returns true iff this was the 1 -> 0 transition,
   * i.e. the caller should now actually resume the link. A release with no
   * matching acquire is ignored (returns false): it cannot make the count
   * negative and cannot trigger a resume, so an extra resume never
   * unexpectedly starts a connection.
   */
  @Synchronized
  fun release(deviceId: String): Boolean {
    val current = depths[deviceId] ?: 0
    if (current <= 0) return false
    val next = current - 1
    if (next == 0) depths.remove(deviceId) else depths[deviceId] = next
    return next == 0
  }

  fun isPaused(deviceId: String): Boolean = (depths[deviceId] ?: 0) > 0

  fun depth(deviceId: String): Int = depths[deviceId] ?: 0

  /** Devices currently paused, in no particular order. */
  fun pausedDevices(): Set<String> = depths.keys.toSet()

  /** Snapshot of paused devices and their current hold depth. */
  fun pausedDepths(): Map<String, Int> = HashMap(depths)
}
