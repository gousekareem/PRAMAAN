package com.pramaan.mobile.duty

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** Fires at the check-in time (posts the prompt) and at the deadline (posts a "window passed" notice). */
class CheckinAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val id = intent.getStringExtra(EXTRA_ID) ?: return
    val prefs = DutyPrefs(ctx)
    if (prefs.alarmCheckinId != id) return // stale alarm for a superseded check-in
    val missed = intent.action == ACTION_DEADLINE
    if (!missed) prefs.pendingLaunchCheckin = id
    Notifications.showCheckin(ctx, id, missed)
  }

  companion object {
    const val ACTION_TRIGGER = "com.pramaan.mobile.CHECKIN_TRIGGER"
    const val ACTION_DEADLINE = "com.pramaan.mobile.CHECKIN_DEADLINE"
    const val EXTRA_ID = "checkinId"
    private const val RC_TRIGGER = 7001
    private const val RC_DEADLINE = 7002

    private fun pi(ctx: Context, action: String, id: String?, rc: Int): PendingIntent =
        PendingIntent.getBroadcast(ctx, rc, Intent(ctx, CheckinAlarmReceiver::class.java).setAction(action).putExtra(EXTRA_ID, id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun canExact(ctx: Context): Boolean {
      val am = ctx.getSystemService(AlarmManager::class.java)
      return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
    }

    /** Single fixed request code per alarm type → re-scheduling replaces, never duplicates. */
    fun schedule(ctx: Context, id: String, triggerAt: Long, deadline: Long) {
      val prefs = DutyPrefs(ctx)
      prefs.alarmCheckinId = id
      prefs.alarmTriggerMs = triggerAt
      prefs.alarmDeadlineMs = deadline
      val am = ctx.getSystemService(AlarmManager::class.java)
      for ((action, at, rc) in listOf(Triple(ACTION_TRIGGER, triggerAt, RC_TRIGGER), Triple(ACTION_DEADLINE, deadline, RC_DEADLINE))) {
        val p = pi(ctx, action, id, rc)
        if (canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p) // inexact: may be delayed by Doze
      }
    }

    fun cancel(ctx: Context) {
      val am = ctx.getSystemService(AlarmManager::class.java)
      am.cancel(pi(ctx, ACTION_TRIGGER, null, RC_TRIGGER))
      am.cancel(pi(ctx, ACTION_DEADLINE, null, RC_DEADLINE))
      DutyPrefs(ctx).alarmCheckinId = null
    }
  }
}
