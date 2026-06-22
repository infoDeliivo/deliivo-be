# Requirements Implementation Plan

This document maps all 4 requirement PDFs to concrete implementation tasks against the current codebase. Each feature is assessed for what already exists, what's missing, and the implementation plan.

---

## Current App State (baseline)

**Already implemented:**
- Ride publishing with drafts (Redis) and stopovers
- Segment-based booking with per-segment capacity tracking
- Stripe payment intents (capture at booking time)
- Driver decision flow (accept/reject within deadline)
- Pickup OTP verification (basic: verify code → IN_PROGRESS)
- BullMQ deadline queue for auto-cancellation
- Notifications (push)
- Ratings and reviews
- User blocks and reports
- Admin role (basic)
- GDPR data deletion
- Stripe Connect onboarding (basic)
- Platform fee calculation

**Not implemented (from requirements):**
- Ride operational flow (start, live tracking, drop-off, completion)
- Dispute system
- Payment ledger and reconciliation
- Payout lifecycle (escrow → eligible → transfer)
- Distance-based pricing (V1 pricing model)
- Booking request expiry with rider-selected deadline
- Family live tracking
- Offline action sync
- Geofence validation

---

## Feature 1: Ride Operation Lifecycle

**Source:** `Carpool_Ride_Start_Complete_Design_Document.pdf`

### 1.1 Ride State Machine

| Priority | Task | Effort |
|----------|------|--------|
| P0 | Add ride states: `SCHEDULED`, `READY_TO_START`, `IN_PROGRESS`, `COMPLETION_PENDING`, `COMPLETED`, `CANCELLED`, `DISPUTED` | 0.5d |
| P0 | Add state transition validation (strict machine, no skipping) | 1d |
| P0 | `POST /rides/:rideId/start` — mark ride IN_PROGRESS, begin tracking | 1d |
| P0 | `POST /rides/:rideId/finish` — validate all bookings terminal, mark COMPLETED | 0.5d |

**Schema changes:**
```prisma
// Update Ride.status enum
enum RideStatus {
  DRAFT
  PUBLISHED
  SCHEDULED
  READY_TO_START
  IN_PROGRESS
  COMPLETION_PENDING
  COMPLETED
  CANCELLED
  DISPUTED
}
```

**Current gap:** Ride currently goes PUBLISHED → (nothing operational). Need the entire post-booking state machine.

---

### 1.2 Booking Operational States

| Priority | Task | Effort |
|----------|------|--------|
| P0 | Extend `BookingStatus` enum with operational states | 0.5d |
| P0 | `POST /bookings/:id/driver-arrived` — mark DRIVER_ARRIVED, start wait timer | 1d |
| P0 | `POST /bookings/:id/verify-pickup-otp` — (exists, extend with geofence) | 0.5d |
| P0 | `POST /bookings/:id/mark-no-show` — validate wait time, mark NO_SHOW | 1d |
| P0 | `POST /bookings/:id/confirm-dropoff` — driver marks drop-off | 1d |
| P0 | `POST /bookings/:id/rider-confirm-dropoff` — rider confirms | 0.5d |
| P1 | `POST /bookings/:id/report-missed-pickup` — rider reports missed | 1d |

**Schema changes:**
```prisma
enum BookingStatus {
  // Existing
  PAYMENT_PENDING
  DRIVER_PENDING
  CONFIRMED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  PAYMENT_FAILED
  // New operational states
  WAITING_FOR_PICKUP
  DRIVER_ARRIVED
  OTP_PENDING
  ONBOARD
  DROP_PENDING
  DRIVER_DROPPED
  NO_SHOW
  DRIVER_MISSED_PICKUP
  DISPUTED
}
```

**New fields on `RideBooking`:**
```prisma
driverArrivedAt     DateTime?
pickupVerifiedAt    DateTime?
dropoffVerifiedAt   DateTime?
noShowMarkedAt      DateTime?
waitTimerStartedAt  DateTime?
```

