package com.pramaan.mobile.evidence

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.extensions.ExtensionMode
import androidx.camera.extensions.ExtensionsManager
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.io.File
import java.util.UUID

/**
 * In-app evidence camera (CameraX). Captures straight to a private cache file; there is no
 * gallery, document picker or share-target path. Low-light: CameraX NIGHT extension when the
 * device vendor provides it, otherwise automatic flash. Not exported (see manifest).
 */
class CaptureActivity : AppCompatActivity() {
  private var imageCapture: ImageCapture? = null
  private var provider: ProcessCameraProvider? = null
  private var nightAvailable = false
  private var extensions: ExtensionsManager? = null
  private var nightEnabled = false
  private lateinit var previewView: PreviewView
  private lateinit var status: TextView
  private lateinit var nightButton: Button

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE)
    previewView = PreviewView(this).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE }
    status = TextView(this).apply { setTextColor(Color.WHITE); setPadding(24, 24, 24, 8); text = "Point at the patrol location and capture" }
    val capture = Button(this).apply { text = "Capture"; setOnClickListener { takePhoto() } }
    nightButton = Button(this).apply { text = "Low-light: off"; isEnabled = false; setOnClickListener { nightEnabled = !nightEnabled; bind() } }
    val cancel = Button(this).apply { text = "Cancel"; setOnClickListener { setResult(Activity.RESULT_CANCELED); finish() } }
    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      setBackgroundColor(0xAA0F2133.toInt())
      addView(cancel); addView(nightButton); addView(capture)
    }
    val root = FrameLayout(this)
    root.addView(previewView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    root.addView(status, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
    root.addView(bar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    setContentView(root)
    val future = ProcessCameraProvider.getInstance(this)
    future.addListener({
      provider = future.get()
      val ext = ExtensionsManager.getInstanceAsync(this, provider!!)
      ext.addListener({
        extensions = try { ext.get() } catch (e: Exception) { null }
        nightAvailable = extensions?.isExtensionAvailable(CameraSelector.DEFAULT_BACK_CAMERA, ExtensionMode.NIGHT) ?: false
        nightButton.isEnabled = nightAvailable
        if (!nightAvailable) nightButton.text = "Low-light: flash auto"
        bind()
      }, ContextCompat.getMainExecutor(this))
    }, ContextCompat.getMainExecutor(this))
  }

  private fun bind() {
    val p = provider ?: return
    p.unbindAll()
    var selector = CameraSelector.DEFAULT_BACK_CAMERA
    val ext = extensions
    if (nightEnabled && nightAvailable && ext != null) {
      selector = ext.getExtensionEnabledCameraSelector(selector, ExtensionMode.NIGHT)
    }
    nightButton.text = if (nightEnabled) "Low-light: night" else if (nightAvailable) "Low-light: off" else "Low-light: flash auto"
    val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
    imageCapture = ImageCapture.Builder()
        .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
        .setFlashMode(if (nightEnabled) ImageCapture.FLASH_MODE_OFF else ImageCapture.FLASH_MODE_AUTO)
        .setJpegQuality(92)
        .build()
    p.bindToLifecycle(this, selector, preview, imageCapture)
  }

  private fun takePhoto() {
    val ic = imageCapture ?: return
    val dir = File(cacheDir, "capture").apply { mkdirs() }
    val file = File(dir, "${UUID.randomUUID()}.jpg")
    status.text = "Capturing…"
    ic.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(this), object : ImageCapture.OnImageSavedCallback {
      override fun onImageSaved(out: ImageCapture.OutputFileResults) {
        setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_PATH, file.absolutePath).putExtra(EXTRA_API, if (nightEnabled) "CameraX ImageCapture + NIGHT extension" else "CameraX ImageCapture"))
        finish()
      }
      override fun onError(e: ImageCaptureException) {
        file.delete()
        status.text = "Capture failed: ${e.imageCaptureError}"
      }
    })
  }

  companion object {
    const val EXTRA_PATH = "path"
    const val EXTRA_API = "api"
  }
}
