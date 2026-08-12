# PRD: Offers, Rider Credits, And Driver Rewards

## Purpose

Create targeted marketplace offers that improve route liquidity while preserving clear payment, payout, subsidy, and audit behavior. Offers must help Deliivo attract riders and drivers without confusing the price shown to users or underpaying drivers.

## Users

- Rider: earns credits or coupons and applies them to future bookings.
- Driver: earns bonuses after completing qualifying rides or referral goals.
- Admin: creates, monitors, pauses, approves, and reconciles offers, credits, bonuses, subsidies, and payout impact.
- Support operator: explains offer eligibility and investigates reward or payout issues.

## Product Strategy

Offers should be route-specific and time-boxed before they are platform-wide. The goal is to create useful supply and demand on priority routes, not to distribute discounts randomly.

Priority launch route examples:

- Tallinn to Tartu
- Tartu to Tallinn
- Tallinn to Narva
- Tallinn to Parnu
- Tallinn to Riga
- Riga to Tallinn
- Riga to Vilnius
- Vilnius to Riga

Launch offers should reward completed marketplace activity:

- Rider first completed booking credit.
- Rider referral credit after referred rider completes a first ride.
- Rider return-trip credit after completing an outbound booking.
- Driver first completed published ride bonus.
- Driver route challenge bonus after completing N qualifying rides.
- Driver referral bonus after referred driver completes N qualifying rides.

Offers must not reward account creation alone. Rewards should unlock only after real completed rides, paid bookings, or verified driver activity.

## Definitions

- Offer: admin-created campaign visible to riders, drivers, or both.
- Rider credit: non-withdrawable Deliivo credit used against future booking checkout.
- Coupon: a code or automatically assigned discount rule that grants rider credit or checkout discount.
- Driver bonus: withdrawable driver reward added to driver payout after qualifying conditions are satisfied.
- Subsidy: Deliivo-funded amount required when rider pays less than the driver fare owed.
- Service fee waiver: rider credit that only reduces Deliivo service fee revenue.
- Platform balance: Deliivo's available Stripe platform balance used for Stripe transfers to connected driver accounts.

## Functional Requirements

### Rider Offers

- Riders can see active offers relevant to them.
- Riders can see earned credits, expiry dates, and usage history.
- Rider credits can be applied automatically at booking checkout when eligible.
- Rider credits must reduce the rider amount charged but must not reduce driver fare.
- Rider credits can be limited by route, date range, first-booking status, max redemption count, and user eligibility.
- Rider credits can be configured to apply against:
  - service fee only, or
  - service fee plus Deliivo-funded fare subsidy.
- Checkout must show:
  - driver fare / seat fare,
  - service fee,
  - rider credit applied,
  - total to pay,
  - Deliivo subsidy amount where relevant in admin-facing records only.
- Public ride cards and ride detail summary should show seat fare, not service-fee-inclusive total. Service fee and credit effects belong in the fare breakdown.

### Driver Offers

- Drivers can see available driver bonuses and route challenges.
- Drivers can see bonus progress, eligibility, expiry date, and payout status.
- Driver bonus eligibility must be based on completed rides or completed referred-driver activity.
- Driver bonuses must become payout eligible only after the qualifying ride or rule is complete and after normal payout/dispute delay rules.
- Driver bonuses must be included in payout batches as separate payout items, not hidden inside ride fare.
- Driver bonuses must have reason, campaign, rule, and admin audit metadata.

### Referrals

- Users can receive referral links or codes.
- Referral rewards should unlock only after the referred user completes the required action.
- Rider referral reward: non-withdrawable rider credit.
- Driver referral reward: driver bonus, payable through Stripe Connect.
- Anti-abuse checks must prevent self-referral, duplicate accounts, repeated device/payment abuse where detectable, and rewards on refunded/disputed bookings.

### Admin Portal

Admin must support:

- Offer list with filters by status, audience, route, reward type, start/end date, and budget.
- Create/edit offer form:
  - name,
  - internal description,
  - public title/copy,
  - audience: rider, driver, both,
  - route scope: global or origin/destination pair,
  - reward type: rider credit, coupon, driver bonus, referral reward, route challenge,
  - reward amount and currency,
  - funding mode: service-fee-only or subsidy-allowed,
  - max reward per user,
  - max campaign budget,
  - max redemptions,
  - start/end date,
  - eligibility rule,
  - completion rule,
  - fraud/dispute hold rules,
  - active/inactive toggle.
- Offer detail view:
  - total issued,
  - total redeemed,
  - earned but unpaid driver bonuses,
  - rider credit liability,
  - Deliivo subsidy liability,
  - estimated Stripe platform balance needed,
  - recent qualifying bookings/rides,
  - admin audit log.
- User detail integration:
  - rider credit balance and history,
  - driver bonus balance and payout status,
  - offer eligibility and redemption history.
