package com.pramaan.mobile.duty

import android.Manifest
import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.pramaan.mobile.security.KeystoreManager
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.sqrt
import org.json.JSONObject

/**
 * Foreground service for an explicitly started duty session (type "location").
 * It is NOT unkillable: Android, OEM battery managers, force-stop and permission revocation can
 * stop it. It records its own lifecycle (start, stop, restart after an unclean exit) so gaps are
 * visible to reviewers instead of hidden. No camera, microphone or background location is used.
 */
class DutyMonitorService : Service(), LocationListener, SensorEventListener {
  private lateinit var prefs: DutyPrefs
  private lateinit var store: ObservationStore
  private val handler = Handler(Looper.getMainLooper())
  private var sensors: SensorManager? = null
  private var location: LocationManager? = null
  private var lastStepsWrite = 0L
  private var lastSteps = -1f
  private var motionState = "UNKNOWN"
  private val accel = ArrayList<Float>(64)
  private var sampling = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    prefs = DutyPrefs(this)
    store = storeFor(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    if (action == ACTION_STOP) {
      record(JSONObject().put("kind", "SERVICE").put("state", "STOPPED").put("detail", "Stopped by officer/app"))
      prefs.cleanStop = true
      prefs.serviceRunning = false
      stopEverything()
      stopSelf()
      return START_NOT_STICKY
    }
    val restarted = intent == null || (prefs.serviceRunning && !prefs.cleanStop)
    intent?.getStringExtra(EXTRA_DUTY)?.let { prefs.dutySessionId = it }
    intent?.getLongExtra(EXTRA_END, 0)?.takeIf { it > 0 }?.let { prefs.plannedEndMs = it }
    if (prefs.dutySessionId == null) { stopSelf(); return START_NOT_STICKY }

    val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    try {
      val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
      ServiceCompat.startForeground(this, Notifications.DUTY_ID, Notifications.dutyNotification(this, "Recording location and step observations for this duty"), type)
    } catch (e: Exception) {
      // Android 12+ may refuse a foreground start from the background; Android 14 requires location permission.
      record(JSONObject().put("kind", "SENSOR_UNAVAILABLE").put("sensor", "LOCATION").put("reason", "FOREGROUND_START_REFUSED:${e.javaClass.simpleName}"))
      stopSelf()
      return START_NOT_STICKY
    }
    if (restarted) {
      val gap = if (prefs.lastHeartbeatMs > 0) (System.currentTimeMillis() - prefs.lastHeartbeatMs) / 1000 else -1
      record(JSONObject().put("kind", "SERVICE").put("state", if (intent == null) "RESTARTED" else "UNEXPECTED_TERMINATION_DETECTED").put("detail", "Previous run ended without a clean stop; heartbeat gap ${gap}s"))
    } else {
      record(JSONObject().put("kind", "SERVICE").put("state", "STARTED").put("detail", "Duty monitoring started"))
    }
    prefs.serviceRunning = true
    prefs.cleanStop = false
    if (fine) startLocation() else record(JSONObject().put("kind", "PERMISSION_REVOKED").put("sensor", "LOCATION").put("permission", "ACCESS_FINE_LOCATION"))
    startSensors()
    handler.post(heartbeat)
    return START_STICKY
  }

