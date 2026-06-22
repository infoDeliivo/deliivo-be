# Phase 2: Payments & Pricing Implementation

**Date:** 2026-06-11
**Branch:** `production-readiness-fixes-phase-2`
**Status:** COMPLETE (compiles, 161/163 tests pass — 2 pre-existing failures unrelated)

---

## Summary

Implemented the payment lifecycle, distance-based pricing model, ledger system, payout processing, payment methods management, and event outbox pattern.

---

## Changes Made

### 1. Prisma Schema (`prisma/schema.prisma`)

**New models added:**

| Model | Purpose |
|-------|---------|
| `Payment` | Payment state machine (CREATED → PAID → ESCROW → PAYOUT_ELIGIBLE → COMPLETED) |
| `LedgerEntry` | Append-only double-entry accounting |
| `PayoutBatch` | Groups eligible payments for Stripe Transfer |
| `PayoutItem` | Individual payment within a payout batch |
| `PaymentEventOutbox` | Transactional outbox for async event processing |
| `PaymentMethod` | Saved cards (Stripe payment methods) |
| `PricingConfig` | Region-based pricing rules (min/recommended/max rates) |
| `RidePricingSnapshot` | Immutable pricing snapshot created at ride publish |

**Relations added:**
- `User.paymentMethods` → `PaymentMethod[]`
- `Ride.pricingSnapshot` → `RidePricingSnapshot?`
- `RideBooking.payment` → `Payment?`
- `Payment.payoutItems` → `PayoutItem[]`

---

### 2. Ledger Module: `src/modules/ledger/`

| File | Purpose |
|------|---------|
| `ledger.service.ts` | Append-only double-entry ledger with entry groups |

**Functions:**
- `recordPaymentReceived` — 3 entries: rider debit, driver credit, platform credit
- `recordRefund` — 2 entries: rider credit, driver debit
- `recordTransfer` — 1 entry: driver debit (money paid out)
- `getDriverBalance` — Derives net balance from all entries
- `getDriverEarnings` — Summary: totalEarned, totalPaidOut, totalRefunded, pendingBalance

---

### 3. Payment Service: `src/modules/payments/payment.service.ts`

**State machine with strict transitions:**
```
CREATED → PAYMENT_PENDING → PAID → HELD_IN_ESCROW → PAYOUT_ELIGIBLE → TRANSFER_CREATED → PAYOUT_COMPLETED
                                  ↘ REFUND_PENDING → REFUNDED
         ↘ PAYMENT_FAILED
```

**Functions:** `createPayment`, `markPaymentPending`, `markPaymentPaid`, `markHeldInEscrow`, `markPayoutEligible`, `markTransferCreated`, `markPayoutCompleted`, `markRefundPending`, `markRefunded`, `markPaymentFailed`, `getPaymentByBookingId`, `getPaymentsByRideId`, `getEligiblePaymentsForPayout`

---

### 4. Pricing Module: `src/modules/pricing/`

| File | Purpose |
|------|---------|
| `pricing.calculator.ts` | Distance-rate pricing with rounding strategies |
| `pricing.service.ts` | Price preview, validation + snapshot creation |
| `pricing.controller.ts` | Express handlers |
| `pricing.validator.ts` | Zod schemas |
| `pricing.routes.ts` | Router mounted at `/api/v1/pricing` |

**Pricing formula:**
```
recommendedPrice = max(minimumSeatPrice, round(distanceKm * recommendedRatePerKm))
segmentPrice = max(minimumSeatPrice, round(segmentDistanceKm * selectedRatePerKm))
```

**Rounding strategies:** `NEAREST_EURO`, `NEAREST_HALF_EURO`

---

### 5. Payout Module: `src/modules/payout/`

| File | Purpose |
|------|---------|
| `payout.service.ts` | Eligibility check, batch processing via Stripe Transfer |
| `payout.controller.ts` | Admin + driver endpoints |
| `payout.routes.ts` | `adminPayoutRouter` + `driverPayoutRouter` |

