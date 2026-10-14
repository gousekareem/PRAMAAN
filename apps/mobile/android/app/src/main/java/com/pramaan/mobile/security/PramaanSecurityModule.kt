package com.pramaan.mobile.security

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.pramaan.mobile.BuildConfig
import java.security.SecureRandom
import java.security.Signature
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class PramaanSecurityModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "PramaanSecurity"

  override fun getConstants(): MutableMap<String, Any> =
      mutableMapOf("apiBaseUrl" to BuildConfig.PRAMAAN_API_BASE_URL, "appVersion" to BuildConfig.VERSION_NAME)

  /** Wall clock (untrusted), monotonic elapsedRealtime and a boot identifier, sampled together. */
  @ReactMethod
  fun clock(promise: Promise) {
    val m = Arguments.createMap()
    m.putString("wallTime", isoNow())
    m.putDouble("monotonicMs", SystemClock.elapsedRealtime().toDouble())
    m.putString("bootId", bootId())
    promise.resolve(m)
  }

  private fun bootId(): String {
    val count = Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT, -1)
    // Fallback when BOOT_COUNT is unavailable: boot time rounded to 10 s.
    return if (count >= 0) "bc-$count" else "bt-${(System.currentTimeMillis() - SystemClock.elapsedRealtime()) / 10_000}"
  }

  @ReactMethod
  fun ensureDeviceKey(promise: Promise) = runCatching(promise) {
    val pub = KeystoreManager.ensureDeviceKey(ctx)
    Arguments.createMap().apply {
      putString("publicKeySpki", Base64.encodeToString(pub.encoded, Base64.NO_WRAP))
      val hw = KeystoreManager.isHardwareBacked(KeystoreManager.DEVICE_KEY)
      if (hw == null) putNull("hardwareBacked") else putBoolean("hardwareBacked", hw)
    }
  }

  @ReactMethod
  fun sign(message: String, promise: Promise) = runCatching(promise) {
    Base64.encodeToString(KeystoreManager.signWithDeviceKey(message), Base64.NO_WRAP)
  }

  @ReactMethod
  fun getOrCreateDatabaseKey(promise: Promise) = runCatching(promise) { KeystoreManager.databaseKeyHex(ctx) }

  @ReactMethod
  fun randomBytesHex(n: Int, promise: Promise) = runCatching(promise) {
    require(n in 1..64)
    CryptoFormat.hex(ByteArray(n).also { SecureRandom().nextBytes(it) })
  }

  @ReactMethod
  fun devicePosture(promise: Promise) = runCatching(promise) { Arguments.makeNativeMap(DevicePosture.collect(ctx)) }

  @ReactMethod
  fun biometricStatus(promise: Promise) {
    val s = when (BiometricManager.from(ctx).canAuthenticate(BIOMETRIC_STRONG)) {
      BiometricManager.BIOMETRIC_SUCCESS -> "AVAILABLE"
      BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "NONE_ENROLLED"
      BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "NO_HARDWARE"
      BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "SECURITY_UPDATE_REQUIRED"
      else -> "UNAVAILABLE"
    }
    promise.resolve(s)
  }

  /**
   * Shows BiometricPrompt (Class 3 / BIOMETRIC_STRONG only) bound to a CryptoObject. The
   * auth-per-use Keystore key can sign the nonce ONLY after a successful biometric match, so
   * the resulting signature is hardware-attested evidence that the prompt succeeded on this
   * device. It proves a match against an enrolled biometric — not who that person is, and not
   * continuous presence afterwards.
   */
  @ReactMethod
  fun biometricSign(title: String, subtitle: String, nonceHex: String, promise: Promise) {
    val activity = currentActivity as? FragmentActivity ?: return promise.reject("NO_ACTIVITY", "App not in foreground")
    val signature = try {
      Signature.getInstance("SHA256withECDSA").apply { initSign(KeystoreManager.ensureBiometricKey(ctx)) }
    } catch (e: KeyPermanentlyInvalidatedException) {
      KeystoreManager.deleteBiometricKey()
      return promise.reject("KEY_INVALIDATED_RETRY", "Biometric enrolment changed; key regenerated, please retry")
    } catch (e: Exception) {
      return promise.reject("BIOMETRIC_KEY_ERROR", e.message ?: "key error")
    }
    Handler(Looper.getMainLooper()).post {
      val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(ctx), object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          try {
            val s = result.cryptoObject?.signature ?: throw IllegalStateException("no crypto object")
            s.update(nonceHex.toByteArray(Charsets.UTF_8))
            val m = Arguments.createMap()
            m.putString("authenticator", "BIOMETRIC_STRONG")
            m.putString("signature", Base64.encodeToString(s.sign(), Base64.NO_WRAP))
            promise.resolve(m)
          } catch (e: Exception) {
            promise.reject("BIOMETRIC_SIGN_FAILED", e.message)
          }
        }
        override fun onAuthenticationError(code: Int, msg: CharSequence) {
          val c = when (code) {
            BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> "ERROR_USER_CANCELED"
            BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "ERROR_LOCKOUT"
            BiometricPrompt.ERROR_NO_BIOMETRICS -> "ERROR_NONE_ENROLLED"
            BiometricPrompt.ERROR_TIMEOUT -> "ERROR_TIMEOUT"
            else -> "ERROR_$code"
          }
          promise.reject(c, msg.toString())
        }
        // onAuthenticationFailed = one non-matching attempt; the prompt stays open, no terminal result.
      })
      val info = BiometricPrompt.PromptInfo.Builder()
          .setTitle(title)
          .setSubtitle(subtitle)
          .setNegativeButtonText("Cancel")
          .setAllowedAuthenticators(BIOMETRIC_STRONG)
          .setConfirmationRequired(true)
          .build()
      prompt.authenticate(info, BiometricPrompt.CryptoObject(signature))
    }
  }

  private inline fun runCatching(promise: Promise, block: () -> Any?) {
    try {
      when (val r = block()) {
        is WritableMap -> promise.resolve(r)
        else -> promise.resolve(r)
      }
    } catch (e: Exception) {
      promise.reject("PRAMAAN_SECURITY_ERROR", e.message ?: e.javaClass.simpleName)
    }
  }

  companion object {
    fun isoNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
  }
}