- Booking and ride detail integration:
  - applied credit,
  - service fee waived,
  - Deliivo subsidy amount,
  - offer campaign source,
  - driver bonus linkage.
- Payout admin integration:
  - bonus payout items,
  - payout batches including ride fare and bonus totals,
  - `PENDING_FUNDS` or failed transfer reason if Stripe platform balance is insufficient.
- Controls:
  - pause offer,
  - expire offer,
  - manually grant rider credit,
  - manually grant driver bonus,
  - void/reverse unredeemed credit,
  - block user from offers,
  - retry failed payout after funding.

## Money Flow Requirements

### Rider Credit With Service Fee Waiver Only

Example:

- Driver fare: EUR 16.
- Service fee: EUR 3.
- Rider credit used: EUR 3.
- Rider charged: EUR 16.
- Driver payable: EUR 16.
- Deliivo service fee revenue: EUR 0.
- Deliivo subsidy: EUR 0.

### Rider Credit With Subsidy

Example:

- Driver fare: EUR 16.
- Service fee: EUR 3.
- Rider credit used: EUR 5.
- Rider charged: EUR 14.
- Driver payable: EUR 16.
- Deliivo service fee waived: EUR 3.
- Deliivo subsidy liability: EUR 2.

The booking/payment records must preserve:

- `driverFareAmount`
- `serviceFeeAmount`
- `riderCreditUsed`
- `amountChargedToRider`
- `serviceFeeWaivedAmount`
- `deliivoSubsidyAmount`
- `driverReceivableAmount`
- offer/campaign identifiers

### Driver Bonus

Example:

- Driver ride fare payable: EUR 16.
- Driver bonus: EUR 5.
- Driver payout batch transfer total: EUR 21.

Driver bonus is a payout item funded by Deliivo's platform balance. It is not charged to riders and is not part of the public ride fare.

## Payout Requirements

- Payout processor must include eligible driver bonuses in payout batches.
- Payout processor must calculate total transfer amount:
  - eligible ride fare,
  - plus eligible driver bonuses,
  - minus any approved adjustments or reversals.
- If Stripe platform balance is insufficient, payout must not be marked completed.
- Failed or unfunded payouts must remain retryable.
- Admin must see funding shortfall before retrying.

## Non-Functional Requirements

- All reward issuance, redemption, expiry, payout, and reversal records must be auditable.
- Reward calculations must be idempotent.
- Checkout must be deterministic and must not double-apply credits.
- Driver fare must not be reduced by rider credit.
- Expired, refunded, cancelled, disputed, or manually blocked rewards must not be paid.
- Admin financial screens must not expose Stripe secrets or full card data.
- Offer rules should be versioned or snapshotted so historical bookings remain explainable after offer edits.

## Success Metrics

- Route-specific published ride count.
- Route-specific completed booking count.
- Offer conversion rate.
- Credit redemption rate.
- Driver bonus completion rate.
- Cost per completed booking.
- Cost per completed driver ride.
- Total rider credit liability.
- Total driver bonus liability.
- Total Deliivo subsidy liability.
- Failed payout count due to insufficient funds.
- Fraud/reversal rate.

## Launch Phases

### Phase 1: Admin-Managed Offers And Manual Rewards

- Create offer model and admin pages.
- Display offers to users.
- Track eligibility manually or via simple queries.
- Admin grants rider credits or driver bonuses after review.
- Payout processor can include manually granted driver bonuses.

### Phase 2: Automatic Eligibility

- Automatically evaluate first booking, first driver ride, route challenge, and referral rules.
- Automatically issue rider credits and driver bonuses after qualifying completion.
- Add anti-abuse and dispute hold checks.

### Phase 3: Automatic Checkout Redemption

- Apply eligible rider credit during price preview and booking checkout.
- Store subsidy and service-fee-waiver amounts on booking/payment ledger records.
- Show credit usage in rider booking and admin payment screens.

### Phase 4: Budget And Funding Controls

- Add campaign budgets and spend caps.
- Add Stripe platform balance checks before payout batch execution.
- Add `PENDING_FUNDS` payout status and admin retry flow.

## Code References

- `src/modules/ride-booking`
- `src/modules/payments`
- `src/modules/payout`
- `src/modules/ledger`
- `src/modules/reconciliation`
- `src/modules/admin`
- `src/modules/pricing`
- `prisma/schema.prisma`
- `deliivo-webapp/src/app/rides/[id]/page.tsx`
- `deliivo-webapp/src/app/profile/earnings`
- `deliivo-webapp/src/app/admin`

## Open Questions

- What is the first launch campaign budget?
- Should rider credits be global by default or route-specific by default?
- Should subsidies beyond service fee require admin approval in phase 1?
- What is the maximum rider credit per booking?
- What is the maximum driver bonus per campaign and per driver?
- Should bonuses be withheld for a longer period than normal ride fare?
- Which Stripe top-up or balance-funding options are available for Deliivo's Stripe account region and status?

