# Phase D — Cost Controls — Complete

> Reference: `PRODUCTION_READINESS.md` Phase D
> Date: 2026-05-25

---

## D1 — Google Maps API caching (COST-1)
**Status:** Already implemented before this phase.
Redis caching by `(originPlaceId, destinationPlaceId)` with 24h TTL existed in the codebase.

---

## D2 — Reduce search query: remove full booking list (COST-2)
**File:** `src/modules/search-ride/search-ride.service.ts`

**Problem:** `bookingWithRiderInclude` loaded full passenger details (name, phone, avatar) for every booking on every ride in search results — up to 500 passenger records per search page.

**Fix:**
- `bookingWithRiderInclude` changed from `include: { passenger: { select: ... } }` to a slim `select: { passengerId, seatsBooked, status, pickupWaypointId, dropoffWaypointId }`
- `RideBookingWithRider` type slimmed to remove passenger fields
- `mapRideBookings` updated — no longer returns `rider` (name/avatar); returns seat-count summary only
- Full passenger details are still available via the dedicated `driver-booking` module for drivers managing their bookings

---

## D3 — Notification table cleanup (COST-3)
**File:** `src/queue/maintenance.queue.ts` (new)

Nightly BullMQ job (repeatable, cron `0 2 * * *` = 02:00 UTC):
- Deletes **read notifications older than 30 days**
- Deletes **all notifications older than 90 days**

---

## D4 — FCM stale token cleanup (COST-4)
**Status:** Already implemented before this phase.
`src/services/push.service.ts` already handles `messaging/registration-token-not-registered` and `messaging/invalid-registration-token` responses by deleting the invalid token from DB.

---

## D5 — StripeWebhookEvent payload archival (COST-5)
**File:** `src/queue/maintenance.queue.ts` (new, same job as D3)

Same nightly maintenance job:
- Nullifies `StripeWebhookEvent.payload` for events processed more than 30 days ago
- Preserves `stripeEventId` + `eventType` for idempotency checks
- `payload` column is already nullable (`Json?`) — no schema migration needed
