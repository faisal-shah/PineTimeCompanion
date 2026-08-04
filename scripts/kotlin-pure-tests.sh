#!/usr/bin/env bash
# Compile and run the pure-JVM Kotlin helpers of the notification-forwarder
# module in an isolated project — no Android SDK, no Gradle.
#
# The module's real build is an Android library (build.gradle applies
# com.android.library + expo-module-gradle-plugin), which needs the Android SDK
# this environment does not have. The bond-state mapping and repair-decision
# helpers are deliberately Android-free, so they can be compiled with a stock
# kotlinc and run under JUnit 4 on any JDK. This script fetches kotlinc + JUnit
# into a gitignored cache and runs exactly those pure tests.
#
# LIMITATION: this covers only the pure helpers (BondState, CompanionRepair, and
# the pre-existing PauseCounter / ActiveSocketGate). The Android-bound classes
# (NotificationForwarderModule, ConnectionManager, the GATT/sim connections) are
# not compiled here — they need the SDK and a full Gradle build.
set -euo pipefail

cd "$(dirname "$0")/.."

CACHE="${KOTLIN_TEST_CACHE:-.kotlin-jvm-test}"
KOTLIN_VERSION="1.9.24"
KOTLINC="$CACHE/kotlinc/bin/kotlinc"
LIB="$CACHE/lib"
OUT="$CACHE/out"

mkdir -p "$LIB" "$OUT"

if [ ! -x "$KOTLINC" ]; then
  echo "Fetching kotlin-compiler $KOTLIN_VERSION…"
  curl --fail --location --silent --show-error -o "$CACHE/kotlinc.zip" \
    "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip"
  unzip -q -o "$CACHE/kotlinc.zip" -d "$CACHE"
fi

if [ ! -f "$LIB/junit.jar" ] || [ ! -f "$LIB/hamcrest.jar" ]; then
  echo "Fetching JUnit 4…"
  curl --fail --location --silent --show-error \
    -o "$LIB/junit.jar" \
    https://repo.maven.apache.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar
  curl --fail --location --silent --show-error \
    -o "$LIB/hamcrest.jar" \
    https://repo.maven.apache.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar
fi

SRC="modules/notification-forwarder/android/src/main/java/dev/faisal/pinetimecompanion/notifyfwd"
TST="modules/notification-forwarder/android/src/test/java/dev/faisal/pinetimecompanion/notifyfwd"
STDLIB="$CACHE/kotlinc/lib/kotlin-stdlib.jar"

echo "Compiling pure helpers + tests…"
"$KOTLINC" -cp "$LIB/junit.jar:$LIB/hamcrest.jar" \
  "$SRC/BondState.kt" \
  "$SRC/CompanionRepair.kt" \
  "$SRC/PauseCounter.kt" \
  "$SRC/ActiveSocketGate.kt" \
  "$TST/BondStateTest.kt" \
  "$TST/CompanionRepairTest.kt" \
  "$TST/PauseCounterTest.kt" \
  "$TST/ActiveSocketGateTest.kt" \
  -d "$OUT"

echo "Running JUnit…"
java -cp "$OUT:$LIB/junit.jar:$LIB/hamcrest.jar:$STDLIB" org.junit.runner.JUnitCore \
  dev.faisal.pinetimecompanion.notifyfwd.BondStateTest \
  dev.faisal.pinetimecompanion.notifyfwd.CompanionRepairTest \
  dev.faisal.pinetimecompanion.notifyfwd.PauseCounterTest \
  dev.faisal.pinetimecompanion.notifyfwd.ActiveSocketGateTest
