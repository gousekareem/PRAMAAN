package com.pramaan.mobile.evidence

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.StatFs
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.pramaan.mobile.security.CryptoFormat
import com.pramaan.mobile.security.KeystoreManager
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.SecureRandom
import java.util.concurrent.Executors

class PramaanEvidenceModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), ActivityEventListener {
  private val io = Executors.newSingleThreadExecutor()
  private var pendingCapture: Promise? = null
  private val evidenceDir get() = File(ctx.filesDir, "evidence").apply { mkdirs() }
  private val captureDir get() = File(ctx.cacheDir, "capture").apply { mkdirs() }
  private val uploadDir get() = File(ctx.cacheDir, "upload").apply { mkdirs() }

  init {
    ctx.addActivityEventListener(this)
    // Recovery: interrupted seals (.part) and stale capture/upload temps never entered the ledger.
    io.execute {
      evidenceDir.listFiles { f -> f.name.endsWith(".part") }?.forEach { it.delete() }
      captureDir.listFiles()?.forEach { it.delete() }
      uploadDir.listFiles()?.forEach { it.delete() }
    }
  }

  override fun getName() = "PramaanEvidence"

  @ReactMethod
  fun capture(promise: Promise) {
    val activity = currentActivity ?: return promise.reject("NO_ACTIVITY", "App not in foreground")
    if (pendingCapture != null) return promise.reject("BUSY", "Capture already in progress")
    pendingCapture = promise
    activity.startActivityForResult(Intent(activity, CaptureActivity::class.java), REQUEST_CAPTURE)
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CAPTURE) return
    val p = pendingCapture ?: return
    pendingCapture = null
    val path = data?.getStringExtra(CaptureActivity.EXTRA_PATH)
    if (resultCode != Activity.RESULT_OK || path == null) return p.reject("CANCELLED", "CANCELLED")
    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, opts)
    val m = Arguments.createMap()
    m.putString("tempPath", path)
    m.putInt("width", opts.outWidth)
    m.putInt("height", opts.outHeight)
    m.putString("cameraId", "back")
    m.putString("captureApi", data.getStringExtra(CaptureActivity.EXTRA_API) ?: "CameraX ImageCapture")
    p.resolve(m)
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun requireInside(dir: File, path: String): File {
    val f = File(path).canonicalFile
    require(f.path.startsWith(dir.canonicalPath + File.separator)) { "path outside $dir" }
    return f
  }

  /** SHA-256 over the original bytes + AES-256-GCM at rest; the plaintext temp file is deleted. */
  @ReactMethod
  fun seal(tempPath: String, promise: Promise) = io.execute {
    try {
      val src = requireInside(captureDir, tempPath)
      val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(src.path, opts)
      val name = ByteArray(16).also { SecureRandom().nextBytes(it) }.let(CryptoFormat::hex)
      val part = File(evidenceDir, "$name.enc.part")
      val res = FileInputStream(src).use { input -> FileOutputStream(part).use { out ->
        val r = CryptoFormat.seal(KeystoreManager.evidenceKey(), input, out, MAX_BYTES)
        out.fd.sync()
        r
      } }
      val jpeg = res.head.size >= 3 && res.head[0] == 0xFF.toByte() && res.head[1] == 0xD8.toByte() && res.head[2] == 0xFF.toByte()
      val sealed = File(evidenceDir, "$name.enc")
      check(part.renameTo(sealed)) { "rename failed" }
      src.delete()
      promise.resolve(Arguments.createMap().apply {
        putString("sealedPath", sealed.absolutePath)
        putString("sha256", res.sha256Hex)
        putDouble("byteLength", res.plaintextBytes.toDouble())
        putInt("width", opts.outWidth)
        putInt("height", opts.outHeight)
        putString("mimeType", if (jpeg) "image/jpeg" else "application/octet-stream")
      })
    } catch (e: Exception) {
      File(tempPath).delete()
      promise.reject("SEAL_FAILED", e.message ?: e.javaClass.simpleName)
    }
  }

  private fun decryptToMemory(sealed: File): ByteArray {
    val out = ByteArrayOutputStream()
    FileInputStream(sealed).use { CryptoFormat.open(KeystoreManager.evidenceKey(), it, out, MAX_BYTES) }
    return out.toByteArray()
  }

  /** Downsampled luminance for the EXPERIMENTAL screen-recapture estimator (JS side). */
  @ReactMethod
  fun lumaThumbnail(sealedPath: String, size: Int, promise: Promise) = io.execute {
    try {
      val bytes = decryptToMemory(requireInside(evidenceDir, sealedPath))
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      var sample = 1
      while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= size * 2) sample *= 2
      val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
          ?: throw IllegalStateException("decode failed")
      val scaled = Bitmap.createScaledBitmap(bmp, size, size, true)
      val px = IntArray(size * size)
      scaled.getPixels(px, 0, size, 0, 0, size, size)
      val luma = ByteArray(px.size) { i ->
        val c = px[i]
        ((0.299 * ((c shr 16) and 0xFF) + 0.587 * ((c shr 8) and 0xFF) + 0.114 * (c and 0xFF)).toInt()).toByte()
      }
      if (scaled !== bmp) scaled.recycle()
      bmp.recycle()
      promise.resolve(Arguments.createMap().apply {
        putInt("width", size); putInt("height", size); putString("base64", Base64.encodeToString(luma, Base64.NO_WRAP))
      })
    } catch (e: Exception) {
      promise.reject("THUMBNAIL_FAILED", e.message)
    }
  }

  /** Decrypts to a short-lived temp file for upload after re-checking the SHA-256. */
  @ReactMethod
  fun openForUpload(sealedPath: String, expectedSha256: String, promise: Promise) = io.execute {
    val tmp = File(uploadDir, "${ByteArray(12).also { SecureRandom().nextBytes(it) }.let(CryptoFormat::hex)}.jpg")
    try {
      val sha = FileInputStream(requireInside(evidenceDir, sealedPath)).use { input -> FileOutputStream(tmp).use { CryptoFormat.open(KeystoreManager.evidenceKey(), input, it, MAX_BYTES) } }
      if (sha != expectedSha256) {
        tmp.delete()
        return@execute promise.reject("LOCAL_EVIDENCE_CORRUPTED", "Sealed file no longer matches its recorded SHA-256")
      }
      promise.resolve(tmp.absolutePath)
    } catch (e: Exception) {
      tmp.delete()
      promise.reject("OPEN_FAILED", e.message)
    }
  }

  @ReactMethod
  fun deleteTemp(path: String, promise: Promise) {
    try { requireInside(uploadDir, path).delete(); promise.resolve(null) } catch (e: Exception) { promise.reject("DELETE_FAILED", e.message) }
  }

  /** Only called by retention after server verification, or for captures that never entered the ledger. */
  @ReactMethod
  fun discardSealed(path: String, promise: Promise) {
    try { requireInside(evidenceDir, path).delete(); promise.resolve(null) } catch (e: Exception) { promise.reject("DELETE_FAILED", e.message) }
  }

  @ReactMethod
  fun storageStats(promise: Promise) {
    val files = evidenceDir.listFiles { f -> f.name.endsWith(".enc") } ?: emptyArray()
    promise.resolve(Arguments.createMap().apply {
      putInt("sealedFiles", files.size)
      putDouble("sealedBytes", files.sumOf { it.length() }.toDouble())
      putDouble("freeBytes", StatFs(ctx.filesDir.path).availableBytes.toDouble())
    })
  }

  companion object {
    const val REQUEST_CAPTURE = 4711
    const val MAX_BYTES = 8L * 1024 * 1024
  }
}
