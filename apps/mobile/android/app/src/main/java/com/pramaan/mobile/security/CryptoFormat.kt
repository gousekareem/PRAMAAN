package com.pramaan.mobile.security

import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Authenticated-encryption container used for evidence files and the observation buffer.
 * Format: MAGIC (6 bytes "PRMN1\n") | IV (12 bytes) | AES-256-GCM ciphertext | 16-byte tag.
 * Pure JCE so it is unit-testable on the JVM with a software key; on device the key lives in
 * Android Keystore and never leaves it.
 */
object CryptoFormat {
  val MAGIC = "PRMN1\n".toByteArray(Charsets.US_ASCII)
  const val IV_LEN = 12
  const val TAG_BITS = 128

  class LimitExceeded(msg: String) : Exception(msg)

  data class SealResult(val sha256Hex: String, val plaintextBytes: Long, val head: ByteArray)

  /** Streams plaintext → (SHA-256 of plaintext) + encrypted container. */
  fun seal(key: SecretKey, input: InputStream, output: OutputStream, maxBytes: Long): SealResult {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key) // provider generates a random IV
    val iv = cipher.iv
    require(iv.size == IV_LEN) { "unexpected IV length" }
    output.write(MAGIC)
    output.write(iv)
    val digest = MessageDigest.getInstance("SHA-256")
    val head = ByteArray(16)
    var headLen = 0
    var total = 0L
    CipherOutputStream(output, cipher).use { cos ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        total += n
        if (total > maxBytes) throw LimitExceeded("plaintext exceeds $maxBytes bytes")
        if (headLen < head.size) {
          val c = minOf(head.size - headLen, n)
          System.arraycopy(buf, 0, head, headLen, c)
          headLen += c
        }
        digest.update(buf, 0, n)
        cos.write(buf, 0, n)
      }
    }
    return SealResult(hex(digest.digest()), total, head.copyOf(headLen))
  }

  /** Decrypts a container to output and returns the SHA-256 of the plaintext. Throws on tag failure. */
  fun open(key: SecretKey, input: InputStream, output: OutputStream, maxBytes: Long): String {
    val magic = ByteArray(MAGIC.size)
    readFully(input, magic)
    require(magic.contentEquals(MAGIC)) { "not a PRAMAAN container" }
    val iv = ByteArray(IV_LEN)
    readFully(input, iv)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
    val digest = MessageDigest.getInstance("SHA-256")
    var total = 0L
    CipherInputStream(input, cipher).use { cis ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = cis.read(buf)
        if (n < 0) break
        total += n
        if (total > maxBytes) throw LimitExceeded("plaintext exceeds $maxBytes bytes")
        digest.update(buf, 0, n)
        output.write(buf, 0, n)
      }
    }
    return hex(digest.digest())
  }

  fun encryptSmall(key: SecretKey, plaintext: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    return cipher.iv + cipher.doFinal(plaintext)
  }

  fun decryptSmall(key: SecretKey, blob: ByteArray): ByteArray {
    require(blob.size > IV_LEN + 16) { "ciphertext too short" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, blob, 0, IV_LEN))
    return cipher.doFinal(blob, IV_LEN, blob.size - IV_LEN)
  }

  fun hex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }

  private fun readFully(input: InputStream, dst: ByteArray) {
    var off = 0
    while (off < dst.size) {
      val n = input.read(dst, off, dst.size - off)
      require(n >= 0) { "truncated container" }
      off += n
    }
  }
}
