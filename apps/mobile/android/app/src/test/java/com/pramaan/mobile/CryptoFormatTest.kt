package com.pramaan.mobile

import com.pramaan.mobile.security.CryptoFormat
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import javax.crypto.KeyGenerator
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** JVM unit tests (software AES key; on device the key is in Android Keystore). */
class CryptoFormatTest {
  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

  @Test fun sealThenOpenRoundTripsAndHashesPlaintext() {
    val plain = ByteArray(300_000) { (it * 31).toByte() }.also { it[0] = 0xFF.toByte(); it[1] = 0xD8.toByte(); it[2] = 0xFF.toByte() }
    val sealed = ByteArrayOutputStream()
    val r = CryptoFormat.seal(key, ByteArrayInputStream(plain), sealed, 8L * 1024 * 1024)
    val expected = MessageDigest.getInstance("SHA-256").digest(plain).joinToString("") { "%02x".format(it) }
    assertEquals(expected, r.sha256Hex)
    assertEquals(plain.size.toLong(), r.plaintextBytes)
    val out = ByteArrayOutputStream()
    assertEquals(expected, CryptoFormat.open(key, ByteArrayInputStream(sealed.toByteArray()), out, 8L * 1024 * 1024))
    assertArrayEquals(plain, out.toByteArray())
  }

  @Test fun tamperedCiphertextFailsAuthentication() {
    val sealed = ByteArrayOutputStream()
    CryptoFormat.seal(key, ByteArrayInputStream(ByteArray(1000) { 7 }), sealed, 10_000)
    val bytes = sealed.toByteArray()
    bytes[bytes.size - 20] = (bytes[bytes.size - 20].toInt() xor 1).toByte()
    assertThrows(Exception::class.java) { CryptoFormat.open(key, ByteArrayInputStream(bytes), ByteArrayOutputStream(), 10_000) }
  }

  @Test fun enforcesSizeLimit() {
    assertThrows(CryptoFormat.LimitExceeded::class.java) {
      CryptoFormat.seal(key, ByteArrayInputStream(ByteArray(2048)), ByteArrayOutputStream(), 1024)
    }
  }

  @Test fun smallBlobsRoundTrip() {
    val msg = "{\"kind\":\"STEPS\",\"stepsSinceBoot\":12}".toByteArray()
    assertArrayEquals(msg, CryptoFormat.decryptSmall(key, CryptoFormat.encryptSmall(key, msg)))
  }
}
