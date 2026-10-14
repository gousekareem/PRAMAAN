package com.pramaan.mobile.duty

import android.util.Base64
import com.pramaan.mobile.security.CryptoFormat
import java.io.File
import javax.crypto.SecretKey
import org.json.JSONArray
import org.json.JSONObject

/**
 * Append-only buffer for observations recorded by the foreground service while JS may not be
 * running. Each line is base64(IV | AES-GCM(JSON)). Drained (and only then removed) by JS,
 * which turns entries into signed ledger events. When full, new LOCATION entries are refused
 * and a single SENSOR_UNAVAILABLE(BUFFER_FULL) marker is written — nothing is silently dropped.
 */
class ObservationStore(private val file: File, private val key: () -> SecretKey, private val maxLines: Int = 20_000) {
  private val lock = Any()

  fun lineCount(): Int = synchronized(lock) { if (file.exists()) file.useLines { it.count() } else 0 }

  fun append(obs: JSONObject): Boolean = synchronized(lock) {
    file.parentFile?.mkdirs()
    val count = lineCount()
    if (count >= maxLines) {
      if (obs.optString("kind") == "SENSOR_UNAVAILABLE") return false
      if (count == maxLines) write(JSONObject().put("kind", "SENSOR_UNAVAILABLE").put("sensor", "LOCATION").put("reason", "BUFFER_FULL"))
      return false
    }
    write(obs)
    true
  }

  private fun write(obs: JSONObject) {
    val blob = CryptoFormat.encryptSmall(key(), obs.toString().toByteArray(Charsets.UTF_8))
    file.appendText(Base64.encodeToString(blob, Base64.NO_WRAP) + "\n")
  }

  /**
   * Two-phase drain: [peek] returns up to [max] entries without removing them; JS converts
   * them into ledger events and only then calls [remove] with the number it persisted. A crash
   * in between causes re-delivery (at-least-once), never loss.
   */
  fun peek(max: Int): JSONArray = synchronized(lock) {
    val out = JSONArray()
    if (!file.exists()) return out
    file.useLines { seq ->
      seq.filter { it.isNotBlank() }.take(max).forEach { l ->
        try {
          out.put(JSONObject(String(CryptoFormat.decryptSmall(key(), Base64.decode(l, Base64.NO_WRAP)), Charsets.UTF_8)))
        } catch (e: Exception) {
          out.put(JSONObject().put("kind", "SENSOR_UNAVAILABLE").put("sensor", "LOCATION").put("reason", "CORRUPTED_BUFFER_ENTRY"))
        }
      }
    }
    out
  }

  fun remove(count: Int): Unit = synchronized(lock) {
    if (!file.exists() || count <= 0) return
    val lines = file.readLines().filter { it.isNotBlank() }
    val tmp = File(file.path + ".tmp")
    tmp.writeText(lines.drop(count).joinToString("") { "$it\n" })
    check(tmp.renameTo(file)) { "buffer rename failed" }
  }
}
