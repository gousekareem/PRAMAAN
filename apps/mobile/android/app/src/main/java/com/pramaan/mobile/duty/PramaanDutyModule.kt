package com.pramaan.mobile.duty

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.CellIdentityNr
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

class PramaanDutyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "PramaanDuty"
  private val prefs = DutyPrefs(ctx)
  private val store by lazy { DutyMonitorService.storeFor(ctx) }

  @ReactMethod
  fun startDutyService(dutySessionId: String, plannedEndMs: Double, promise: Promise) {
    try {
      prefs.cleanStop = true // a fresh, user-initiated start is not a "restart"
      val i = Intent(ctx, DutyMonitorService::class.java)
          .putExtra(DutyMonitorService.EXTRA_DUTY, dutySessionId)
          .putExtra(DutyMonitorService.EXTRA_END, plannedEndMs.toLong())
      ContextCompat.startForegroundService(ctx, i)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("SERVICE_START_FAILED", e.message)
    }
  }

  @ReactMethod
  fun stopDutyService(promise: Promise) {
    ctx.startService(Intent(ctx, DutyMonitorService::class.java).setAction(DutyMonitorService.ACTION_STOP))
    promise.resolve(null)
  }

  @ReactMethod
  fun isServiceRunning(promise: Promise) = promise.resolve(prefs.serviceRunning)

  @ReactMethod
  fun peekObservations(max: Int, promise: Promise) {
    try { promise.resolve(store.peek(max.coerceIn(1, 2000)).toString()) } catch (e: Exception) { promise.reject("BUFFER_READ_FAILED", e.message) }
  }

  @ReactMethod
  fun removeObservations(count: Int, promise: Promise) {
    try { store.remove(count); promise.resolve(null) } catch (e: Exception) { promise.reject("BUFFER_WRITE_FAILED", e.message) }
  }

  private fun granted(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

  private fun unavailableLocation(reason: String): WritableMap = Arguments.createMap().apply {
    putString("availability", reason)
    listOf("latitude", "longitude", "horizontalAccuracyM", "observedAtDeviceTime", "fixAgeMs", "provider", "speedMps", "mockIndicator", "mockIndicatorSource").forEach { putNull(it) }
  }

  /** Best fresh fix for evidence capture; returns availability instead of fabricating coordinates. */
  @SuppressLint("MissingPermission")
  @ReactMethod
  fun currentLocation(timeoutMs: Int, promise: Promise) {
    if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) return promise.resolve(unavailableLocation("PERMISSION_DENIED"))
    val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { lm.isProviderEnabled(it) }
    if (providers.isEmpty()) return promise.resolve(unavailableLocation("UNAVAILABLE"))
    var done = false
    val handler = Handler(Looper.getMainLooper())
    val finish = { loc: Location? ->
      if (!done) {
        done = true
        if (loc == null) promise.resolve(unavailableLocation("UNAVAILABLE")) else promise.resolve(toMap(loc))
      }
    }
    val listener = object : android.location.LocationListener {
      override fun onLocationChanged(l: Location) { lm.removeUpdates(this); finish(l) }
      override fun onProviderDisabled(p: String) = Unit
      override fun onProviderEnabled(p: String) = Unit
      @Deprecated("API 29") override fun onStatusChanged(p: String?, s: Int, e: android.os.Bundle?) = Unit
    }
    handler.post { providers.forEach { lm.requestLocationUpdates(it, 0L, 0f, listener, Looper.getMainLooper()) } }
    handler.postDelayed({
      lm.removeUpdates(listener)
      // Fall back to the freshest last-known fix (< 2 min old) with its real age, else unavailable.
      val last = providers.mapNotNull { lm.getLastKnownLocation(it) }.maxByOrNull { it.elapsedRealtimeNanos }
      finish(last?.takeIf { ageMs(it) < 120_000 })
    }, timeoutMs.toLong().coerceIn(2_000, 60_000))
  }

  private fun ageMs(l: Location) = (SystemClock.elapsedRealtimeNanos() - l.elapsedRealtimeNanos) / 1_000_000

  private fun toMap(l: Location): WritableMap = Arguments.createMap().apply {
    putString("availability", "AVAILABLE")
    putDouble("latitude", l.latitude)
    putDouble("longitude", l.longitude)
    if (l.hasAccuracy()) putDouble("horizontalAccuracyM", l.accuracy.toDouble()) else putNull("horizontalAccuracyM")
    putString("observedAtDeviceTime", DutyMonitorService.iso(l.time))
    putDouble("fixAgeMs", ageMs(l).coerceAtLeast(0).toDouble())
    putString("provider", l.provider ?: "unknown")
    if (l.hasSpeed()) putDouble("speedMps", l.speed.toDouble()) else putNull("speedMps")
    val mock = if (Build.VERSION.SDK_INT >= 31) l.isMock else @Suppress("DEPRECATION") l.isFromMockProvider
    putBoolean("mockIndicator", mock)
    putString("mockIndicatorSource", if (Build.VERSION.SDK_INT >= 31) "Location.isMock" else "Location.isFromMockProvider")
  }

  /**
   * Cellular observations exactly as Android returns them. Requires ACCESS_FINE_LOCATION; values
   * Android reports as unavailable/redacted (Integer.MAX_VALUE) become null — never invented.
   */
  @SuppressLint("MissingPermission")
  @ReactMethod
  fun cellInfo(promise: Promise) {
    val out = Arguments.createMap()
    val arr = Arguments.createArray()
    if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
      out.putString("availability", "PERMISSION_DENIED"); out.putArray("observations", arr); return promise.resolve(out)
    }
    val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    val cells = try { tm?.allCellInfo } catch (e: SecurityException) { null }
    if (tm == null || cells == null) {
      out.putString("availability", if (tm == null) "NOT_SUPPORTED" else "UNAVAILABLE"); out.putArray("observations", arr); return promise.resolve(out)
    }
    fun v(i: Int) = if (i == Int.MAX_VALUE || i < 0) null else i
    fun put(radio: String, reg: Boolean, mcc: String?, mnc: String?, area: Int?, cid: Long?, dbm: Int?) {
      arr.pushMap(Arguments.createMap().apply {
        putString("radio", radio); putBoolean("registered", reg)
        if (mcc == null) putNull("mcc") else putString("mcc", mcc)
        if (mnc == null) putNull("mnc") else putString("mnc", mnc)
        if (area == null) putNull("areaCode") else putInt("areaCode", area)
        if (cid == null || cid > Int.MAX_VALUE) putNull("cellId") else putInt("cellId", cid.toInt())
        if (dbm == null || dbm > 0 || dbm < -200) putNull("signalDbm") else putInt("signalDbm", dbm)
      })
    }
    for (c in cells.take(16)) {
      when {
        c is CellInfoLte -> c.cellIdentity.let { put("LTE", c.isRegistered, if (Build.VERSION.SDK_INT >= 28) it.mccString else null, if (Build.VERSION.SDK_INT >= 28) it.mncString else null, v(it.tac), v(it.ci)?.toLong(), c.cellSignalStrength.dbm) }
        c is CellInfoGsm -> c.cellIdentity.let { put("GSM", c.isRegistered, if (Build.VERSION.SDK_INT >= 28) it.mccString else null, if (Build.VERSION.SDK_INT >= 28) it.mncString else null, v(it.lac), v(it.cid)?.toLong(), c.cellSignalStrength.dbm) }
        c is CellInfoWcdma -> c.cellIdentity.let { put("WCDMA", c.isRegistered, if (Build.VERSION.SDK_INT >= 28) it.mccString else null, if (Build.VERSION.SDK_INT >= 28) it.mncString else null, v(it.lac), v(it.cid)?.toLong(), c.cellSignalStrength.dbm) }
        Build.VERSION.SDK_INT >= 29 && c is CellInfoNr -> (c.cellIdentity as CellIdentityNr).let { put("NR", c.isRegistered, it.mccString, it.mncString, v(it.tac), it.nci.takeIf { n -> n != Long.MAX_VALUE }, c.cellSignalStrength.dbm) }
      }
    }
    out.putString("availability", if (arr.size() > 0) "AVAILABLE" else "UNAVAILABLE")
    out.putArray("observations", arr)
    promise.resolve(out)
  }

  /** One-shot read of TYPE_STEP_COUNTER (steps since boot) or null when unavailable. */
  @ReactMethod
  fun stepsSinceBoot(promise: Promise) {
    val activityOk = Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACTIVITY_RECOGNITION)
    val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val sensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (!activityOk || sensor == null) return promise.resolve(null)
    var done = false
    val l = object : SensorEventListener {
      override fun onSensorChanged(e: SensorEvent) { if (!done) { done = true; sm.unregisterListener(this); promise.resolve(e.values[0].toDouble()) } }
      override fun onAccuracyChanged(s: Sensor?, a: Int) = Unit
    }
    sm.registerListener(l, sensor, SensorManager.SENSOR_DELAY_FASTEST)
    Handler(Looper.getMainLooper()).postDelayed({ if (!done) { done = true; sm.unregisterListener(l); promise.resolve(null) } }, 3_000)
  }

  @ReactMethod
  fun scheduleCheckinAlarm(checkinId: String, triggerAtWallMs: Double, deadlineWallMs: Double, promise: Promise) {
    CheckinAlarmReceiver.schedule(ctx, checkinId, triggerAtWallMs.toLong(), deadlineWallMs.toLong())
    promise.resolve(null)
  }

  @ReactMethod
  fun cancelCheckinAlarm(promise: Promise) { CheckinAlarmReceiver.cancel(ctx); promise.resolve(null) }

  @ReactMethod
  fun consumeLaunchCheckin(promise: Promise) {
    val id = prefs.pendingLaunchCheckin
    prefs.pendingLaunchCheckin = null
    promise.resolve(id?.takeIf { Regex("^[0-9a-f-]{36}$").matches(it) })
  }

  @ReactMethod
  fun canScheduleExactAlarms(promise: Promise) = promise.resolve(CheckinAlarmReceiver.canExact(ctx))

  @ReactMethod
  fun openExactAlarmSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT >= 31) {
      currentActivity?.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}")))
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) =
      promise.resolve((ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName))

  /** Opens the system list (no REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission is used). */
  @ReactMethod
  fun openBatteryOptimizationSettings(promise: Promise) {
    currentActivity?.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    promise.resolve(null)
  }
}
