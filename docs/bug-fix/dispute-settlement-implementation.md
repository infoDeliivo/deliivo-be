# Dispute Settlement Implementation

## Backend Contract

The backend already had dispute creation, evidence collection, rule evaluation, payout processing, ledger entries, and reconciliation. The missing link was settlement execution: admin decisions changed only dispute status and did not apply payment outcomes.

## Implemented

### Shared Dispute State

Dispute statuses now live in `src/modules/dispute/dispute.constants.ts`.

Open/unresolved statuses are shared across dispute creation, settlement, and payout freeze:

- `OPEN`
- `EVIDENCE_COLLECTED`
- `NEEDS_MANUAL_REVIEW`
- `WAITING_FOR_USER_RESPONSE`
- `ESCALATED`

### Settlement Executor

Added `src/modules/dispute/dispute-settlement.service.ts`.

It handles:

- `REFUND`
  - marks booking refund fields
  - issues Stripe refund when a captured Stripe payment exists
  - supports bypass/mock mode by recording refund without Stripe
  - marks `Payment` as `REFUNDED`
  - records refund ledger entry when a `Payment` record exists
  - updates dispute to `RESOLVED_REFUND`

- `PAYOUT`
  - marks `Payment` as `PAYOUT_ELIGIBLE`
  - records dispute as `RESOLVED_PAYOUT`
  - lets existing payout service process the driver payout

- `SPLIT`
  - accepts `refundPercent`
  - refunds that percentage to rider
  - reduces `Payment.fareAmount` to the remaining driver payout basis
  - marks remaining payment as `PAYOUT_ELIGIBLE` when applicable
  - records dispute as `RESOLVED_SPLIT`

- `ESCALATE`
  - keeps payment frozen
  - records dispute as `ESCALATED`

All settlement outcomes notify rider and driver and emit `dispute:updated`.

### Auto-Resolution Wiring

Admin `evaluate` now executes settlement for clear auto outcomes:

- `AUTO_RESOLVED_RIDER_REFUND` executes `REFUND`
- `AUTO_RESOLVED_DRIVER_PAYOUT` executes `PAYOUT`

Manual review outcomes remain in the admin queue.

### Payout Freeze

Payout eligibility and payout processing now exclude payments whose booking has an unresolved dispute.

This prevents a payment from becoming payout eligible while a dispute is open or escalated.

### Reconciliation

Daily reconciliation now:

- ignores stale escrow when an open/escalated dispute is intentionally freezing payment
- creates `DISPUTE_PAYMENT_MISMATCH` issues when a resolved dispute does not match the payment state
- returns pagination metadata in the shape expected by the web admin page

## Web Portal

### Admin Disputes

The admin disputes page now:

- sends `refundPercent` for `SPLIT`
- shows recommendation and risk score after evaluation
- shows payment status and amount
- surfaces action errors instead of silently ignoring failures

### Rider Ride Detail

The rider ride detail page now:

- loads disputes for the current booking
- shows existing open dispute state
- disables duplicate report creation while a dispute is unresolved

### Driver Manage Ride

The driver manage ride page now:

- has contextual `Report issue` actions for terminal or problematic passenger states
- creates disputes with the current ride and booking IDs

### Profile Disputes

The profile disputes list now uses the backend dispute states and shows route context.

## Verification

Passed:

```powershell
npm.cmd exec tsc -- --noEmit
cd web
npx.cmd tsc --noEmit
```

