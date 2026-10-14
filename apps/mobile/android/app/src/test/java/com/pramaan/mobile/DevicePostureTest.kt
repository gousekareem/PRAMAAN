package com.pramaan.mobile

import com.pramaan.mobile.security.PostureRules as DevicePosture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DevicePostureTest {
  @Test fun cleanDeviceHasNoIndicators() {
    assertTrue(DevicePosture.rootIndicators({ false }, "release-keys", false).isEmpty())
  }

  @Test fun reportsSuBinariesTestKeysAndDebugger() {
    val r = DevicePosture.rootIndicators({ it == "/system/xbin/su" }, "test-keys", true)
    assertEquals(listOf("PATH:/system/xbin/su", "BUILD_TAGS_TEST_KEYS", "DEBUGGER_ATTACHED"), r)
  }

  @Test fun detectsCommonEmulators() {
    val r = DevicePosture.emulatorIndicators("google/sdk_gphone64_x86_64/emu64x:14/...", "sdk_gphone64_x86_64", "ranchu", "sdk_gphone64_x86_64")
    assertTrue(r.contains("MODEL_EMULATOR"))
    assertTrue(r.contains("HARDWARE_RANCHU"))
    assertTrue(r.contains("PRODUCT_SDK"))
  }
}
