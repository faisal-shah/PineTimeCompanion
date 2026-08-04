package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertEquals
import org.junit.Test

class BondStateTest {
  @Test
  fun `maps the android bond constants`() {
    assertEquals(BondState.NONE, BondState.fromAndroid(BondState.ANDROID_BOND_NONE))
    assertEquals(BondState.BONDING, BondState.fromAndroid(BondState.ANDROID_BOND_BONDING))
    assertEquals(BondState.BONDED, BondState.fromAndroid(BondState.ANDROID_BOND_BONDED))
  }

  @Test
  fun `the raw constants match the android values`() {
    // Guards against a silent drift from android.bluetooth.BluetoothDevice.
    assertEquals(10, BondState.ANDROID_BOND_NONE)
    assertEquals(11, BondState.ANDROID_BOND_BONDING)
    assertEquals(12, BondState.ANDROID_BOND_BONDED)
  }

  @Test
  fun `an unrecognised value is UNKNOWN, never a false BONDED`() {
    assertEquals(BondState.UNKNOWN, BondState.fromAndroid(0))
    assertEquals(BondState.UNKNOWN, BondState.fromAndroid(-1))
    assertEquals(BondState.UNKNOWN, BondState.fromAndroid(99))
  }
}