**Business rules:**
- 48-hour dispute window before eligibility
- Batch all eligible payments per driver into single Stripe Transfer
- Records ledger entries for each transfer

---

### 6. Payment Methods Module: `src/modules/payment-methods/`

| File | Purpose |
|------|---------|
| `payment-methods.service.ts` | CRUD for saved cards via Stripe SetupIntents |
| `payment-methods.controller.ts` | Express handlers |
| `payment-methods.routes.ts` | Router mounted at `/api/v1/payment-methods` |

---

### 7. Event Outbox Worker: `src/modules/payments/payment-outbox.worker.ts`

- Polls `PaymentEventOutbox` for pending events
- Processes with registered handlers (payment.paid → escrow, booking.completed → eligible)
- Exponential backoff retry (max 5 attempts)
- `writeOutboxEvent` utility for transactional writes

---

### 8. Route Registration

**`src/modules/index.ts`** — added exports: `pricingRouter`, `paymentMethodsRouter`, `adminPayoutRouter`, `driverPayoutRouter`

**`src/app.ts`** — mounted at:
```typescript
app.use('/api/v1/pricing', protect, pricingRouter);
app.use('/api/v1/payment-methods', protect, paymentMethodsRouter);
app.use('/api/v1/admin/payouts', protect, adminPayoutRouter);
app.use('/api/v1/drivers/me', protect, driverPayoutRouter);
```

---

## API Endpoints Added

### Pricing (`/api/v1/pricing`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/price-preview` | Calculate pricing for a distance |
| POST | `/validate` | Validate driver price + create snapshot |
| GET | `/configs` | List active pricing configs |

### Payment Methods (`/api/v1/payment-methods`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List saved cards |
| POST | `/setup-intent` | Create Stripe SetupIntent |
| POST | `/save` | Save confirmed payment method |
| POST | `/:id/default` | Set as default |
| DELETE | `/:id` | Remove (detach from Stripe) |

### Admin Payouts (`/api/v1/admin/payouts`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/process` | Trigger payout for a driver |
| POST | `/check-eligibility` | Mark eligible payments past dispute window |

### Driver Earnings (`/api/v1/drivers/me`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/payouts` | Payout history |
| GET | `/earnings` | Earnings summary |
| GET | `/balance` | Current balance |

---

## Integration Tests

**File:** `src/modules/integration/payments-pricing.integration.test.ts` — **35 tests**

| Section | Tests | Coverage |
|---------|-------|----------|
| Pricing Calculator | 7 | Distance-rate, minimum price, bounds, segments |
| Pricing Service | 3 | Preview, snapshot creation, validation rejection |
| Payment State Machine | 8 | Full lifecycle, invalid transitions |
| Payment Refund Flow | 2 | Refund pending → refunded with ledger |
| Payment Failure Flow | 1 | Created → failed |
| Ledger Service | 4 | 3-entry payment, 0-fee skip, balance, earnings |
| Payout Service | 2 | Batch processing, no eligible payments |
| Payment Methods | 5 | Setup intent, save, list, default, remove |
| Event Outbox | 2 | Write + process |

**Run command:**
```bash
npx jest --testPathPattern="payments-pricing.integration" --no-coverage --verbose
```

---

## Verification

```bash
# TypeScript compilation: 0 errors
npx tsc --noEmit

# Full test suite: 161/163 pass (2 pre-existing failures unrelated)
npx jest --no-coverage

# Prisma client generated successfully
npx prisma generate
```

---

## Migration Required

Run before deploying:
```bash
npx prisma migrate dev --name payments-pricing-phase-2
```

This will add all 8 new tables and their relations.

---

## Dependencies

- Existing: `prisma`, `stripe` (v21), `zod`
- No new packages required
- Stripe Connect already set up (Phase A/C)

---

## What's NOT in Phase 2 (deferred)

- Reconciliation service (Phase 5)
- Dispute system (Phase 4)
- Automatic payout scheduling (cron — add when ready)
- Webhook handler updates for payment.paid → outbox event (wire up in stripe.webhook.controller)
- Pricing validation hook in ride publish flow (needs integration with publish-ride module)
