# Phase E — Legal & Safety — Complete

> Reference: `PRODUCTION_READINESS.md` Phase E
> Date: 2026-05-25

---

## E1 — T&C acceptance gate in onboarding flow
**Status:** Already implemented in Phase B.

- Schema fields: `tosAcceptedAt`, `tosVersion`, `privacyAcceptedAt`, `privacyVersion` on `User`
- Acceptance endpoint: `POST /api/v1/auth/accept-tos` (protected, validates `{ tosVersion, privacyVersion }`)
- Enforcement:
  - `publishRide()` and `publishDraftRide()` throw `TOS_NOT_ACCEPTED` → HTTP 403
  - `createBooking()` throws `TOS_NOT_ACCEPTED` → HTTP 403

---

## E2 — Privacy policy link from onboarding
**Status:** Frontend scope. Backend already tracks `privacyAcceptedAt` and `privacyVersion` on the User model. The `POST /auth/accept-tos` endpoint accepts both `tosVersion` and `privacyVersion` together.

---

## E3 — GDPR: user data export and account deletion
**Files:** `src/modules/user/user-gdpr.service.ts` (new), `user.controller.ts`, `user.routes.ts`

### Data Export
`GET /api/v1/users/me/data-export`

Returns a structured JSON export of all personal data held for the authenticated user:
- Profile (name, email, phone, dob, salutation, ToS dates, etc.)
- Travel preferences
- Vehicles
- Rides as driver (last 200)
- Bookings as passenger (last 200)
- Ratings given and received (last 200 each)
- Reports made (last 100)
- Users blocked by this user (last 100)

### Account Deletion
`DELETE /api/v1/users/me`

Body: `{ "confirm": true }` (required — prevents accidental deletion)

Steps performed:
1. **Cancel active rides** as driver — all `PUBLISHED`/`IN_PROGRESS` rides are set to `CANCELLED`; all their active bookings are cancelled and refunded (Stripe refund issued inside transaction)
2. **Cancel active bookings** as passenger — all `PAYMENT_PENDING`/`DRIVER_PENDING`/`CONFIRMED`/`IN_PROGRESS` bookings are cancelled and refunded
3. **Revoke all refresh tokens** — user is immediately logged out everywhere
4. **Anonymise PII** — name, email, phone, dob, salutation, avatarUrl, stripeAccountId, and ToS dates are all set to `null`. The user row is kept for referential integrity (booking history, ratings) but PII is zeroed. `isBanned = true` prevents future logins.
