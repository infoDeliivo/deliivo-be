# ADR: Offers, Credits, Subsidies, And Driver Bonus Architecture

## Status

Proposed.

## Context

Deliivo wants rider and driver offers to improve route liquidity. Rider offers can reduce checkout amounts, while driver offers can add payout amounts. These are financially different operations and must not be mixed into one ambiguous discount field.

The platform already has payment, payout, ledger, reconciliation, pricing, ride booking, and admin modules. Current payout processing sums eligible `payment.fareAmount` values and creates a Stripe transfer to the driver's connected account. Driver bonuses and rider credit subsidies are not yet represented as first-class payout or ledger objects.

Stripe Connect transfers are not automatically funded by Stripe. A transfer to a connected account uses the platform's available Stripe balance. If the requested transfer exceeds available balance, the transfer fails unless the transfer is tied to a source transaction that will settle. Adding funds later does not automatically retry failed transfers.

Stripe supports adding funds to platform balance for permitted use cases, including paying bonuses, funding customer discounts while paying sellers full price, and one-off payouts to connected accounts.

References:

- Stripe separate charges and transfers: https://docs.stripe.com/connect/separate-charges-and-transfers
- Stripe top-ups / adding funds to platform balance: https://docs.stripe.com/connect/top-ups

## Decision

Use separate domain records for:

- offer campaign definitions,
- rider credit grants,
- rider credit applications,
- driver reward grants,
- reward eligibility events,
- subsidy ledger entries,
- payout bonus items.

Rider credits reduce rider checkout amount. Driver fare remains unchanged. Any gap between rider cash collected and driver receivable is recorded as Deliivo subsidy liability.

Driver bonuses are not stored as ride fare. They are stored as driver reward records and included in payout batches as separate payout items after eligibility and dispute checks pass.

Stripe remains the external money movement rail. Deliivo remains the source of truth for reward eligibility, liability, subsidy, and audit state.

## Architecture

### Checkout Calculation

Booking price calculation should produce:

- base price per seat,
- seats booked,
- fare subtotal,
- service fee,
- eligible rider credit,
- credit applied to service fee,
- credit applied as Deliivo subsidy,
- rider amount to charge,
- driver receivable amount,
- total to pay before credit,
- offer/campaign IDs.

For public rider UI:

- ride cards and ride detail summary show seat fare,
- fare breakdown shows service fee, credit, and final total to pay.

For admin UI:

- show all amounts, including Deliivo subsidy and campaign source.

### Ledger

Ledger should represent both cash and obligations:

- rider cash collected,
- driver payable,
- platform service fee earned,
- service fee waived,
- Deliivo subsidy expense,
- driver bonus payable,
- Stripe transfer created,
- payout completed,
- reversals or voids.

Ledger entries must carry booking, ride, payment, offer, campaign, driver, rider, and payout batch references where available.

### Payout

Payout processing should gather:

- eligible ride earnings from payment records,
- eligible driver reward grants,
- approved manual adjustments.

It should create a payout batch with item types:

- `RIDE_EARNING`
- `DRIVER_BONUS`
- `MANUAL_ADJUSTMENT`
- `REVERSAL`

The Stripe transfer amount is the sum of positive eligible payable items minus approved negative adjustments.

Before marking a payout completed, the processor must create the Stripe transfer successfully. If Stripe returns insufficient funds or another transfer failure, the batch remains failed or pending funds and is retryable.

### Stripe Balance

Stripe does not know Deliivo's campaign budget. Deliivo must track budget internally and ensure the platform Stripe balance is available before transfer.

If rider paid EUR 14 and driver payout owed is EUR 21:

- Deliivo records EUR 7 liability.
- Payout transfer for EUR 21 succeeds only if platform available balance can cover it.
- If balance is insufficient, Deliivo must top up or wait for other platform funds, then retry.

## Proposed Data Model

Exact Prisma naming can change during implementation, but the domain should include these concepts.

### OfferCampaign