---

### 1.3 Live Location Tracking

| Priority | Task | Effort |
|----------|------|--------|
| P0 | New model `LocationUpdate` (separate table, high write volume) | 0.5d |
| P0 | `POST /rides/:rideId/locations` — driver sends GPS every 5-10s | 1d |
| P0 | `GET /rides/:rideId/latest-location` — rider gets latest driver position | 0.5d |
| P0 | Socket.IO room for ride live tracking (real-time push) | 1d |
| P1 | Store location history for dispute evidence | 0.5d |
| P2 | Redis latest-location cache (avoid DB reads per poll) | 0.5d |

**Schema:**
```prisma
model LocationUpdate {
  id        String   @id @default(uuid())
  rideId    String
  driverId  String
  lat       Float
  lng       Float
  speed     Float?
  heading   Float?
  accuracy  Float?
  timestamp DateTime
  createdAt DateTime @default(now())

  ride Ride @relation(fields: [rideId], references: [id])
  @@index([rideId, timestamp])
}
```

**Architecture decision:** Store latest location in Redis (`ride:location:{rideId}`) for real-time reads. Batch-insert history to PostgreSQL every 30s for dispute evidence.

---

### 1.4 Family Live Tracking

| Priority | Task | Effort |
|----------|------|--------|
| P1 | New model `TrackingLink` | 0.5d |
| P1 | `POST /bookings/:id/tracking-link` — generate secure token | 0.5d |
| P1 | `GET /tracking/:token` — public endpoint, no auth, shows limited data | 1d |
| P1 | Token expiry and revocation | 0.5d |

**Schema:**
```prisma
model TrackingLink {
  id          String    @id @default(uuid())
  bookingId   String
  tokenHash   String    @unique
  expiresAt   DateTime
  accessScope String    @default("LOCATION_ONLY")
  createdBy   String
  createdAt   DateTime  @default(now())
  revokedAt   DateTime?

  booking RideBooking @relation(fields: [bookingId], references: [id])
}
```

---

### 1.5 Geofence Validation

| Priority | Task | Effort |
|----------|------|--------|
| P1 | `src/modules/geofence/geofence.service.ts` — haversine radius check | 0.5d |
| P1 | Validate driver-arrived within pickup radius (default 200m) | 0.5d |
| P1 | Validate drop-off within destination radius | 0.5d |
| P1 | Flag suspicious OTP verifications outside geofence | 0.5d |

---

### 1.6 Offline Action Sync

| Priority | Task | Effort |
|----------|------|--------|
| P1 | New model `RideEvent` (audit log with `actionId` for idempotency) | 0.5d |
| P1 | `POST /offline-actions/sync` — batch process queued actions | 1.5d |
| P1 | Idempotent processing (reject duplicate `actionId`) | 0.5d |

**Schema:**
```prisma
model RideEvent {
  id               String   @id @default(uuid())
  rideId           String
  bookingId        String?
  actionId         String   @unique  // Client-generated UUID for idempotency
  eventType        String
  actorType        String   // DRIVER, RIDER, SYSTEM
  actorId          String
  lat              Float?
  lng              Float?
  clientTimestamp   DateTime
  serverTimestamp   DateTime @default(now())
  validationStatus String   @default("VALID")
  metadataJson     Json?

  ride Ride @relation(fields: [rideId], references: [id])
  @@index([rideId, serverTimestamp])
}
```

---

### 1.7 Dispute System

| Priority | Task | Effort |
|----------|------|--------|
| P1 | New model `Dispute` | 0.5d |
| P1 | `POST /disputes` — create dispute, freeze booking payment | 1d |
| P1 | Evidence collector (GPS history, OTP status, timestamps) | 1.5d |
| P1 | Rule engine for auto-resolution (clear cases) | 2d |
| P1 | `GET /admin/disputes` — admin queue sorted by priority | 1d |
| P1 | `POST /admin/disputes/:id/decision` — resolve (refund/payout/split/escalate) | 1d |