  @SuppressLint("MissingPermission")
  private fun startLocation() {
    val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
    location = lm
    var any = false
    for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
      if (lm.allProviders.contains(provider)) {
        // 60 s / 10 m: balances evidential value against battery use (data minimisation).
        lm.requestLocationUpdates(provider, 60_000L, 10f, this, Looper.getMainLooper())
        any = true
      }
    }
    if (!any) record(JSONObject().put("kind", "SENSOR_UNAVAILABLE").put("sensor", "LOCATION").put("reason", "NO_PROVIDER"))
  }

  private fun startSensors() {
    val sm = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    sensors = sm
    val activityOk = Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
    val step = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    when {
      !activityOk -> record(JSONObject().put("kind", "PERMISSION_REVOKED").put("sensor", "STEP_COUNTER").put("permission", "ACTIVITY_RECOGNITION"))
      step == null -> record(JSONObject().put("kind", "SENSOR_UNAVAILABLE").put("sensor", "STEP_COUNTER").put("reason", "NOT_PRESENT"))
      else -> sm.registerListener(this, step, SensorManager.SENSOR_DELAY_NORMAL, 60_000_000) // batched, 60 s max latency
    }
    if (sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) == null) {
      record(JSONObject().put("kind", "SENSOR_UNAVAILABLE").put("sensor", "ACCELEROMETER").put("reason", "NOT_PRESENT"))
    }
  }

  /** Every 60 s: heartbeat, permission re-check, short 3 s accelerometer window, duty end check. */
  private val heartbeat = object : Runnable {
    override fun run() {
      prefs.lastHeartbeatMs = System.currentTimeMillis()
      if (prefs.plannedEndMs > 0 && System.currentTimeMillis() > prefs.plannedEndMs + GRACE_MS) {
        record(JSONObject().put("kind", "SERVICE").put("state", "STOPPED").put("detail", "Planned duty end + grace reached"))
        prefs.cleanStop = true
        prefs.serviceRunning = false
        stopEverything()
        stopSelf()
        return
      }
      if (location != null && ContextCompat.checkSelfPermission(this@DutyMonitorService, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
        record(JSONObject().put("kind", "PERMISSION_REVOKED").put("sensor", "LOCATION").put("permission", "ACCESS_FINE_LOCATION"))
        location?.removeUpdates(this@DutyMonitorService)
        location = null
      }
      sampleMotion()
      handler.postDelayed(this, 60_000)
    }
  }

  private fun sampleMotion() {
    val sm = sensors ?: return
    val acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
    if (sampling) return
    sampling = true
    accel.clear()
    sm.registerListener(this, acc, SensorManager.SENSOR_DELAY_UI)
    handler.postDelayed({
      sm.unregisterListener(this, acc)
      sampling = false
      if (accel.size >= 10) {
        val mean = accel.average()
        val sd = sqrt(accel.map { (it - mean) * (it - mean) }.average())
        val next = if (sd < 0.25) "STILL" else if (sd < 2.5) "MOVING_LIGHT" else "MOVING_VIGOROUS"
        if (next != motionState) {
          record(JSONObject().put("kind", "MOTION").put("from", motionState).put("to", next).put("confidence", if (accel.size > 30) 0.7 else 0.5))
          motionState = next
        }
      }
    }, 3_000)
  }

  override fun onLocationChanged(loc: Location) {
    val mock = when {
      Build.VERSION.SDK_INT >= 31 -> loc.isMock
      else -> @Suppress("DEPRECATION") loc.isFromMockProvider
    }
    val o = JSONObject()
        .put("kind", "LOCATION")
        .put("latitude", loc.latitude)
        .put("longitude", loc.longitude)
        .put("accuracyM", if (loc.hasAccuracy()) loc.accuracy.toDouble() else JSONObject.NULL)
        .put("speedMps", if (loc.hasSpeed()) loc.speed.toDouble() else JSONObject.NULL)
        .put("speedAccuracyMps", if (Build.VERSION.SDK_INT >= 26 && loc.hasSpeedAccuracy()) loc.speedAccuracyMetersPerSecond.toDouble() else JSONObject.NULL)
        .put("provider", loc.provider ?: "unknown")
        .put("fixWallTime", iso(loc.time))
        .put("isMock", mock)
        .put("mockSource", if (Build.VERSION.SDK_INT >= 31) "Location.isMock" else "Location.isFromMockProvider")
    record(o)
  }

  override fun onProviderDisabled(provider: String) {
    record(JSONObject().put("kind", "SENSOR_UNAVAILABLE").put("sensor", "LOCATION").put("reason", "PROVIDER_DISABLED:$provider"))
  }

  override fun onProviderEnabled(provider: String) = Unit
  @Deprecated("Deprecated in API 29") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

  override fun onSensorChanged(e: SensorEvent) {
    when (e.sensor.type) {
      Sensor.TYPE_STEP_COUNTER -> {
        val now = System.currentTimeMillis()
        lastSteps = e.values[0]
        if (now - lastStepsWrite >= 60_000) {
          lastStepsWrite = now
          record(JSONObject().put("kind", "STEPS").put("stepsSinceBoot", lastSteps.toLong()))
        }
      }
      Sensor.TYPE_ACCELEROMETER -> if (sampling && accel.size < 200) {
        val (x, y, z) = Triple(e.values[0], e.values[1], e.values[2])
        accel.add(sqrt(x * x + y * y + z * z))
      }
    }
  }

  override fun onAccuracyChanged(s: Sensor?, a: Int) = Unit

  private fun record(o: JSONObject) {
    try { store.append(o) } catch (e: Exception) { Log.w(TAG, "observation not stored: ${e.javaClass.simpleName}") }
  }

  private fun stopEverything() {
    handler.removeCallbacksAndMessages(null)
    location?.removeUpdates(this)
    sensors?.unregisterListener(this)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
  }

  override fun onDestroy() {
    stopEverything()
    super.onDestroy()
  }

  companion object {
    private const val TAG = "PramaanDuty" // logs never contain coordinates or identifiers
    const val ACTION_STOP = "com.pramaan.mobile.STOP_DUTY"
    const val EXTRA_DUTY = "duty"
    const val EXTRA_END = "end"
    const val GRACE_MS = 30 * 60_000L
    fun storeFor(ctx: Context) = ObservationStore(File(ctx.filesDir, "obs/queue.log"), { KeystoreManager.wrapKey() })
    fun iso(ms: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(ms))
  }
}
