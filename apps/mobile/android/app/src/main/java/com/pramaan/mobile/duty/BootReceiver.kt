package com.pramaan.mobile.duty

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/**
 * After a reboot: re-arms the outstanding check-in alarm and asks the officer to reopen the app.
 * It does NOT silently restart location collection from the background (Android restricts
 * starting location foreground services without a visible user action); the gap is recorded.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED) return
    val prefs = DutyPrefs(ctx)
    val id = prefs.alarmCheckinId
    if (id != null && prefs.alarmDeadlineMs > System.currentTimeMillis()) {
      CheckinAlarmReceiver.schedule(ctx, id, maxOf(prefs.alarmTriggerMs, System.currentTimeMillis() + 5_000), prefs.alarmDeadlineMs)
    }
    if (prefs.serviceRunning && intent.action == Intent.ACTION_BOOT_COMPLETED) {
      prefs.cleanStop = false
      try {
        DutyMonitorService.storeFor(ctx).append(JSONObject().put("kind", "SERVICE").put("state", "BOOT_RECOVERY").put("detail", "Device rebooted during an active duty session"))
      } catch (e: Exception) { /* keystore may be locked before first unlock */ }
      Notifications.showResume(ctx)
    }
  }
}
