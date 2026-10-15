# Metro Android release bundle

Command: `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output index.android.bundle --reset-cache` (apps/mobile)

Result: bundle written successfully, 1,850,920 bytes (2026-10-15, after the 2.0 upgrade; 1.0: 1,847,677 bytes on 2026-10-13). This verifies JS/TypeScript resolution of the app and the shared packages; it does not compile the Kotlin/Android project.
