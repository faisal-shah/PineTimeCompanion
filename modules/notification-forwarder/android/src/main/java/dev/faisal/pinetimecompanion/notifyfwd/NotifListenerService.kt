package dev.faisal.pinetimecompanion.notifyfwd

import android.service.notification.NotificationListenerService

// Captures posted phone notifications once the user grants Notification Access.
// Phase 1 stub (so the manifest <service> resolves); Phase 2 wires
// onNotificationPosted -> NotificationFilter -> ConnectionManager.
class NotifListenerService : NotificationListenerService()
