package com.pramaan.mobile

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.pramaan.mobile.duty.DutyPrefs

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "PramaanMobile"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    // Evidence, hashes and check-in codes must not appear in screenshots or the recents screen.
    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    rememberCheckin(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    rememberCheckin(intent)
  }

  private fun rememberCheckin(intent: Intent?) {
    val id = intent?.getStringExtra(EXTRA_CHECKIN_ID) ?: return
    DutyPrefs(this).pendingLaunchCheckin = id
  }

  companion object {
    const val EXTRA_CHECKIN_ID = "com.pramaan.mobile.CHECKIN_ID"
  }
}
