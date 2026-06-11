# Phase 4: Dispute & Safety

## Overview
Phase 4 implements the dispute resolution system and family live-tracking feature, enabling riders and drivers to raise disputes with automated evidence collection and rule-engine evaluation, plus secure shareable tracking links for ride monitoring.

## Modules Created

### 1. Dispute Module (`src/modules/dispute/`)

**Service** (`dispute.service.ts`):
- `createDispute` — validates booking ownership (rider or driver), prevents duplicate open disputes on same booking
- `collectEvidence` — gathers GPS location history, ride events, OTP verification status, timestamps, and ride completion data
- `evaluateDispute` — rule engine with auto-resolution logic:
  - No-show marked + OTP verified → `REFUND_RIDER` (risk 0.9)
  - Rider confirmed dropoff → `PAYOUT_DRIVER` (risk 0.1)
  - No GPS data → `MANUAL_REVIEW` (risk 0.5)
  - Default → `MANUAL_REVIEW` (risk 0.5)
- `resolveDispute` — admin resolution with outcomes: REFUND, PAYOUT, SPLIT, ESCALATE
- `getUserDisputes`, `getDisputeById`, `listDisputes` (paginated, sorted by riskScore)

**Routes** (`dispute.routes.ts`):
- `disputeRouter` (authenticated): `POST /`, `GET /me`, `GET /:id`
- `adminDisputeRouter` (authenticated): `GET /`, `GET /:id`, `POST /:id/collect-evidence`, `POST /:id/evaluate`, `POST /:id/resolve`

**Validator** (`dispute.validator.ts`):
- `createDisputeSchema` — requires bookingId + reason, optional description
- `resolveDisputeSchema` — requires resolution enum

### 2. Tracking Module (`src/modules/tracking/`)

**Service** (`tracking.service.ts`):
- `createTrackingLink` — generates UUID token, stores SHA-256 hash, configurable TTL (default 24h), validates booking ownership and trackable status
- `getTrackingData` — public endpoint, validates token hash lookup + expiry + revocation, returns booking status, pickup/dropoff, latest location
- `revokeTrackingLink` — soft-revoke (sets revokedAt), validates ownership
- `listTrackingLinks` — returns active (non-revoked) links for a booking

**Routes** (`tracking.routes.ts`):
- `trackingRouter` (authenticated): `POST /links`, `GET /bookings/:bookingId/links`, `DELETE /links/:id`
- `publicTrackingRouter` (no auth): `GET /:token`

## Schema Changes (Prisma)

```prisma
model Dispute {
  id             String    @id @default(uuid())
  rideId         String
  bookingId      String
  raisedBy       String
  reason         String
  description    String?
  status         String    @default("OPEN")
  evidenceJson   Json?
  recommendation String?
  riskScore      Float?
  resolution     String?
  resolvedBy     String?
  createdAt      DateTime  @default(now())
  resolvedAt     DateTime?
  ride           Ride        @relation(fields: [rideId], references: [id])
  booking        RideBooking @relation(fields: [bookingId], references: [id])
}

model TrackingLink {
  id          String    @id @default(uuid())
  bookingId   String
  token       String    @unique
  tokenHash   String    @unique
  expiresAt   DateTime
  accessScope String    @default("LOCATION_ONLY")
  createdBy   String
  createdAt   DateTime  @default(now())
  revokedAt   DateTime?
  booking     RideBooking @relation(fields: [bookingId], references: [id])
}
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/v1/disputes | Yes | Create dispute |
| GET | /api/v1/disputes/me | Yes | List user's disputes |
| GET | /api/v1/disputes/:id | Yes | Get dispute details |
| GET | /api/v1/admin/disputes | Yes | List all disputes (paginated) |
| GET | /api/v1/admin/disputes/:id | Yes | Admin get dispute with relations |
| POST | /api/v1/admin/disputes/:id/collect-evidence | Yes | Collect evidence for dispute |
| POST | /api/v1/admin/disputes/:id/evaluate | Yes | Run rule engine |
| POST | /api/v1/admin/disputes/:id/resolve | Yes | Admin resolve dispute |
| POST | /api/v1/tracking/links | Yes | Create tracking link |
| GET | /api/v1/tracking/bookings/:bookingId/links | Yes | List tracking links |
| DELETE | /api/v1/tracking/links/:id | Yes | Revoke tracking link |
| GET | /api/v1/tracking/:token | No | Public tracking data |

## Dispute Status Flow

```
OPEN → EVIDENCE_COLLECTED → UNDER_REVIEW → RESOLVED_*
                                         → AUTO_RESOLVED_*

Terminal statuses:
- RESOLVED_REFUND_RIDER
- RESOLVED_PAYOUT_DRIVER
- RESOLVED_SPLIT
- RESOLVED_ESCALATED
- AUTO_RESOLVED_RIDER_REFUND
- AUTO_RESOLVED_DRIVER_PAYOUT
```

## Security Considerations

- Tracking tokens are UUID v4, stored as SHA-256 hashes (token never stored in plaintext in DB)
- Links expire after configurable TTL (default 24h)
- Links can be revoked by the creator at any time
- Only the booking passenger can create tracking links
- Public tracking endpoint returns minimal data (no PII)
- Dispute creation restricted to ride participants only

## Tests

Integration test: `src/modules/integration/dispute-safety.integration.test.ts` — 15 tests covering:
- Dispute CRUD, duplicate prevention, authorization
- Evidence collection from location + events
- Rule engine auto-resolution
- Admin manual resolution
- Tracking link lifecycle (create, access, list, revoke)
- Expired/revoked link rejection
- Non-passenger creation rejection
