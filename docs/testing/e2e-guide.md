# E2E Test Suite — Running Guide

Automated end-to-end tests that run against a **live running server**.
They cover authentication, ride publishing, search, booking, payments, chat, admin, and more.

---

## Quick Start

```bash
# 1. Set up test database
createdb carpooling_test
DATABASE_URL="postgresql://user:password@localhost:5432/carpooling_test?schema=public" npx prisma migrate deploy
npx prisma generate

# 2. Configure environment
cp .env.test.example .env.test
# Edit .env.test with your real values (see "Environment Variables" below)

# 3. Start the server (in a separate terminal)
npm run dev:server

# 4. Run the full suite
npm run test:e2e
```

---

## Running Tests

### Run all tests
```bash
npm run test:e2e
```

### Run a specific spec file
```bash
npm run test:e2e -- --suite 10-ratings
npm run test:e2e -- --suite 24-advanced-search
```

### Run tests matching a name pattern
```bash
npm run test:e2e -- --filter "TC-RATE"
npm run test:e2e -- --filter "TC-CANCEL"
```

### Stop on first failure
```bash
npm run test:e2e -- --bail
```

### Open HTML report after run
```bash
npm run test:e2e -- --open
```

### Combine options
```bash
npm run test:e2e -- --suite 14-admin --bail --open
npm run test:e2e -- --filter "TC-AUTH" --bail
```

### Use a custom env file
```bash
npm run test:e2e -- --env-file .env.staging
```

### Skip server health check
```bash
npm run test:e2e -- --no-server-check
```

---

## Environment Variables

### Required (tests will fail or skip without these)

| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/carpooling_test?schema=public` | Test database connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis for queues, drafts, OTPs, socket tracking |
| `EXPOSE_OTP_IN_RESPONSE` | `true` | Lets test setup read OTP codes from API responses |
| `GOOGLE_MAPS_API_KEY` | Your real key | Route computation in publish-ride wizard |
| `ACCESS_TOKEN_SECRET` | Any 32+ char string | JWT access token signing |
| `REFRESH_TOKEN_SECRET` | Any 32+ char string | JWT refresh token signing |
| `JWT_SECRET` | Any 32+ char string | Legacy JWT fallback |
| `BOOKING_PAYMENT_MODE` | `bypass` | Skip Stripe payment collection for bookings |
| `STRIPE_SECRET_KEY` | `sk_test_...` | Required by Stripe SDK init (can be dummy in bypass mode) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Required by webhook signature validation |

### Recommended (prevent flaky failures)

| Variable | Value | Purpose |
|---|---|---|
| `DISABLE_RATE_LIMIT` | `true` | Prevent 429 errors during rapid test execution |
| `SMS_MOCK_MODE` | `true` | Don't send real SMS messages |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | CORS allowlist for test requests |
| `PLATFORM_FEE_PERCENT` | `0` | Simplifies price assertions |

### Optional (tests degrade gracefully without these)

| Variable | Value | Purpose |
|---|---|---|
| `VERIFF_API_KEY` | Your Veriff test key | Full DL verification session creation |
| `VERIFF_SHARED_SECRET` | Your Veriff secret | Webhook HMAC validation |
| `VERIFF_BASE_URL` | `https://stationapi.veriff.com/v1` | Veriff API endpoint |
| `AWS_ACCESS_KEY_ID` | `test` | S3 uploads (mocked in test) |
| `AWS_SECRET_ACCESS_KEY` | `test` | S3 uploads (mocked in test) |
| `AWS_REGION` | `eu-north-1` | S3 region |
| `AWS_S3_BUCKET_NAME` | `test-bucket` | S3 bucket name |

---

## What Happens If Keys Are Missing?

| Missing Variable | Effect |
|---|---|
| `GOOGLE_MAPS_API_KEY` | `publishRide()` throws → specs 04, 05, 06, 09, 10, 12, 21, 23, 24, 25, 27 skip ride-dependent tests |
| `DATABASE_URL` | Global setup cannot set `dlVerified=true` → driver accept/publish tests fail |
| `VERIFF_API_KEY` | Spec 26 tests endpoint contract only, cannot verify full session creation |
| `STRIPE_SECRET_KEY` (invalid) | Spec 20 tests rejection paths; spec 16 tests contract only |
| `DISABLE_RATE_LIMIT` not set | Some tests may intermittently get 429s |

---

## Test Execution Order

Tests run sequentially in numeric order (enforced by `tests/e2e/sequencer.cjs`):

