# ADR: Referral Rewards, Ride Milestones, And Wallet-Based Incentives

## Status

Proposed.

## Context

Deliivo wants a configurable rewards program for riders and drivers that covers:

- referral rewards
- rider ride-completion rewards
- driver ride-completion rewards
- wallet visibility for earned credit

The program must be configurable from the admin backend and must not hardcode reward thresholds or amounts in the application flow.

The business rules are different from payment processing:

- rider rewards reduce what the rider pays or create wallet credit
- driver rewards increase future payout amounts
- some rewards are wallet credit, while others are payout bonuses
- referral and milestone logic must stay auditable and reversible

Stripe Connect is already the platform's payout rail. Stripe should move money, but Deliivo should own the reward rules, eligibility, wallet balances, and accounting state.

Stripe documentation for Connect top-ups notes that platforms can add funds to pay bonuses or provide customer discounts while still paying sellers full price. Stripe also states that failed transfers or payouts from insufficient balance are not automatically retried after adding funds. Separate charges and transfers let the platform split payment and transfer logic cleanly. Sources: [Stripe top-ups](https://docs.stripe.com/connect/top-ups), [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers), [Stripe payout API](https://docs.stripe.com/api/payouts/create)

## Decision

Use a Deliivo-owned reward engine with these core records:

- reward campaign definition
- reward eligibility event
- reward grant
- wallet entry
- payout bonus item
- reversal or void entry

Rewards are created only after completed actions, not on registration alone.

Reward examples:

- referred rider completes first booking and ride
- referred driver publishes a ride and completes it
- rider completes 3 rides
- driver completes 3 rides

Admin must be able to configure all thresholds and amounts.

## Architecture

### Reward Types

1. Wallet credit for riders
1. Wallet credit or payout bonus for drivers
1. Manual admin reward

Rider wallet credit can be used for future booking checkout.

Driver reward should usually flow into payout eligibility and then into Stripe Connect transfer batches.

### Reward Eligibility

The system should evaluate events such as:

- booking completed
- ride completed
- ride published
- referral completed
- payout disputed or refunded

Eligibility rules must be versioned or snapshotted so historic rewards remain explainable after a campaign edit.

### Wallet Model

Wallet entries should track:

- available amount
- pending amount
- used amount
- expired amount
- reversed amount
- campaign source
- eligibility source

This keeps the user-facing wallet simple while preserving an internal audit trail.

### Stripe Handling

Stripe should only be used for:

- rider payment collection
- platform balance top-up
- driver payout transfer

Deliivo must calculate when a rider reward causes a discount or subsidy.

If rider credit reduces checkout below the driver receivable:

- Deliivo records a subsidy liability
- Stripe still only sees the actual payment and eventual transfer amounts

If driver bonuses push payout above collected fare:

- Deliivo records a bonus liability
- Stripe transfer is funded from platform balance

If platform balance is short:

- payout stays pending or failed retryably
- admin tops up the balance
- Deliivo retries the transfer

## Data Model

### RewardCampaign

- `id`
- `name`
- `publicTitle`
- `publicDescription`
- `audience`: `RIDER`, `DRIVER`, `BOTH`
- `triggerType`: `REFERRAL`, `RIDE_COMPLETION`, `BOOKING_COMPLETION`, `PUBLISH_COMPLETION`
- `requiredCount`
- `rewardType`: `WALLET_CREDIT`, `PAYOUT_BONUS`
- `currency`
- `amount`
- `status`: `DRAFT`, `ACTIVE`, `PAUSED`, `EXPIRED`, `ARCHIVED`
- `expiryDays`
- `maxBudgetAmount`
- `maxPerUser`
- `maxRedemptions`
- `countryScope`
- `routeScope`
- `eligibilityRuleJson`
- `createdById`
- `updatedById`
- `createdAt`
- `updatedAt`

### RewardEligibilityEvent

- `id`
- `campaignId`
- `userId`
- `actorRole`
- `sourceType`
- `sourceId`
- `dedupeKey`
- `status`
- `metadataJson`
- `createdAt`

### RewardGrant

- `id`
- `campaignId`
- `userId`
- `currency`
- `amount`
- `rewardType`
- `status`: `PENDING`, `AVAILABLE`, `APPLIED`, `PAYOUT_ELIGIBLE`, `PAID`, `VOIDED`, `EXPIRED`
- `sourceEventId`
- `expiresAt`
- `payoutBatchId`
- `createdAt`
- `updatedAt`

### WalletEntry

- `id`
- `userId`
- `rewardGrantId`
- `entryType`
- `amount`
- `currency`
- `availableAfter`
- `status`
- `createdAt`

## API Design

### User APIs

- `GET /api/v1/users/me/wallet`
  - return credit, pending rewards, used rewards, and history
- `GET /api/v1/users/me/rewards`
  - return referral and milestone progress
- `GET /api/v1/offers`
  - return active campaigns for current user

### Admin APIs

- `GET /api/v1/admin/reward-campaigns`
- `POST /api/v1/admin/reward-campaigns`
- `GET /api/v1/admin/reward-campaigns/:id`
- `PUT /api/v1/admin/reward-campaigns/:id`
- `POST /api/v1/admin/reward-campaigns/:id/pause`
- `POST /api/v1/admin/reward-campaigns/:id/activate`
- `POST /api/v1/admin/users/:id/rewards/manual-grant`
- `POST /api/v1/admin/rewards/:id/void`
- `GET /api/v1/admin/users/:id/wallet`
- `GET /api/v1/admin/rewards/liabilities`

### Payout APIs

- `GET /api/v1/admin/payouts`
- `POST /api/v1/admin/payouts/:id/retry`
- `POST /api/v1/admin/payouts/:id/top-up-required`

## Admin Portal

The admin portal should include:

- reward campaigns table
- campaign builder form
- reward eligibility details
- wallet view per user
- manual grant and void actions
- payout bonus list
- funding shortfall indicators

The admin portal should let operators configure:

- rider milestone threshold and amount
- driver milestone threshold and amount
- referral reward amount
- whether the reward is wallet credit or payout bonus
- when the reward becomes available
- whether the reward is route-specific or global

## Why This Design

- It keeps reward logic in Deliivo, not Stripe.
- It avoids hardcoding `3 rides = 5 EUR`.
- It supports both rider wallet credit and driver payout bonuses.
- It gives support and finance a clear audit trail.
- It lets campaigns change without breaking historic accounting.

## Consequences

- Requires a small rewards domain and wallet ledger.
- Requires campaign versioning or snapshots.
- Requires payout integration to include bonus items.
- Requires new admin surfaces.
- Requires anti-abuse checks and reversal logic.

## Alternatives Considered

- Hardcode milestone rewards in code.
  - Rejected because the admin team needs configurability.
- Use Stripe alone for referral logic.
  - Rejected because Stripe cannot own campaign eligibility and wallet history.
- Pay all rewards as cash immediately.
  - Rejected because that adds withdrawal and fraud complexity.
- Reduce driver fare instead of granting a driver reward.
  - Rejected because it makes driver earnings opaque.

## Implementation Phases

### Phase 1

- campaign CRUD
- manual wallet grant
- wallet UI
- audit trail

### Phase 2

- automatic referral detection
- automatic milestone detection
- reward eligibility workers

### Phase 3

- checkout credit application for riders
- payout bonus inclusion for drivers

### Phase 4

- budgets, fraud controls, expiry, reversal, and payout retry

## Decision Notes

- Rewards are only earned after completion events.
- Wallet credit and payout bonus are separate concepts.
- Stripe Connect is the transfer rail, not the policy engine.
- Campaign thresholds and amounts must be editable from admin.

