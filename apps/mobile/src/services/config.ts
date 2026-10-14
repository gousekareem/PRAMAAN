/**
 * Build-time configuration. API_BASE_URL is injected by android/app/build.gradle
 * (BuildConfig.PRAMAAN_API_BASE_URL) and exposed via the PramaanSecurity module constants.
 * No credentials or secrets are embedded in the APK.
 */
import { NativeModules } from 'react-native';

const consts =
  (
    NativeModules as { PramaanSecurity?: { getConstants?: () => Record<string, string> } }
  ).PramaanSecurity?.getConstants?.() ?? {};

export const appConfig = {
  apiBaseUrl: consts.apiBaseUrl ?? 'http://10.0.2.2:4000',
  appVersion: consts.appVersion ?? '1.0.0',
  syncIntervalMs: 60_000,
  observationDrainIntervalMs: 30_000,
};