- `id`
- `name`
- `publicTitle`
- `publicDescription`
- `audience`: `RIDER`, `DRIVER`, `BOTH`
- `rewardType`: `RIDER_CREDIT`, `DRIVER_BONUS`, `REFERRAL`, `ROUTE_CHALLENGE`
- `currency`
- `amount`
- `routeScope`
- `originPlaceId`
- `destinationPlaceId`
- `startsAt`
- `endsAt`
- `status`: `DRAFT`, `ACTIVE`, `PAUSED`, `EXPIRED`, `ARCHIVED`
- `fundingMode`: `SERVICE_FEE_ONLY`, `SUBSIDY_ALLOWED`
- `maxBudgetAmount`
- `maxRedemptions`
- `maxPerUser`
- `eligibilityRuleJson`
- `completionRuleJson`
- `createdById`
- `updatedById`
- `createdAt`
- `updatedAt`

### RiderCreditGrant

- `id`
- `userId`
- `campaignId`
- `currency`
- `amountGranted`
- `amountRemaining`
- `expiresAt`
- `status`: `ACTIVE`, `USED`, `EXPIRED`, `VOIDED`
- `sourceType`: `CAMPAIGN`, `REFERRAL`, `MANUAL_ADMIN`
- `sourceId`
- `createdById`
- `createdAt`
- `updatedAt`

### RiderCreditApplication

- `id`
- `creditGrantId`
- `bookingId`
- `paymentId`
- `campaignId`
- `currency`
- `amountApplied`
- `serviceFeeWaivedAmount`
- `subsidyAmount`
- `createdAt`

### DriverRewardGrant

- `id`
- `driverId`
- `campaignId`
- `currency`
- `amount`
- `status`: `PENDING`, `PAYOUT_ELIGIBLE`, `PAYOUT_PROCESSING`, `PAID`, `VOIDED`, `EXPIRED`
- `sourceType`: `FIRST_RIDE`, `ROUTE_CHALLENGE`, `REFERRAL`, `MANUAL_ADMIN`
- `sourceRideId`
- `sourceBookingId`
- `payoutEligibleAt`
- `payoutBatchId`
- `createdById`
- `createdAt`
- `updatedAt`

### RewardEligibilityEvent

- `id`
- `campaignId`
- `userId`
- `driverId`
- `rideId`
- `bookingId`
- `eventType`
- `dedupeKey`
- `status`
- `metadataJson`
- `createdAt`

## API Design

### Rider/User APIs

- `GET /api/v1/offers`
  - List active offers relevant to current user.
- `GET /api/v1/users/me/credits`
  - List active and historical rider credits.
- `POST /api/v1/bookings/price-preview`
  - Extend response with credit and subsidy fields.
- `POST /api/v1/bookings`
  - Apply selected or automatic rider credit idempotently.

### Driver APIs

- `GET /api/v1/driver/rewards`
  - List driver reward progress, pending bonuses, payout eligible bonuses, and paid bonuses.
- `GET /api/v1/profile/earnings`
  - Include bonus items and totals separately from ride fare.

### Admin APIs

- `GET /api/v1/admin/offers`
- `POST /api/v1/admin/offers`
- `GET /api/v1/admin/offers/:id`
- `PUT /api/v1/admin/offers/:id`
- `POST /api/v1/admin/offers/:id/pause`
- `POST /api/v1/admin/offers/:id/activate`
- `POST /api/v1/admin/users/:id/credits`
- `POST /api/v1/admin/users/:id/driver-rewards`
- `POST /api/v1/admin/rewards/:id/void`
- `GET /api/v1/admin/rewards/liabilities`
- `POST /api/v1/admin/payouts/:batchId/retry`

## Admin Portal Implementation

Add admin pages:

- `/admin/offers`
  - campaign table, search, status filters, spend and liability columns.
- `/admin/offers/new`
  - campaign setup wizard.
- `/admin/offers/[id]`
  - campaign detail, metrics, eligibility records, redemptions, rewards, audit trail.
- `/admin/rewards`
  - rider credits, driver rewards, manual grants, voids, fraud holds.
- Existing `/admin/payouts`
  - add bonus item rows, subsidy liability, insufficient-funds reason, retry action.
- Existing `/admin/users/[id]`
  - add credits, rewards, offer eligibility, referral history.
- Existing `/admin/rides` and dispute screens
  - show campaign source, rider credit used, service fee waived, subsidy amount, and related reward items.

