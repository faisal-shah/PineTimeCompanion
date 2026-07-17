package dev.faisal.pinetimecompanion.notifyfwd

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Expo Module bridging the native notification-forwarder to JS. Phase 1 only
// exposes ping() to prove the local module autolinks and builds; the config /
// status API and the forwarding services are filled in during Phase 2.
class NotificationForwarderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotificationForwarder")

    Function("ping") {
      "pong"
    }
  }
}
