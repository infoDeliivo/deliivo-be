# Phase C — Monetisation & Admin — Complete

> Reference: `PRODUCTION_READINESS.md` Phase C
> Date: 2026-05-24

---

## C1 — Stripe Connect for driver payouts
**Files:** `src/modules/payments/stripe.service.ts`, `stripe.types.ts`, `stripe.connect.controller.ts` (new), `stripe.connect.routes.ts` (new), `src/app.ts`, `src/modules/index.ts`, `prisma/schema.prisma`

- Added `stripeAccountId String?` and `stripeOnboardingComplete Boolean @default(false)` to `User` model
- New Stripe Connect functions in `stripe.service.ts`:
  - `createConnectOnboardingLink(userId, stripeAccountId, returnUrl, refreshUrl)` — creates Express account if needed, returns onboarding URL
  - `getConnectAccountStatus(stripeAccountId)` — retrieves account charges/payouts/details status from Stripe
- `createBookingPaymentIntent` updated: when driver has `stripeOnboardingComplete = true`, adds `transfer_data.destination` + `application_fee_amount` to the payment intent
- New endpoints (protected, require auth):
  - `POST /api/v1/payments/connect/onboard` — returns Stripe onboarding URL; saves `stripeAccountId` on first call
  - `GET /api/v1/payments/connect/status` — returns Connect account status; auto-marks `stripeOnboardingComplete` when Stripe confirms

---

## C2 — Platform service fee via `application_fee_amount`
**Files:** `src/modules/ride-booking/ride-booking.service.ts`, `.env.example`

- `calculateBookingPrice()` now reads `PLATFORM_FEE_PERCENT` env var (default `0`) and computes `serviceFee = subtotal × (platformFeePct / 100)`
- `totalPrice` includes the service fee, which is shown in `priceBreakdown.serviceFee`
- Service fee flows into `amountMajor` passed to `createBookingPaymentIntent`, which then sets `application_fee_amount` when driver is on Connect
- `.env.example`: added `PLATFORM_FEE_PERCENT=0` and `APP_BASE_URL=https://app.example.com`

---

## C3 — Admin API
**Files:** `src/modules/admin/admin.service.ts` (new), `admin.controller.ts` (new), `admin.routes.ts` (new), `src/modules/index.ts`, `src/app.ts`, `prisma/schema.prisma`, `src/modules/auth/auth.service.ts`

- Added `UserRole` Prisma enum (`USER | ADMIN`) and `role UserRole @default(USER)` + `isBanned Boolean @default(false)` to `User` model
- `auth.service.ts`: `verifyOtpService` and `refreshTokenService` now encode the user's actual DB `role` into the JWT (instead of hardcoded `Role.USER`)
- Admin module registered at `POST /api/v1/admin` protected by `protect + authorize('ADMIN')`
- Endpoints:
  | Method | Path | Action |
  |--------|------|--------|
  | GET | `/api/v1/admin/users` | List users (supports `?search=`, `?isBanned=`, `?role=USER\|ADMIN`, `?dlVerified=true\|false`, pagination) |
  | POST | `/api/v1/admin/users/:id/ban` | Ban a user |
  | POST | `/api/v1/admin/users/:id/unban` | Unban a user |
  | GET | `/api/v1/admin/stats` | Platform stats (users, rides, bookings, revenue) |
  | POST | `/api/v1/admin/vehicles/:id/verify` | Mark vehicle as verified |
  | POST | `/api/v1/admin/bookings/:id/refund` | Full refund + cancel booking (admin-initiated) |

---

## C4 — User reporting and blocking
**Files:** `src/modules/user/user-safety.service.ts` (new), `user.controller.ts`, `user.routes.ts`, `prisma/schema.prisma`, `src/modules/ride-booking/ride-booking.service.ts`, `ride-booking.controller.ts`

- Added `UserReport` and `UserBlock` models to schema
- New safety service: `reportUser`, `blockUser`, `unblockUser`, `listBlockedUsers`
- New endpoints (protected, auth required):
  | Method | Path | Action |
  |--------|------|--------|
  | POST | `/api/v1/users/:userId/report` | Report a user (`{ reason, details? }`) |
  | POST | `/api/v1/users/:userId/block` | Block a user |
  | DELETE | `/api/v1/users/:userId/block` | Unblock a user |
  | GET | `/api/v1/users/me/blocked` | List users blocked by me |
- `createBooking()` now checks:
  1. `passenger.isBanned` → throws `USER_BANNED` (HTTP 403 "Your account has been suspended")
  2. `UserBlock` between passenger and driver (either direction) → throws `USER_BLOCKED` (HTTP 403 "You cannot book this ride")

---

## Migration Required

```bash
npx prisma migrate deploy   # applies phase_c_features SQL
npx prisma generate         # regenerates client with UserRole, UserReport, UserBlock, new User fields
```