| # | Spec | Description |
|---|---|---|
| 01 | `01-auth` | Signup, OTP, login, token refresh, logout |
| 02 | `02-user` | Profile CRUD, travel preferences |
| 03 | `03-vehicle` | Vehicle draft wizard, list, delete |
| 04 | `04-publish-ride` | Ride wizard step-by-step |
| 05 | `05-search-ride` | Basic search, filters |
| 06 | `06-booking` | Create, list, validate bookings |
| 07 | `07-driver-booking` | Accept, reject, cancel |
| 08 | `08-otp-verification` | Pickup/drop OTP verify |
| 09 | `09-cancellations` | Cancel flows, extend wait |
| 10 | `10-ratings` | Mutual ratings, validation |
| 11 | `11-notifications` | CRUD, unread count, device tokens |
| 12 | `12-journeys` | Full end-to-end integration scenarios |
| 13 | `13-chat` | WebSocket chat + REST message history |
| 14 | `14-admin` | User management, stats, vehicle verify |
| 15 | `15-user-safety` | Report, block, unblock |
| 16 | `16-stripe-connect` | Connect onboarding, status |
| 17 | `17-gdpr` | Data export, account deletion |
| 18 | `18-tos-femaleonly` | ToS enforcement, female-only rides |
| 19 | `19-dlverified` | DL verification enforcement on accept |
| 20 | `20-stripe-webhook` | Webhook signature validation |
| 21 | `21-payment-confirm` | Payment confirmation endpoint |
| 22 | `22-admin-refund` | Admin force-refund |
| 23 | `23-ride-lifecycle` | Ride start/complete transitions |
| 24 | `24-advanced-search` | Advanced D_POINTS search |
| 25 | `25-cancellation-tiers` | Refund % by timing (50%, 0%, driver penalty) |
| 26 | `26-dl-verification` | Veriff session + webhook endpoints |
| 27 | `27-chat-rest` | REST chat endpoints (send, list, read) |
| 28 | `28-user-profile` | Full profile, onboarding, public profile |
| 29 | `29-auth-extras` | Standalone OTP request, ToS validation |

---

## Global Setup & Teardown

- **`global.setup.ts`** — Creates 3 test users (driverA, passengerA, passengerB), a vehicle, accepts ToS, sets `dlVerified=true` via DB, publishes a shared ride for search/booking tests.
- **`global.teardown.ts`** — Cleans up test data created during the run.

State is persisted to `tests/e2e/.test-state.json` between setup and specs.

---

## HTML Report

After each run, an HTML report is generated at:
```
tests/e2e/report.html
```

Open it automatically:
```bash
npm run test:e2e -- --open
```

---

## Test Data Isolation

- All test users have emails ending in `@test.local`
- A unique `runId` (8-digit timestamp) is appended to all emails, preventing conflicts between concurrent runs
- `globalTeardown` deletes every user matching `*@test.local` — Prisma cascades delete all related rides, bookings, ratings, and notifications
- Each spec creates its own rides (with unique departure dates) and cleans them up in `afterAll`

---

## Helpers

| File | Purpose |
|---|---|
| `helpers/api.client.ts` | Axios wrapper — never throws on 4xx/5xx, returns raw response |
| `helpers/auth.helper.ts` | `signupAndVerifyEmail()`, `loginWithEmail()` |
| `helpers/ride.helper.ts` | `publishRide()` — walks all 10 wizard steps |
| `helpers/state.ts` | `readState()` / `writeState()` for `.test-state.json` |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Cannot reach server at localhost:3000` | Start the server first: `npm run dev:server` |
| `OTP code not returned in signup response` | Set `EXPOSE_OTP_IN_RESPONSE=true` in `.env.test` |
| `Compute routes failed` | Set a valid `GOOGLE_MAPS_API_KEY` in `.env.test` |
| `Could not set dlVerified for driver` | Ensure `DATABASE_URL` in `.env.test` points to the test DB |
| `429 Too Many Requests` | Set `DISABLE_RATE_LIMIT=true` |
| `ECONNREFUSED on Redis` | Start Redis: `redis-server` or `docker run -p 6379:6379 redis` |
| Tests pass but ride-dependent ones are skipped | Missing `GOOGLE_MAPS_API_KEY` — the shared ride wasn't published in setup |
| `DRIVER_PENDING` not returned | `BOOKING_PAYMENT_MODE` not set to `bypass` |
| Chat tests all skip | WebSocket not reachable — ensure server WebSocket is on same port as HTTP |
| Ratings return 404 | Ensure route is `POST /ratings/bookings/:bookingId` (not `POST /ratings`) |