**Schema:**
```prisma
model Dispute {
  id             String    @id @default(uuid())
  rideId         String
  bookingId      String
  raisedBy       String
  reason         String
  status         String    @default("OPEN")
  evidenceJson   Json?
  recommendation String?
  riskScore      Float?
  resolution     String?
  createdAt      DateTime  @default(now())
  resolvedAt     DateTime?

  ride    Ride        @relation(fields: [rideId], references: [id])
  booking RideBooking @relation(fields: [bookingId], references: [id])
  @@index([status, createdAt])
}
```

**Dispute states:** `OPEN`, `EVIDENCE_COLLECTED`, `AUTO_RESOLVED_RIDER_REFUND`, `AUTO_RESOLVED_DRIVER_PAYOUT`, `NEEDS_MANUAL_REVIEW`, `WAITING_FOR_USER_RESPONSE`, `RESOLVED_REFUND`, `RESOLVED_PAYOUT`, `RESOLVED_SPLIT`, `ESCALATED`

---

## Feature 2: Payment System (Ledger, Payouts, Reconciliation)

**Source:** `Carpool_Payment_Feature_Complete_Design.pdf` + `Carpool_Payment_System_Design.pdf`

### 2.1 Payment Ledger

| Priority | Task | Effort |
|----------|------|--------|
| P0 | New model `LedgerEntry` (append-only double-entry) | 0.5d |
| P0 | Write ledger entries on: payment received, refund, transfer, fee | 1d |
| P0 | Derive balances from ledger (no mutable balance fields) | 1d |
| P1 | Driver earnings screen API (`GET /drivers/me/earnings`) | 1d |

**Schema:**
```prisma
model LedgerEntry {
  id            String   @id @default(uuid())
  entryGroupId  String   // Links related debit/credit entries
  paymentId     String?
  bookingId     String?
  userId        String?
  accountType   String   // RIDER, DRIVER, PLATFORM, PROVIDER
  entryType     String   // RIDER_PAYMENT_RECEIVED, DRIVER_EARNING_LIABILITY, PLATFORM_FEE_REVENUE, etc.
  direction     String   // DEBIT, CREDIT
  amount        Float
  currency      String
  metadataJson  Json?
  createdAt     DateTime @default(now())

  @@index([bookingId])
  @@index([userId, createdAt])
}
```

---

### 2.2 Payment State Machine

| Priority | Task | Effort |
|----------|------|--------|
| P0 | New model `Payment` (replaces scattered fields on RideBooking) | 1d |
| P0 | Payment states: `CREATED → PAYMENT_PENDING → PAID → HELD_IN_ESCROW → PAYOUT_ELIGIBLE → TRANSFER_CREATED → PAYOUT_COMPLETED / REFUNDED` | 1d |
| P0 | Strict state transitions with validation | 0.5d |

**Schema:**
```prisma
model Payment {
  id                     String    @id @default(uuid())
  bookingId              String    @unique
  rideId                 String
  riderId                String
  stripePaymentIntentId  String?
  amountTotal            Float
  currency               String
  fareAmount             Float
  platformFeeAmount      Float
  status                 String    @default("CREATED")
  failureReason          String?
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt

  booking RideBooking @relation(fields: [bookingId], references: [id])
  @@index([status])
}
```

---

### 2.3 Payout Lifecycle

| Priority | Task | Effort |
|----------|------|--------|
| P1 | New models: `PayoutBatch`, `PayoutItem` | 0.5d |
| P1 | Payout eligibility calculation (completion + dispute window) | 1d |
| P1 | `POST /admin/payouts/process` — trigger batch payout | 1d |
| P1 | Stripe Transfer to connected account | 1d |
| P1 | Handle transfer failures and retries | 1d |
| P1 | Driver payout history API (`GET /drivers/me/payouts`) | 0.5d |

