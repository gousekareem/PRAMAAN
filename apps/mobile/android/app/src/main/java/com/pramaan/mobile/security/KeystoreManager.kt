package com.pramaan.mobile.security

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Android Keystore key management. Private keys are generated inside the Keystore
 * (TEE/StrongBox where available) and are non-exportable. Keys are deleted by Android when the
 * app is uninstalled — a reinstall therefore requires a NEW device registration.
 */
object KeystoreManager {
  const val DEVICE_KEY = "pramaan_device_signing_v1"
  const val BIOMETRIC_KEY = "pramaan_biometric_v1"
  const val WRAP_KEY = "pramaan_wrap_v1"
  const val EVIDENCE_KEY = "pramaan_evidence_v1"
  private const val PREFS = "pramaan_secure_meta"
  private const val DB_KEY_PREF = "db_key_wrapped"

  private fun ks(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun hasStrongBox(ctx: Context) =
      Build.VERSION.SDK_INT >= 28 && ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)

  private fun generateEc(ctx: Context, alias: String, userAuth: Boolean) {
    fun spec(strongBox: Boolean): KeyGenParameterSpec {
      val b = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          .setDigests(KeyProperties.DIGEST_SHA256)
      if (userAuth) {
        b.setUserAuthenticationRequired(true)
        b.setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        else @Suppress("DEPRECATION") b.setUserAuthenticationValidityDurationSeconds(-1)
      }
      if (strongBox && Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(true)
      return b.build()
    }
    val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    try {
      gen.initialize(spec(hasStrongBox(ctx)))
      gen.generateKeyPair()
    } catch (e: Exception) {
      if (Build.VERSION.SDK_INT >= 28 && (e is StrongBoxUnavailableException || e.cause is StrongBoxUnavailableException)) {
        gen.initialize(spec(false))
        gen.generateKeyPair()
      } else throw e
    }
  }

  private fun aes(alias: String): SecretKey {
    val store = ks()
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
        KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build())
    return gen.generateKey()
  }

  fun wrapKey(): SecretKey = aes(WRAP_KEY)
  fun evidenceKey(): SecretKey = aes(EVIDENCE_KEY)

  fun ensureDeviceKey(ctx: Context): PublicKey {
    val store = ks()
    if (!store.containsAlias(DEVICE_KEY)) generateEc(ctx, DEVICE_KEY, userAuth = false)
    return store.getCertificate(DEVICE_KEY).publicKey
  }

  fun ensureBiometricKey(ctx: Context): PrivateKey {
    val store = ks()
    if (!store.containsAlias(BIOMETRIC_KEY)) generateEc(ctx, BIOMETRIC_KEY, userAuth = true)
    return store.getKey(BIOMETRIC_KEY, null) as PrivateKey
  }

  fun deleteBiometricKey() {
    ks().deleteEntry(BIOMETRIC_KEY)
  }

  fun isHardwareBacked(alias: String): Boolean? = try {
    val key = ks().getKey(alias, null) as PrivateKey
    val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
    if (Build.VERSION.SDK_INT >= 31) info.securityLevel != KeyProperties.SECURITY_LEVEL_SOFTWARE
    else @Suppress("DEPRECATION") info.isInsideSecureHardware
  } catch (e: Exception) {
    null
  }

  /** SHA256withECDSA → DER signature over the UTF-8 message. */
  fun signWithDeviceKey(message: String): ByteArray {
    val key = ks().getKey(DEVICE_KEY, null) as? PrivateKey ?: throw IllegalStateException("Device key not created")
    return Signature.getInstance("SHA256withECDSA").run {
      initSign(key)
      update(message.toByteArray(Charsets.UTF_8))
      sign()
    }
  }

  /**
   * 256-bit random SQLCipher key, stored only in AES-GCM-wrapped form (wrapping key in Keystore).
   * If the Keystore key is lost (e.g. app data cleared) the database cannot be decrypted —
   * this is intentional; unsynchronised data on a lost key is unrecoverable (documented limitation).
   */
  fun databaseKeyHex(ctx: Context): String {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val wrapped = prefs.getString(DB_KEY_PREF, null)
    if (wrapped != null) {
      return CryptoFormat.hex(CryptoFormat.decryptSmall(wrapKey(), Base64.decode(wrapped, Base64.NO_WRAP)))
    }
    val raw = ByteArray(32).also { SecureRandom().nextBytes(it) }
    val blob = CryptoFormat.encryptSmall(wrapKey(), raw)
    check(prefs.edit().putString(DB_KEY_PREF, Base64.encodeToString(blob, Base64.NO_WRAP)).commit()) { "could not persist wrapped key" }
    return CryptoFormat.hex(raw).also { raw.fill(0) }
  }
}
