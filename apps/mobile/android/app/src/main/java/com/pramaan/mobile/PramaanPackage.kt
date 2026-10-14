package com.pramaan.mobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.pramaan.mobile.duty.PramaanDutyModule
import com.pramaan.mobile.evidence.PramaanEvidenceModule
import com.pramaan.mobile.security.PramaanSecurityModule

/** Registers PRAMAAN's legacy-bridge native modules (served through the New Architecture interop layer). */
class PramaanPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
      listOf(PramaanSecurityModule(context), PramaanEvidenceModule(context), PramaanDutyModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
