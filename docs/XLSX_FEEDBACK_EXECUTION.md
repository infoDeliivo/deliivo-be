# XLSX Feedback Execution

Source catalogue: `docs/XLSX_FEEDBACK_CATALOG.md`

Person-wise status: `docs/XLSX_FEEDBACK_PERSON_WISE.md`

Status key:

- `Done`: verified in current code or fixed and compiled
- `Partial`: some requested behavior exists, but the full request is not complete
- `Missing`: confirmed absent from current code
- `Runtime`: requires deployed/manual reproduction
- `Decision`: product choice required before implementation
- `Rejected`: conflicts with an existing product decision or lacks supporting product capability/data

Last updated: 2026-07-03

## Batch 1 - Implemented

- `Done` `SRCH-03`: seat selection remains a simple selector and supports 1-10 seats per the approved product decision.
- `Done` `SRCH-09`: same-day search results exclude rides after their scheduled departure time; past dates are blocked in the UI and validator.
- `Done` search seat integrity: `seatsRequired` is enforced against ride availability and included in cache identity with the other result-changing filters.
- `Done` `AUTH-10`: DOB is persisted by onboarding/profile services, returned by the full-profile endpoint, and rehydrated into the profile date input.
- `Done` `VEH-04` code path: vehicle uploads validate image type/size and document type; supporting licence/insurance documents can no longer become the public vehicle image. Production now reports missing object-storage configuration instead of saving an unusable localhost URL. Deployed storage credentials still require runtime verification.
- `Done` `PUB-05`, `PUB-06`, `PUB-17`, `PUB-20`, `PUB-23`, `PUB-24`, `PUB-25`: meeting-point actions provide success/errors, Back preserves wizard state, rider notes and per-passenger luggage are explicit, successful publication navigates to published rides, one stepper remains, and route selection uses a desktop field/map split with a mobile stack.
- `Done` `SRCH-02`, `SRCH-10`, `SRCH-11`: search controls share labels/heights, result summaries include route/date/seats, time-of-day/price/sort/women-only filters are available, and cards show real verification, rating, route, vehicle, seat, duration, and EUR fare data.

- `Done` `AUTH-03`: email identifiers are normalized and existing mixed-case records are queried case-insensitively across signup, OTP, verification, resend, and login.
- `Done` `AUTH-07`: onboarding action now says `Complete` rather than `Complete Setup` in all supported dictionaries.
- `Done` `AUTH-11`: onboarding and profile updates reject numeric-only names while supporting Unicode letters, spaces, apostrophes, periods, and hyphens.
- `Done` `AUTH-12`: authenticated users are redirected away from sign-in/sign-up, including browser back navigation, while preserving a safe return target.
- `Done` `PUB-02`: an explicit publish-to-vehicle detour preserves the wizard step/state in memory and returns after vehicle save. It does not restore stale browser drafts after refresh.
- `Done` `PUB-03`, `PUB-04`: pickup and drop-off add controls are positioned after selected points.
- `Done` `PUB-07`: expired route caches are recomputed and a publishable route is reselected without restarting the wizard.
- `Done` `PUB-24` (stepper portion): duplicate publish progress UI removed; one stepper remains.
- `Done` `BRAND-01`, `FOOT-01`, `FOOT-02`, `FOOT-03`: configured official social URLs, accessible social icons, improved footer link deduplication, and expanded organization `sameAs` data.
- `Done` `NAV-01` (guest visibility portion): account-only Your Rides, Notifications, and Messages links are hidden from guests.
- `Done` `SRCH-01` (publish points): autocomplete is strictly radius-biased around origin, destination, or selected stopover; existing post-selection distance validation remains.
- `Done` `PERF-01`, `PERF-02`: notification loads are deduplicated, socket payloads update state without immediate refetch, fallback polling is reduced to 60 seconds, visibility refreshes run only when visible, and `/users/me` resume refreshes are deduplicated/throttled.

## Previously Verified In Current Code

- `Done` `SRCH-04`, `SRCH-05`, `SRCH-06`: clear From/To labels, closed autocomplete after selection, and public guest search/listing support exist.
- `Done` `AUTH-04`, `AUTH-05`, `AUTH-06`, `AUTH-08`, `AUTH-13`, `AUTH-14`: phone country code, filled onboarding layout/logo, required DOB copy, gender-gated women-only controls, and welcome-name copy exist.
- `Done` `PUB-10` through `PUB-16`, `PUB-18`, `PUB-21`, `PUB-22`: route-aware points, all minute values, Select wording, child/alcohol preferences, per-seat EUR copy, payout readiness, and three-hour cancellation behavior/copy exist.
- `Done` `BLOG-07` through `BLOG-09`, `SEO-01` through `SEO-04`: article header/detail/image/author handling and Article/Breadcrumb/FAQ/Organization schema plumbing exist.
- `Done` `LOC-03`: rider-facing driver profile renders ratings and normalized preference labels through translations.

## Existing Product Decisions Applied

- `Rejected` `AUTH-09` as written: keep the explicitly agreed minimum booking age of 8, not the workbook's proposed 18.
- `Rejected` optional DOB portion of `AUTH-08`: DOB remains required because age eligibility is enforced.
- `Rejected` `PUB-08`: stopovers remain optional.
- `Rejected` `PUB-09`: keep bounded pickup/drop-off selections and one position per selected stopover as previously agreed.
- `Done` `SRCH-07`: guests may view ride details; authentication is required when booking.
- `Done` `SRCH-08`: guest alerts remain removed/hidden as previously agreed.
- `Rejected` `FOOT-05`: profile social section remains removed; official links are in the footer.
- `Rejected` `NOTIF-01` through `NOTIF-05` where they require the heavy screenshot design: retain the previously requested simple notification list/card and refresh treatment. Functional notification state/actions are audited separately.
- `Rejected` `HOME-10`: do not display mock driver counts, ratings, completion rates, cities, or response-time claims without production-backed data.
- `Rejected` `TECH-01` through `TECH-05` as mandatory rewrites: solve measured problems inside the current stack; introduce a library only with a concrete engineering case.

## Decisions Still Needed

- `Rejected` `HOME-11`, `FOOT-04` app-store portions: no mobile apps exist yet, so app badges and download links are intentionally omitted.
- `Done` `HOME-03` through `HOME-09`, `NAV-01`: implemented the approved Iti homepage direction with integrated search, Baltic artwork, reordered trust content, concise steps, route cards, and dual CTA.
- `Done` `HOME-07`: product confirmed 24/7 support and the implemented support/tracking/payment claims; unsupported percentage-saving claims remain omitted.
- `Done` `BLOG-03`, `BLOG-10` through `BLOG-12`: category counts, popular posts, topic suggestion, and newsletter subscription were implemented as approved.
- `Done` `THEME-01`: public pages retain the orange brand while using the approved restrained neutral background treatment.

## Next Audit Batch

- Complete status mapping for every remaining catalogue ID.
- Verify search time filtering, guest ride-detail auth boundary, DOB persistence, vehicle upload, public profile data, and notification cleanup with focused tests/runtime checks.
- Implement remaining confirmed defects that do not depend on the decisions above.
