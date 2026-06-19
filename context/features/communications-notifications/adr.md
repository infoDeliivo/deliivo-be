# ADR: Communications And Notifications Architecture

## Status

Accepted as current architecture with reliability refinements.

## Context

Users need quick feedback for actions across separate sessions and devices. However, realtime channels can disconnect, reload, or miss events. The system also supports mobile clients, where Firebase push can complement web socket behavior.

## Decision

Use persisted Notification records as the durable notification source. Emit Socket.IO events for active web sessions. Use Firebase Admin for push-capable clients. Use mail and SMS workers for out-of-band communication. UI screens should refetch canonical state after actions and use notification events as acceleration, not authority.

## Rationale

- Persisted notifications survive reload and offline periods.
- Socket.IO provides low-latency web updates.
- Firebase keeps the architecture compatible with mobile app push.
- Worker queues isolate slow external providers from request paths.

## Consequences

- Every important domain event needs explicit notification creation, not only socket emission.
- Notification payload design matters because it drives UX and deep links.
- Clients must handle duplicate or delayed events.
- Mobile and web can share notification backend behavior while using different presentation layers.

## Alternatives Considered

- Socket-only notifications. Rejected because reloads and disconnects lose events.
- Firebase-only notifications. Rejected for web portal state synchronization and existing Socket.IO integration.
- Polling-only notifications. Rejected because ride-day UX needs faster active-session feedback.

## Code References

- `src/modules/notification`
- `src/realtime`
- `src/modules/mail`
- `src/modules/sms`
- `web/src/lib/socket`
- `web/src/components/NotificationPanel.tsx`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#communications-and-notifications`.
- Supporting notification delivery diagrams are in `../../07-architecture-and-flow-diagrams.md`.