Admin pages must use explicit confirmation for manual grants, voids, and payout retries. Admin mutations must create audit entries.

## Implementation Plan

### Step 1: Schema And Ledger Foundation

- Add campaign, rider credit, credit application, driver reward, and eligibility event models.
- Add ledger entry types for service fee waiver, subsidy expense, and driver bonus payable.
- Add payout item type support.

### Step 2: Admin Offer Management

- Build admin CRUD for campaigns.
- Build manual rider credit and driver reward grants.
- Add offer and reward audit trail.

### Step 3: Driver Bonus Payout Support

- Extend payout candidate query to include eligible `DriverRewardGrant` records.
- Create payout items for ride fare and driver bonus separately.
- Mark reward grants paid only after Stripe transfer succeeds.
- Add failed or pending-funds retry flow.

### Step 4: Rider Credit Checkout

- Extend price preview to evaluate credits.
- Apply credits idempotently on booking creation.
- Store credit application, service fee waived, subsidy amount, and campaign source.
- Ensure driver fare and payout receivable are not reduced.

### Step 5: Automatic Eligibility Workers

- Add worker that consumes booking completed, ride completed, referral completed, and payout/dispute events.
- Create reward grants once per dedupe key.
- Hold or void rewards for refunds, open disputes, cancelled rides, or abuse flags.

### Step 6: User-Facing Offer UI

- Add rider offers and credits view.
- Add driver rewards and progress view.
- Add offer cards in relevant route/search/profile surfaces without making checkout pricing inconsistent.

## Rationale

- Separating rider credits from driver bonuses keeps accounting clear.
- Keeping driver fare unchanged protects driver trust.
- Recording subsidy liability lets Deliivo understand real marketing cost.
- Including bonuses as payout items lets driver earnings remain transparent.
- Internal ledger and admin screens avoid relying on Stripe dashboard interpretation for business rules.

## Consequences

- Checkout, payment, ledger, payout, and admin code all need coordinated changes.
- Campaign edits require versioning or snapshots to explain historical redemptions.
- Deliivo must monitor platform Stripe balance before creating subsidy-funded or bonus-funded transfers.
- Payout failure handling must become more explicit than a generic failed batch.
- Finance reporting must distinguish revenue waived from cash subsidy.

## Alternatives Considered

- Apply rider credit only to service fee. Lower risk and simpler, but limits growth offers and does not support larger subsidies.
- Pay riders cash rewards. Rejected for launch because it adds withdrawal, compliance, fraud, and support complexity.
- Reduce driver fare when riders use credits. Rejected because it damages driver trust and makes offer cost unclear.
- Store bonuses as fake payments. Rejected because bonuses are not rider payments and need separate audit and payout semantics.
- Let Stripe decide funding automatically. Rejected because Stripe does not manage Deliivo's campaign budget or automatically fund failed transfers.

## Operational Rules

- No signup-only rewards.
- No rewards on refunded, cancelled, disputed, or fraudulent activity.
- No driver bonus payout before normal payout eligibility delay.
- No payout marked completed before Stripe transfer succeeds.
- If platform balance is insufficient, mark payout `PENDING_FUNDS` or `FAILED_INSUFFICIENT_FUNDS` and expose retry.
- Manual grants require admin reason and audit log.
- Subsidy-enabled campaigns require budget cap.

## Code References

- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/payments/payment.service.ts`
- `src/modules/payments/stripe.service.ts`
- `src/modules/payout/payout.service.ts`
- `src/modules/ledger/ledger.service.ts`
- `src/modules/reconciliation`
- `src/modules/admin`
- `prisma/schema.prisma`
- `deliivo-webapp/src/app/rides/[id]/page.tsx`
- `deliivo-webapp/src/app/profile/earnings`
- `deliivo-webapp/src/app/admin`

## Decision Trace

- This ADR extends the existing payments and payout architecture in `../payments-payouts-reconciliation/adr.md`.
- This ADR depends on pricing and booking semantics documented in `../pricing/adr.md` and `../ride-publishing-search-booking/adr.md`.
- Admin operation requirements should be reflected in `../admin-operations/prd.md` if this feature is scheduled for implementation.

