package com.pramaan.mobile.duty

import android.content.Context

/** Small persisted state shared by the service, alarms and boot receiver (no evidence content). */
class DutyPrefs(ctx: Context) {
  private val p = ctx.getSharedPreferences("pramaan_duty", Context.MODE_PRIVATE)

  var dutySessionId: String?
    get() = p.getString("duty", null)
    set(v) { p.edit().putString("duty", v).apply() }
  var plannedEndMs: Long
    get() = p.getLong("planned_end", 0)
    set(v) { p.edit().putLong("planned_end", v).apply() }
  var serviceRunning: Boolean
    get() = p.getBoolean("running", false)
    set(v) { p.edit().putBoolean("running", v).commit() }
  var cleanStop: Boolean
    get() = p.getBoolean("clean_stop", true)
    set(v) { p.edit().putBoolean("clean_stop", v).commit() }
  var lastHeartbeatMs: Long
    get() = p.getLong("heartbeat", 0)
    set(v) { p.edit().putLong("heartbeat", v).apply() }
  var alarmCheckinId: String?
    get() = p.getString("alarm_id", null)
    set(v) { p.edit().putString("alarm_id", v).apply() }
  var alarmTriggerMs: Long
    get() = p.getLong("alarm_at", 0)
    set(v) { p.edit().putLong("alarm_at", v).apply() }
  var alarmDeadlineMs: Long
    get() = p.getLong("alarm_deadline", 0)
    set(v) { p.edit().putLong("alarm_deadline", v).apply() }
  var pendingLaunchCheckin: String?
    get() = p.getString("launch_checkin", null)
    set(v) { p.edit().putString("launch_checkin", v).apply() }
}