**Schema:**
```prisma
model PayoutBatch {
  id               String    @id @default(uuid())
  driverId         String
  status           String    @default("PENDING")
  currency         String
  amountTotal      Float
  stripeTransferId String?
  stripePayoutId   String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  items PayoutItem[]
}

model PayoutItem {
  id             String   @id @default(uuid())
  payoutBatchId  String
  bookingId      String
  paymentId      String
  driverAmount   Float
  platformFee    Float
  status         String   @default("PENDING")
  createdAt      DateTime @default(now())

  batch PayoutBatch @relation(fields: [payoutBatchId], references: [id])
}
```

---

### 2.4 Event Outbox

| Priority | Task | Effort |
|----------|------|--------|
| P1 | New model `PaymentEventOutbox` | 0.5d |
| P1 | Write outbox row in same transaction as state change | 0.5d |
| P1 | Outbox processor worker (poll + process + mark done) | 1.5d |
| P1 | Idempotent event processing | 0.5d |

**Schema:**
```prisma
model PaymentEventOutbox {
  id            String    @id @default(uuid())
  eventType     String
  aggregateType String
  aggregateId   String
  payloadJson   Json
  status        String    @default("PENDING")
  retryCount    Int       @default(0)
  nextRetryAt   DateTime?
  createdAt     DateTime  @default(now())
  processedAt   DateTime?

  @@index([status, nextRetryAt])
}
```

---

### 2.5 Webhook Deduplication

| Priority | Task | Effort |
|----------|------|--------|
| P0 | New model `StripeWebhookEvent` | 0.5d |
| P0 | Store raw event with `stripeEventId` unique constraint | 0.5d |
| P0 | Skip processing if event already exists | 0.5d |

**Current state:** Basic webhook exists but no deduplication model. Currently checks in-memory.

---

### 2.6 Reconciliation Service

| Priority | Task | Effort |
|----------|------|--------|
| P2 | New model `ReconciliationIssue` | 0.5d |
| P2 | Hourly job: compare recent Stripe state vs internal state | 2d |
| P2 | Daily settlement reconciliation | 1d |
| P2 | Auto-repair safe mismatches (missed webhook) | 1d |
| P2 | Admin reconciliation issues screen | 1d |

---

### 2.7 Rider Payment Methods

| Priority | Task | Effort |
|----------|------|--------|
| P1 | New model `PaymentMethod` | 0.5d |
| P1 | `GET /payment-methods` — list saved cards | 0.5d |
| P1 | `POST /payment-methods/setup-intent` — save new card | 0.5d |
| P1 | `POST /payment-methods/:id/default` — set default | 0.5d |

**Schema:**
```prisma
model PaymentMethod {
  id                      String    @id @default(uuid())
  userId                  String
  stripeCustomerId        String
  stripePaymentMethodId   String
  brand                   String?
  last4                   String?
  expMonth                Int?
  expYear                 Int?
  isDefault               Boolean   @default(false)
  status                  String    @default("ACTIVE")
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id])
  @@index([userId])
}
```

---

## Feature 3: Distance-Based Pricing (V1)

**Source:** `Baltic_Carpooling_V1_Pricing_Design_Developer.pdf`

### 3.1 Pricing Configuration

| Priority | Task | Effort |
|----------|------|--------|
| P1 | New model `PricingConfig` (region-based, admin-editable) | 0.5d |
| P1 | Seed BALTIC config: EUR 0.06/0.08/0.12 per km, min EUR 3 | 0.5d |
| P1 | `DistanceRatePricingCalculator` class | 1d |
| P1 | `POST /api/v1/rides/price-preview` endpoint | 0.5d |
| P1 | `POST /api/v1/pricing/validate` endpoint | 0.5d |

