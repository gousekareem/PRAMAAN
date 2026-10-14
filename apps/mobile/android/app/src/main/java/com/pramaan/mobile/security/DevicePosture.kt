package com.pramaan.mobile.security

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Debug
import android.provider.Settings
import java.io.File
import java.security.MessageDigest

/**
 * Defense-in-depth device posture heuristics. All of these can be bypassed on a rooted or
 * instrumented device (e.g. Magisk DenyList, Frida); results are recorded for human review only.
 */
object DevicePosture {
  fun rootIndicators(exists: (String) -> Boolean, buildTags: String?, debuggerAttached: Boolean) = PostureRules.rootIndicators(exists, buildTags, debuggerAttached)
  fun emulatorIndicators(fingerprint: String, model: String, hardware: String, product: String) = PostureRules.emulatorIndicators(fingerprint, model, hardware, product)

  fun collect(ctx: Context): Map<String, Any?> {
    val cr = ctx.contentResolver
    val debuggable = (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    return mapOf(
        "debuggableBuild" to debuggable,
        "rootIndicators" to rootIndicators({ File(it).exists() }, Build.TAGS, Debug.isDebuggerConnected()),
        "developerOptionsEnabled" to (Settings.Global.getInt(cr, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1),
        "adbEnabled" to (Settings.Global.getInt(cr, Settings.Global.ADB_ENABLED, 0) == 1),
        "emulatorIndicators" to emulatorIndicators(Build.FINGERPRINT ?: "", Build.MODEL ?: "", Build.HARDWARE ?: "", Build.PRODUCT ?: ""),
        "appSigningCertSha256" to signingCertSha256(ctx),
        "keyHardwareBacked" to KeystoreManager.isHardwareBacked(KeystoreManager.DEVICE_KEY),
        // Play Integrity is an optional, disabled-by-default adapter (requires a Google Cloud project);
        // see docs/security-model.md. No verdict is fabricated.
        "playIntegrityVerdict" to null,
    )
  }

  private fun signingCertSha256(ctx: Context): String? = try {
    val pm = ctx.packageManager
    val sig = if (Build.VERSION.SDK_INT >= 28) {
      pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners?.firstOrNull()
    } else {
      @Suppress("DEPRECATION")
      pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES).signatures?.firstOrNull()
    }
    sig?.let { CryptoFormat.hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) }
  } catch (e: Exception) {
    null
  }
}
