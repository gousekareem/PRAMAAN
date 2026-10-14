package com.pramaan.mobile.security

/** Pure (Android-free) posture rules so they can be unit-tested on the JVM. */
object PostureRules {
  val SU_PATHS = listOf(
      "/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/sd/xbin/su", "/system/bin/failsafe/su",
      "/data/local/su", "/data/local/bin/su", "/data/local/xbin/su", "/su/bin/su", "/system/app/Superuser.apk",
      "/data/adb/magisk", "/sbin/.magisk")

  /** Pure function (unit-tested): derive indicators from injectable probes. */
  fun rootIndicators(exists: (String) -> Boolean, buildTags: String?, debuggerAttached: Boolean): List<String> {
    val out = mutableListOf<String>()
    SU_PATHS.filter(exists).forEach { out.add("PATH:$it") }
    if (buildTags?.contains("test-keys") == true) out.add("BUILD_TAGS_TEST_KEYS")
    if (debuggerAttached) out.add("DEBUGGER_ATTACHED")
    return out
  }

  fun emulatorIndicators(fingerprint: String, model: String, hardware: String, product: String): List<String> {
    val out = mutableListOf<String>()
    if (fingerprint.startsWith("generic") || fingerprint.contains("emulator")) out.add("FINGERPRINT_GENERIC")
    if (model.contains("Emulator") || model.contains("Android SDK built for") || model.startsWith("sdk_gphone")) out.add("MODEL_EMULATOR")
    if (hardware == "goldfish" || hardware == "ranchu") out.add("HARDWARE_$hardware".uppercase())
    if (product.startsWith("sdk") || product.contains("emulator")) out.add("PRODUCT_SDK")
    return out
  }

}
