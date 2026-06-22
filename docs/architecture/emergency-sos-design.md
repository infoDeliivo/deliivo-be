# Emergency SOS Design

Status: Initial implementation design  
Date: 2026-06-20

## Purpose

Emergency SOS is a high-priority safety signal for riders and drivers during ride discovery, booking, and ride-day operations. It is separate from normal disputes and user reports because it should be visible immediately to admins and support.

## First Slice

- Authenticated rider or driver can create an SOS alert from ride detail screens.
- Alert stores user, ride, booking, role, location, message, status, and timestamps.
- Alert notifies all admins through the existing persisted notification pipeline.
- Web UI shows a clear SOS button on rider and driver ride detail pages.
- Web chat remains disabled, so SOS does not depend on chat.

## Data Model

`EmergencyAlert`

- `id`
- `userId`
- `rideId`
- `bookingId`
- `role`
- `status`: `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `FALSE_ALARM`
- `message`
- `lat`
- `lng`
- `createdAt`
- `acknowledgedAt`
- `resolvedAt`
- `resolvedBy`

## Backend API

```txt
POST /api/v1/safety/sos
```

Body:

```json
{
  "rideId": "optional ride id",
  "bookingId": "optional booking id",
  "role": "RIDER",
  "message": "optional detail",
  "lat": 59.437,
  "lng": 24.7536
}
```

Response:

```json
{
  "success": true,
  "message": "Emergency alert created",
  "data": { "id": "..." }
}
```

## Notification Policy

Admin notification type:

```txt
emergency_sos
```

Payload should include:

- alert ID;
- ride ID;
- booking ID;
- reporting user ID;
- role;
- location if available;
- created timestamp.

## Future Admin Work

- Admin SOS queue.
- Acknowledge/resolved workflow.
- Escalation contacts.
- SMS/email escalation for admins.
- Emergency contact sharing.
- Location timeline review.
- False alarm handling.
- Audit trail and SLA dashboard.

## Important Product Boundary

SOS is not a replacement for local emergency services. The UI copy should clearly say that users should contact local emergency services immediately if they are in danger.
