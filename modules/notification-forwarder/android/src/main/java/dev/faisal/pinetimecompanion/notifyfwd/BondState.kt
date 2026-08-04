package dev.faisal.pinetimecompanion.notifyfwd

/**
 * The bond state of a remote device, mapped off the raw Android
 * BluetoothDevice.BOND_* integers so the mapping is unit-testable without an
 * Android runtime. The repair UI reads this to tell "already bonded" from "not
 * bonded" from "mid-pairing" — it never removes a bond (no reflection, no hidden
 * removeBond); creating a bond and clearing one are the two things it does, and
 * clearing is done by the user in the system Bluetooth settings.
 */
enum class BondState {
  NONE,
  BONDING,
  BONDED,
  UNKNOWN;

  companion object {
    // android.bluetooth.BluetoothDevice constants, inlined so this stays pure.
    const val ANDROID_BOND_NONE = 10
    const val ANDROID_BOND_BONDING = 11
    const val ANDROID_BOND_BONDED = 12

    fun fromAndroid(raw: Int): BondState = when (raw) {
      ANDROID_BOND_NONE -> NONE
      ANDROID_BOND_BONDING -> BONDING
      ANDROID_BOND_BONDED -> BONDED
      else -> UNKNOWN
    }
  }
}
