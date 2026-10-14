#!/usr/bin/env bash
# Compiles and runs the Android-independent Kotlin unit tests (CryptoFormat, PostureRules) on a
# plain JVM using the Kotlin compiler bundled with Gradle. The full Android unit-test task is
# `cd apps/mobile/android && ./gradlew testDebugUnitTest` (needs the Android SDK + Maven access).
set -euo pipefail
L="${GRADLE_LIB:-/opt/gradle-8.14.3/lib}"
KV=$(ls "$L" | sed -n 's/^kotlin-compiler-embeddable-\(.*\)\.jar$/\1/p' | head -1)
[ -n "$KV" ] || { echo "kotlin-compiler-embeddable not found in $L"; exit 2; }
CP="$L/kotlin-compiler-embeddable-$KV.jar:$L/kotlin-stdlib-$KV.jar:$L/kotlin-script-runtime-$KV.jar:$L/kotlin-reflect-$KV.jar:$L/kotlin-daemon-embeddable-$KV.jar:$(ls $L/trove4j-*.jar):$(ls $L/annotations-*.jar | head -1):$(ls $L/kotlinx-coroutines-core-jvm-*.jar)"
TEST_CP="$L/kotlin-stdlib-$KV.jar:$(ls $L/junit-4*.jar):$(ls $L/hamcrest-core-*.jar)"
A="$(cd "$(dirname "$0")/.." && pwd)/apps/mobile/android/app/src"
OUT="$(mktemp -d)"
java -cp "$CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -nowarn -no-stdlib -cp "$TEST_CP" -d "$OUT" \
  "$A/main/java/com/pramaan/mobile/security/CryptoFormat.kt" "$A/main/java/com/pramaan/mobile/security/PostureRules.kt" \
  "$A/test/java/com/pramaan/mobile/CryptoFormatTest.kt" "$A/test/java/com/pramaan/mobile/DevicePostureTest.kt"
java -cp "$OUT:$TEST_CP" org.junit.runner.JUnitCore com.pramaan.mobile.CryptoFormatTest com.pramaan.mobile.DevicePostureTest