**Schema:**
```prisma
model PricingConfig {
  id                   String    @id @default(uuid())
  regionCode           String
  currency             String    @default("EUR")
  minRatePerKm         Float
  recommendedRatePerKm Float
  maxRatePerKm         Float
  minimumSeatPrice     Float     @default(3.00)
  roundingStrategy     String    @default("NEAREST_EURO")
  active               Boolean   @default(true)
  validFrom            DateTime  @default(now())
  validTo              DateTime?
  createdBy            String?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@unique([regionCode, active])
}
```

**Current gap:** App currently uses driver-set `basePricePerSeat` with no validation bounds. Need to add min/max enforcement based on route distance.

---

### 3.2 Pricing Snapshot on Publish

| Priority | Task | Effort |
|----------|------|--------|
| P1 | New model `RidePricingSnapshot` | 0.5d |
| P1 | On ride publish: calculate pricing, validate driver's price, store snapshot | 1d |
| P1 | Reject publish if price outside min/max range | 0.5d |

**Schema:**
```prisma
model RidePricingSnapshot {
  id                       String   @id @default(uuid())
  rideId                   String   @unique
  pricingVersion           String   @default("DISTANCE_RATE_V1")
  regionCode               String
  currency                 String
  distanceKm               Float
  minRatePerKm             Float
  recommendedRatePerKm     Float
  maxRatePerKm             Float
  minimumSeatPrice         Float
  recommendedPricePerSeat  Float
  minAllowedPricePerSeat   Float
  maxAllowedPricePerSeat   Float
  selectedPricePerSeat     Float
  roundingStrategy         String
  createdAt                DateTime @default(now())

  ride Ride @relation(fields: [rideId], references: [id])
}
```

---

### 3.3 Segment Pricing with Distance Rate

| Priority | Task | Effort |
|----------|------|--------|
| P1 | Calculate segment prices using `selectedRideRatePerKm * segmentDistanceKm` | 1d |
| P1 | Ensure segment price >= `minimumSeatPrice` | 0.5d |

**Formula:**
```
selectedRideRatePerKm = selectedPricePerSeat / fullRideDistanceKm
segmentPrice = max(minimumSeatPrice, round(segmentDistanceKm * selectedRideRatePerKm))
```

**Integration with existing segment system:** Currently uses cumulative `pricePerSeat` on waypoints. The distance-rate model would auto-calculate these based on relative distances rather than requiring manual driver input.

---

## Feature 4: Booking Request Expiry (Rider-Selected Deadline)

**Source:** `deliivo_booking_request_expiry_design.pdf`

### 4.1 Rider-Selected Response Deadline

| Priority | Task | Effort |
|----------|------|--------|
| P1 | Add `responseExpiryOption` field to booking creation | 0.5d |
| P1 | Calculate `expires_at` based on option (1h/3h/6h/12h/24h/before-departure) | 0.5d |
| P1 | Cap `expires_at` to departure time | 0.5d |
| P1 | Default selection based on time-to-departure | 0.5d |

**Current state:** App has a fixed `DRIVER_DECISION_WINDOW_MS` constant. Need to make it rider-selectable.

**Changes to `RideBooking`:**
```prisma
// Add to existing RideBooking model
responseExpiryOption        String?    // ONE_HOUR, THREE_HOURS, SIX_HOURS, etc.
responseExpiryHours         Int?
```

---

### 4.2 Seat Hold Model

| Priority | Task | Effort |
|----------|------|--------|
| P1 | New model `TripSeatHold` (or reuse existing segment capacity) | 0.5d |
| P1 | Create ACTIVE hold on booking request | 0.5d |
| P1 | Release hold on decline/withdraw/expiry | 0.5d |
| P1 | Convert hold to confirmed booking on approval | 0.5d |

**Current state:** Segment capacity edges already track occupied seats. The hold can be implemented as early occupation of edges, which is what currently happens (seats reserved at booking creation). This is already correct — the expiry worker just needs to release them.

