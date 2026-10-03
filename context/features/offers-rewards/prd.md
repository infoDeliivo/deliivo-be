# PRD: Referral Program, Ride Milestones, And Wallet Rewards

## Purpose

Create a configurable rewards system that gives riders and drivers wallet credit or payout bonuses when they complete referral and ride milestones. The feature must improve retention and supply growth without breaking fare clarity, payout accuracy, or Stripe Connect accounting.

## Product Goals

- Reward riders for successful referrals and completed ride milestones.
- Reward drivers for successful referrals and completed ride milestones.
- Show all rewards in a visible wallet for both riders and drivers.
- Let admins configure thresholds, amounts, expiry, budgets, and eligibility rules.
- Use Stripe Connect for payout movement and platform balance funding, not for campaign logic.

## Users

- Rider: receives wallet credit for successful referrals and completed ride milestones.
- Driver: receives wallet credit or payout bonus for successful referrals and completed ride milestones.
- Admin: configures campaigns, rewards, budgets, eligibility rules, and manual overrides.
- Support operator: reviews reward disputes, abuse cases, and payout funding issues.

## Core Concept

Deliivo runs reward campaigns that are triggered by completed actions, not signups.

Examples:

- Rider referral reward when the referred person completes their first booking and ride.
- Driver referral reward when the referred driver publishes a ride and completes it.
- Rider milestone reward when a rider completes 3 rides.
- Driver milestone reward when a driver completes 3 rides.

The default values can start as `EUR 5`, but every number must be configurable from admin.

## Reward Types

- Referral reward: credit granted after a referred user completes a qualifying action.
- Ride milestone reward: credit granted after a user completes N rides.
- Driver milestone bonus: payout bonus granted after a driver completes N rides.
- Manual admin reward: reward granted by support or finance after review.

## Reward Storage And Wallets

Each rider and driver should have a wallet view that shows:

- available credit
- pending rewards
- earned rewards
- used rewards
- expired rewards
- reversed rewards
- reward source
- campaign source
- expiry date

Wallet behavior:

- Rider wallet credit is spendable on future bookings.
- Driver wallet credit is normally a payout bonus or payout-ready balance, not a spendable in-app discount.
- Wallet totals must separate pending from available amounts.
- Wallet entries must remain auditable after edits to campaigns.

## Configurable Rules

Admins must be able to configure:

- audience: rider, driver, or both
- trigger type: referral, ride count, publish count, booking completion, ride completion
- required count: for example 1, 3, 5
- reward amount
- currency
- wallet type: credit or payout bonus
- expiry duration
- route scope
- country scope
- user role scope
- max reward per user
- max campaign budget
- max redemptions
- active / paused / expired state
- fraud hold and manual review requirement

## Referral Rules

Rider referral:

- reward is granted only when the referred user completes a valid booking and ride completion
- reward is credited to the referrer wallet
- reward should be blocked if the referred booking is refunded, cancelled, disputed, or marked fraudulent

Driver referral:

- reward is granted only when the referred driver publishes a ride and completes at least one ride
- reward is credited to the referrer wallet or payout bonus pool
- reward should be blocked if the referred ride is refunded, cancelled, disputed, or fraudulent

## Milestone Rules

Rider milestone:

- reward when a rider completes N rides
- default example: `EUR 5` after 3 completed rides

Driver milestone:

- reward when a driver completes N rides
- default example: `EUR 5` after 3 completed rides

The milestone count and amount must be configurable independently for riders and drivers.

## User Experience

### Rider

- Rider can open a wallet screen and see reward balance.
- Rider can see why a reward is pending, available, or expired.
- Rider can see referral progress and ride milestone progress.
- Rider can see which reward came from which campaign.

### Driver

- Driver can open a wallet screen and see reward balance and payout bonus balance.
- Driver can see referral progress and milestone progress.
- Driver can see which rewards are waiting for payout eligibility.
- Driver can see payout history for bonuses.

## Admin Portal Requirements

Admin must be able to:

- create and edit reward campaigns
- set trigger type and thresholds
- set reward amount and currency
- set whether the reward becomes wallet credit or payout bonus
- set the campaign budget
- set per-user caps
- pause and resume campaigns
- expire campaigns manually
- view campaign performance
- inspect reward grants and eligibility events
- manually grant or void rewards
- override reward decisions after review
- see wallet balances for any user
- see payout eligibility and pending bonus items

## Stripe Connect Requirements

Stripe Connect must be used only for payout movement, not as the source of reward rules.

### Driver bonuses

- Driver bonus rewards become payout items after eligibility is confirmed.
- The payout batch should include ride earnings plus driver bonuses.
- If the platform Stripe balance is short, the payout stays pending or fails retryably.
- Admin can top up the platform balance and retry the payout.

### Rider wallet credit

- Rider wallet credit is applied to future checkout.
- If a credit reduces rider cash collected below driver receivable, Deliivo absorbs the difference.
- Deliivo must track that difference as internal subsidy liability.
- Stripe does not decide this automatically.

### Platform funding

- Deliivo can top up the Stripe platform balance when campaign payouts or subsidies need extra funds.
- Failed transfers are not automatically retried by Stripe after a top-up.
- Deliivo must retry them after funding is available.

## Functional Requirements

- Rewards must be created only after a qualifying completion event.
- Rewards must be idempotent.
- Rewards must support manual approval and manual rejection.
- Wallet history must keep the campaign and source event attached.
- Referral rewards must prevent self-referral and obvious abuse.
- Reward expiration must be supported.
- Refunds, cancellations, disputes, and chargebacks must block or reverse rewards where applicable.
- Admin screens must show both earned and pending reward states.
- Public pricing must not confuse reward logic with ride fare.

## Non-Goals

- Cash withdrawal from rider wallet credit.
- Automatic public discounting without admin-configured campaigns.
- Using Stripe alone as the business rule engine.
- Rewarding signups without completion.

## Success Metrics

- referral conversion rate
- rider repeat booking rate
- driver repeat publishing rate
- reward redemption rate
- completed ride milestone rate
- completed referral rate
- payout bonus completion rate
- wallet credit usage rate
- campaign budget utilization
- platform balance shortfall count

## Launch Phases

### Phase 1: Admin-configured manual rewards

- create campaigns in admin
- grant rewards manually after review
- show wallet screens
- record all reward events in the ledger

### Phase 2: Automatic referrals and milestones

- detect qualifying referral completions automatically
- detect ride count milestones automatically
- issue wallet credits and driver bonuses automatically

### Phase 3: Checkout and payout automation

- apply rider wallet credit during booking checkout
- add driver bonuses to payout batches
- show pending, available, used, expired, and reversed states

### Phase 4: Budget and fraud controls

- add campaign spend caps
- add stronger anti-abuse checks
- add funding shortfall handling and payout retry flow

## Code References

- `src/modules/admin`
- `src/modules/payments`
- `src/modules/payout`
- `src/modules/ledger`
- `src/modules/ride-booking`
- `src/modules/reconciliation`
- `src/modules/referrals`
- `prisma/schema.prisma`
- `deliivo-webapp/src/app/profile`
- `deliivo-webapp/src/app/admin`

## Open Questions

- Should rider referral rewards be credited immediately after the referred ride completes, or after a short dispute window?
- Should driver referral rewards be paid as wallet credit, payout bonus, or both?
- Should rider milestone rewards stack with referral rewards on the same wallet?
- Should one campaign be able to target both riders and drivers with different amounts?
- Should the wallet support partial redemption of credit across multiple bookings?
- What is the default expiry for unused wallet credit?

