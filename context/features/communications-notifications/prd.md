# PRD: Communications And Notifications

## Purpose

Keep users informed about marketplace events and support direct communication where needed.

## Users

- Rider: receives booking, payment, driver decision, ride-day, cancellation, and dispute notifications.
- Driver: receives publish, booking request, rider action, cancellation, ride-day, and payout notifications.
- Admin: may receive operational alerts and review notification state during support.

## Current Capabilities

- Persisted notification records.
- Socket.IO realtime events.
- Firebase Admin integration for push-capable clients.
- Notification panel in the web portal.
- Chat module.
- Mail and SMS worker modules.

## Functional Requirements

- Ride publish, booking request, payment, approval, rejection, cancellation, ride-day, no-show, dropoff, completion, dispute, and payout events should produce notifications where relevant.
- Notifications must contain enough context: ride route, date/time, actor, status, and a deep link when possible.
- Web notification panel must show persisted notifications after reload.
- Realtime notification events should update panels and surface on-screen feedback when the user is active.
- Web notification surfaces must reconcile from persisted notifications on focus and periodic refresh so missed socket events do not leave the UI stale.
- Browser push may be enabled for web users when Firebase public config and VAPID key are configured; in-app notifications remain required even without browser push.
- Chat remains a backend capability, but the web portal chat UI is disabled by default through `NEXT_PUBLIC_ENABLE_WEB_CHAT=false`.
- Emergency SOS notifications must be stored for admins and should surface through the same persisted plus realtime notification path.
- Email and SMS workers should handle out-of-band messages without blocking user actions.

## Non-Functional Requirements

- Notification delivery should be best effort but state changes must remain durable.
- Socket events should not be the only mechanism for UI state correctness.
- Notification payloads must avoid leaking sensitive payment or identity details.
- Workers should be retryable and observable.

## Success Metrics

- Notification creation count by event type.
- Realtime delivery latency.
- Notification panel reconciliation latency.
- Notification panel open rate.
- Missed notification support tickets.
- Mail and SMS queue failure rate.

## Code References

- `src/modules/notification`
- `src/modules/chat`
- `src/modules/safety`
- `src/modules/mail`
- `src/modules/sms`
- `src/realtime`
- `web/src/components/NotificationPanel.tsx`
- `web/src/app/profile/notifications`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#notification-delivery-flow`.
- See `../../08-feature-decisions-bottlenecks.md#communications-and-notifications` for final decisions, open questions, and bottlenecks.