---

### 4.3 Payment Authorization (Manual Capture)

| Priority | Task | Effort |
|----------|------|--------|
| P1 | Switch to `capture_method: 'manual'` for request-to-book flow | 1d |
| P1 | Capture only on driver approval | 0.5d |
| P1 | Release authorization on decline/withdraw/expiry | 0.5d |
| P1 | Handle capture failure gracefully | 0.5d |

**Current state:** Payment is captured at booking time (rider pays immediately). Need to support authorization-first model where capture happens only on driver approval.

---

### 4.4 Expiry Worker Enhancement

| Priority | Task | Effort |
|----------|------|--------|
| P1 | Update deadline queue to support rider-selected deadlines | 0.5d |
| P1 | Release payment authorization on expiry | 0.5d |
| P1 | Update driver response metrics on expiry | 0.5d |
| P1 | Notification: "Your request expired" to rider | 0.5d |
| P1 | Notification: reminder 1h before expiry to driver | 0.5d |

---

### 4.5 New/Updated APIs

| Priority | Task | Effort |
|----------|------|--------|
| P1 | Update `POST /bookings` to accept `responseExpiryOption` | 0.5d |
| P1 | `POST /bookings/:id/withdraw` — rider withdraws request | 0.5d |
| P1 | `GET /riders/me/booking-requests?status=PENDING` — pending requests with countdown | 0.5d |
| P1 | `GET /drivers/me/booking-requests?status=PENDING` — driver's pending queue | 0.5d |

---

## Implementation Phases

### Phase 1: Ride Operations MVP (P0) — ~2 weeks

| Task | Days |
|------|------|
| Ride state machine (start/finish) | 2 |
| Booking operational states (arrived/OTP/drop-off/no-show) | 4 |
| Live location tracking (POST + GET + Socket.IO) | 3 |
| Webhook deduplication model | 1 |
| Integration tests | 2 |
| **Total** | **12 days** |

### Phase 2: Payments & Pricing — ~2.5 weeks

| Task | Days |
|------|------|
| Payment model + state machine | 2 |
| Ledger (append-only entries) | 2 |
| Distance-based pricing calculator + config | 2 |
| Pricing validation in ride publish | 1 |
| Price preview API | 1 |
| Payout eligibility + batch transfer | 3 |
| Payment methods (save/list cards) | 1 |
| Event outbox + processor | 2 |
| **Total** | **14 days** |

### Phase 3: Request Expiry & Driver Decision — ~1 week

| Task | Days |
|------|------|
| Rider-selected deadline on booking | 1 |
| Manual capture mode (authorize → capture) | 2 |
| Expiry worker updates + notifications | 1 |
| Withdraw endpoint | 0.5 |
| Driver response metrics | 0.5 |
| **Total** | **5 days** |

### Phase 4: Dispute & Safety — ~2 weeks

| Task | Days |
|------|------|
| Dispute model + creation API | 2 |
| Evidence collector service | 2 |
| Rule engine (auto-resolution for clear cases) | 3 |
| Admin dispute queue + resolution | 2 |
| Family tracking links | 1 |
| Geofence validation service | 1 |
| **Total** | **11 days** |

### Phase 5: Reconciliation & Polish — ~1 week

| Task | Days |
|------|------|
| Reconciliation service (hourly + daily) | 3 |
| Admin reconciliation issues UI data | 1 |
| Offline action sync endpoint | 1.5 |
| **Total** | **5.5 days** |

---

## Priority Summary

| Priority | Features | Total Effort |
|----------|----------|-------------|
| **P0** | Ride operations, location tracking, booking states, webhook dedup | ~12 days |
| **P1** | Payments/ledger, pricing, request expiry, disputes, family tracking | ~30 days |
| **P2** | Reconciliation, advanced auto-resolution, driver metrics | ~5.5 days |
| **Total** | | **~47.5 days** |

---

