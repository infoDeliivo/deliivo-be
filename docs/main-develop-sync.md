# Main/develop integration and release gates

## Status

Integration branch: `integration/sync-main-develop-flags` in both repositories.
This combines production and staging code without changing deployed environment variables.
Do not promote the integration to production until the release gates below are satisfied.

## Rewards rollout

| Environment | Backend | Frontend build |
| --- | --- | --- |
| Staging | `REWARDS_ENABLED=true` | `NEXT_PUBLIC_REWARDS_ENABLED=true` |
| Production | `REWARDS_ENABLED=false` | `NEXT_PUBLIC_REWARDS_ENABLED=false` |

Only the literal `true` enables rewards. Missing or invalid values fail closed.
The backend flag is authoritative: disabled rewards endpoints return 404 with
`FEATURE_DISABLED`, and direct service calls cannot create campaigns, grant or
reverse rewards, attach referrals, or generate referral codes. Automatic ride and
booking completion awards become no-ops. No reward records are deleted.

The frontend hides wallet/campaign links, balances and admin grants, stops rewards
fetches on ordinary profile/admin pages, and blocks direct reward page visits.
Normal earnings, payments and payouts remain available. Frontend public flags are
fixed at build time: rebuild for the target environment rather than promoting a
staging frontend artifact unchanged. Backend environment changes require restart
or redeployment according to the hosting setup.

No independent coupon/discount implementation was found on the compared branches.
The existing incentive/referral campaigns are covered by the rewards flag. Do not
claim a separate discounts flag until that feature has been identified and gated.

Existing ride-request, chat, authentication and hard-delete flags remain separate.
Keep production OTP debugging disabled and confirm auth responses never expose OTPs.

## Integration decisions

- Preserve production homepage, vehicle document recovery, three-vehicle limit,
  rider ride requests, and the new publish meeting-points screen.
- Preserve staging's payment-confirmation seat reservation and refund accounting.
  Request offers now link the booking and payment in the checkout transaction;
  request expiry uses the idempotent reservation-aware seat release helper.
- Request quotes and recovered payment rows use the same service-fee snapshot as
  normal bookings instead of recomputing fees from a mutable environment value.
- Keep both vehicle-document audit and unpaid-booking sweep maintenance jobs.
- Complete the missing reward settlement table/index migration without deleting
  existing records. Rewards disabled does not mean migrations can be skipped.

## Release gates

1. Decide whether production should adopt staging's pricing model. In particular,
   `20260911190000_service_fee_twenty_percent` updates every active PricingConfig
   rate to 20 percent. The rewards flag does NOT suppress this migration. Do not
   rewrite an already-applied migration or deploy it before this decision.
2. Rehearse the combined migration history on an isolated production-like database
   with a backup, including existing reward tables, active bookings, payment
   snapshots and the active-booking unique index. Check for conflicting existing
   rows before adding the index. No production database migration is authorized
   merely by running a build or enabling a flag.
3. Run backend tests plus frontend rewards-on/off builds and browser checks. Test
   mismatched flags: backend-off must reject old clients without breaking normal
   signup, profiles, ride completion or payments.
4. Deploy to staging first with the flags above. Smoke-test signup, ordinary and
   requested rides, payments, cancellation/refunds, documents, admin user deletion,
   and rewards. Unit/browser mocks are not live Stripe or database validation.
5. Promote the reviewed commits to main with production rewards flags off, then
   sync the release back to develop without force-pushing or resetting history.

Do not automatically roll back financial/schema migrations after traffic has
used the new model. Disable rewards as the feature rollback; separately review
application/database rollback compatibility for the wider branch integration.

## Automated checks

- `src/modules/rewards/rewards.feature.test.ts`: default-off service behavior and no side effects.
- `src/modules/rewards/rewards.routes.test.ts`: disabled endpoints and unchanged user API.
- Existing booking, request, webhook, capacity and payment tests cover merge-sensitive behavior.
- Frontend `scripts/check-rewards-flags.cjs`: direct URLs, navigation and API calls.
- Frontend `scripts/check-publish-stops.cjs` and `scripts/check-driver-offer.cjs`: preserved publishing flows.

## Local verification (2026-10-03)

- Backend Prisma generation and TypeScript build passed.
- Selected backend regression run: 24 suites, 358 tests passed.
- Frontend production builds passed with rewards both disabled and enabled.
- Mocked browser checks passed for rewards off/on, publish meeting points, and
  driver offers. External network requests were blocked in these browser checks.
- Database migrations, deployed staging smoke tests and live payment flows have
  not been run. These remain release gates, not implied by the passing checks.
