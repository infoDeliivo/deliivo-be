# Phase B — Security & Config — Complete

> Reference: `PRODUCTION_READINESS.md` Phase B
> Date: 2026-05-24

---

## B1 — CORS completely open
**Files:** `src/app.ts`, `src/socket/index.ts`, `.env.example`
- Both Express and Socket.IO now read `ALLOWED_ORIGINS` (comma-separated) from env
- `origin: false` if the env var is not set (blocks all cross-origin requests)
- `.env.example` documents the new `ALLOWED_ORIGINS` variable
- Set e.g. `ALLOWED_ORIGINS=https://app.example.com,https://www.example.com` in production

---

## B2 — No request body size limit
**Status: Already done in Phase A**
- `express.json({ limit: '50kb' })` and `express.urlencoded({ limit: '50kb' })` applied in `src/app.ts`

---

## B3 — Driver DL verification not enforced before publishing rides
**Files:** `src/modules/publish-ride/draft-ride.service.ts`, `src/modules/publish-ride/publish-ride.controller.ts`, `src/modules/driver-booking/driver-booking.service.ts`, `driver-booking.controller.ts`
- `publishRide()` now checks `user.dlVerified === true` before allowing publish
- `acceptBooking()` also checks `booking.ride.driver.dlVerified` (defense-in-depth, gap fixed 2026-05-25)
- Both throw `DRIVER_NOT_VERIFIED` → HTTP 403

---

## B4 — femaleOnly booking not enforced
**Files:** `prisma/schema.prisma`, `src/modules/ride-booking/ride-booking.service.ts`, `src/modules/ride-booking/ride-booking.controller.ts`, migration SQL
- Added `femaleOnly Boolean @default(false)` to the `Ride` model
- `createBooking()` checks `ride.femaleOnly` — if true, passenger salutation must be `MS`, `MRS`, or `MX`
- Throws `FEMALE_ONLY_RIDE` → HTTP 403 `"This ride is for female passengers only"`
- Migration: `prisma/migrations/20260524000002_phase_b_fixes/migration.sql`

> **Note:** `femaleOnly` is a new field — existing rides default to `false`. The publish-ride wizard will need a UI step to let drivers toggle this before publishing.

---

## B5 — @ts-ignore on active Prisma queries
**Files:** `src/modules/publish-ride/publish-ride.service.ts`, `src/modules/ride-booking/ride-booking.service.ts`
- All 4 `@ts-ignore` comments removed
- The `vehicle` relation (`Vehicle? @relation(...)`) is correctly defined in `schema.prisma:222-223`

> **Action required:** `npx prisma generate` — until this is run the TypeScript compiler may flag `vehicle` on Ride queries. Run it after all schema migrations are applied.

---

## B6 — No Terms of Service acceptance tracking
**Schema:** `prisma/schema.prisma`, `prisma/migrations/20260524000002_phase_b_fixes/migration.sql`
- Added to `User` model: `tosAcceptedAt`, `tosVersion`, `privacyAcceptedAt`, `privacyVersion`

**Endpoint:** `src/modules/auth/auth.validator.ts`, `auth.controller.ts`, `auth.routes.ts`
- `POST /api/v1/auth/accept-tos` (requires auth) — body: `{ tosVersion, privacyVersion }`
- Stamps `tosAcceptedAt`, `privacyAcceptedAt` with current timestamp on the user record

**Enforcement:** `src/modules/publish-ride/draft-ride.service.ts`, `src/modules/publish-ride/publish-ride.controller.ts`, `src/modules/ride-booking/ride-booking.service.ts`, `src/modules/ride-booking/ride-booking.controller.ts`
- `publishRide()` — checks `tosAcceptedAt != null` before proceeding
- `createBooking()` — checks `tosAcceptedAt != null` before entering transaction
- Both throw `TOS_NOT_ACCEPTED` → HTTP 403 `"You must accept the Terms of Service before..."`

---

## Migration Required

```bash
npx prisma migrate deploy   # applies phase_b_fixes SQL (femaleOnly + ToS fields)
npx prisma generate         # regenerates client types
```