## New Modules to Create

```
src/modules/
├── ride-operations/          # Ride start/finish, state machine
│   ├── ride-operations.service.ts
│   ├── ride-operations.controller.ts
│   └── ride-operations.types.ts
├── location/                 # Live tracking
│   ├── location.service.ts
│   ├── location.controller.ts
│   └── family-tracking.service.ts
├── geofence/                 # Radius validation
│   └── geofence.service.ts
├── dispute/                  # Dispute lifecycle
│   ├── dispute.service.ts
│   ├── dispute.controller.ts
│   ├── evidence-collector.ts
│   └── rule-engine.ts
├── ledger/                   # Append-only accounting
│   └── ledger.service.ts
├── payout/                   # Driver payouts
│   ├── payout.service.ts
│   └── payout.controller.ts
├── pricing/                  # Distance-based pricing
│   ├── pricing.service.ts
│   ├── pricing.calculator.ts
│   └── pricing.controller.ts
├── reconciliation/           # Stripe ↔ internal sync
│   └── reconciliation.service.ts
└── offline-sync/             # Idempotent action processing
    └── offline-sync.service.ts
```

---

## New Prisma Models Summary

| Model | Purpose | Phase |
|-------|---------|-------|
| `LocationUpdate` | Driver GPS history | 1 |
| `RideEvent` | Audit log with idempotency key | 1 |
| `TrackingLink` | Family secure tracking | 4 |
| `Dispute` | Conflict review | 4 |
| `Payment` | Dedicated payment record | 2 |
| `LedgerEntry` | Append-only accounting | 2 |
| `PayoutBatch` | Driver payout grouping | 2 |
| `PayoutItem` | Per-booking payout line | 2 |
| `PaymentEventOutbox` | Reliable async events | 2 |
| `StripeWebhookEvent` | Webhook deduplication | 1 |
| `ReconciliationIssue` | Mismatch tracking | 5 |
| `PaymentMethod` | Saved cards | 2 |
| `PricingConfig` | Region pricing rules | 2 |
| `RidePricingSnapshot` | Frozen pricing at publish | 2 |
| `TripSeatHold` | Explicit seat reservation (optional, may reuse existing) | 3 |

---

## Dependencies Between Features

```
Ride Operations (Phase 1)
    │
    ├── Required by: Disputes (needs ride events + location history)
    ├── Required by: Payout eligibility (needs COMPLETED state)
    └── Required by: Family tracking (needs IN_PROGRESS ride)

Payments/Ledger (Phase 2)
    │
    ├── Required by: Payout (needs ledger entries)
    ├── Required by: Disputes (needs payment freeze)
    └── Required by: Reconciliation (needs payment state)

Request Expiry (Phase 3)
    │
    └── Independent (extends existing booking flow)

Disputes (Phase 4)
    │
    ├── Depends on: Ride Operations (evidence from events/location)
    └── Depends on: Payments (freeze/release)

Reconciliation (Phase 5)
    │
    └── Depends on: Payments/Ledger (compares states)
```

---

## Migration Strategy

Each phase should produce its own migration:

```bash
# Phase 1
npx prisma migrate dev --name ride-operations-and-tracking

# Phase 2
npx prisma migrate dev --name payment-ledger-pricing

# Phase 3
npx prisma migrate dev --name booking-request-expiry

# Phase 4
npx prisma migrate dev --name disputes-and-safety

# Phase 5
npx prisma migrate dev --name reconciliation
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Payment state machine complexity | High | Start with bypass mode, add Stripe flows incrementally |
| Location data volume | Medium | Redis for latest, batch-insert to PG, TTL on history |
| Dispute auto-resolution false positives | High | Conservative rules in V1, manual review as default |
| Offline sync conflicts | Medium | Strict idempotency keys + last-write-wins for non-critical |
| Breaking existing booking flow | High | Feature flags for new states, backward compat for existing rides |
