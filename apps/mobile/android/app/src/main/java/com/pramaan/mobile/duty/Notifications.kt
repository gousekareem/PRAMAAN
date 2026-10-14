package com.pramaan.mobile.duty

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.pramaan.mobile.MainActivity
import com.pramaan.mobile.R

object Notifications {
  const val DUTY_CHANNEL = "pramaan_duty"
  const val CHECKIN_CHANNEL = "pramaan_checkin"
  const val DUTY_ID = 1001
  const val CHECKIN_ID = 1002

  fun createChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = ctx.getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(DUTY_CHANNEL, ctx.getString(R.string.duty_channel), NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shown for the whole active duty session while location and step observations are recorded"
    })
    nm.createNotificationChannel(NotificationChannel(CHECKIN_CHANNEL, ctx.getString(R.string.checkin_channel), NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Randomised proof-of-life check-ins"
      enableVibration(true)
    })
  }

  fun openApp(ctx: Context, checkinId: String?): PendingIntent {
    val i = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (checkinId != null) i.putExtra(MainActivity.EXTRA_CHECKIN_ID, checkinId)
    return PendingIntent.getActivity(ctx, if (checkinId != null) 2 else 1, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun dutyNotification(ctx: Context, text: String) =
      NotificationCompat.Builder(ctx, DUTY_CHANNEL)
          .setSmallIcon(R.drawable.ic_stat_pramaan)
          .setContentTitle("PRAMAAN duty session active")
          .setContentText(text)
          .setOngoing(true)
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .setContentIntent(openApp(ctx, null))
          .build()

  fun showCheckin(ctx: Context, checkinId: String, missed: Boolean) {
    val pi = openApp(ctx, checkinId)
    val canFullScreen = Build.VERSION.SDK_INT < 34 || ctx.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
    val b = NotificationCompat.Builder(ctx, CHECKIN_CHANNEL)
        .setSmallIcon(R.drawable.ic_stat_pramaan)
        .setContentTitle(if (missed) "Check-in window passed" else "Duty check-in required")
        .setContentText(if (missed) "Open PRAMAAN — a late response is still recorded separately" else "Respond within 3 minutes: biometric + code")
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setAutoCancel(true)
        .setContentIntent(pi)
    if (!missed && canFullScreen) b.setFullScreenIntent(pi, true)
    try { NotificationManagerCompat.from(ctx).notify(CHECKIN_ID, b.build()) } catch (e: SecurityException) { /* POST_NOTIFICATIONS denied: recorded by JS as a permission state */ }
  }

  fun showResume(ctx: Context) {
    val b = NotificationCompat.Builder(ctx, CHECKIN_CHANNEL)
        .setSmallIcon(R.drawable.ic_stat_pramaan)
        .setContentTitle("Duty session interrupted by restart")
        .setContentText("Open PRAMAAN to resume duty monitoring. The interruption has been recorded.")
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setContentIntent(openApp(ctx, null))
    try { NotificationManagerCompat.from(ctx).notify(CHECKIN_ID + 1, b.build()) } catch (e: SecurityException) { }
  }
}
