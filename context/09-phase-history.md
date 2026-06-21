# Phase History

This document records implementation phases in chronological order. PRDs and ADRs describe target behavior and decisions; this history records what changed during each implementation slice.

## 2026-06-21 - Batch 1 Remaining Phase Fixes

Scope:

- Corrected supported web language preferences to English, Estonian, and Russian.
- Added admin emergency SOS list endpoint with pagination and status filtering.
- Added admin emergency SOS status updates for acknowledge, resolve, and false alarm.
- Added admin SOS page with ride/booking links, user contact context, GPS evidence, and lifecycle actions.
- Added SOS to the admin sidebar.

Code areas:

- `src/modules/admin/admin.service.ts`
- `src/modules/admin/admin.controller.ts`
- `src/modules/admin/admin.routes.ts`
- `web/src/lib/api.ts`
- `web/src/lib/i18n.ts`
- `web/src/app/admin/sos/page.tsx`
- `web/src/app/admin/_components/AdminSidebar.tsx`
- `web/src/app/admin/content/page.tsx`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/05-open-questions-and-risks.md`
- `context/08-feature-decisions-bottlenecks.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web production build passed.

## 2026-06-21 - Public Localization Catalogs

Scope:

- Added an app-wide i18n provider and translation hook.
- Added English, Estonian, and Russian translation dictionaries.
- Connected the language switcher to live locale updates.
- Localized shared/public surfaces: navbar, footer, landing page, landing search form, FAQ, contact, blog landing, terms summary, and privacy summary.
- Added Cyrillic font subset for Russian rendering.
- Documented that authenticated rider, driver, payment, payout, and admin operation screens still need page-by-page migration.

Code areas:

- `web/src/lib/i18n.ts`
- `web/src/lib/i18n-context.tsx`
- `web/src/lib/i18n-dictionaries.ts`
- `web/src/app/providers.tsx`
- `web/src/app/layout.tsx`
- `web/src/components/LanguageSwitcher.tsx`
- `web/src/components/Navbar.tsx`
- `web/src/components/Footer.tsx`
- `web/src/components/SearchForm.tsx`
- `web/src/app/page.tsx`
- `web/src/app/faq/page.tsx`
- `web/src/app/contact/page.tsx`
- `web/src/app/blog/page.tsx`
- `web/src/app/terms/page.tsx`
- `web/src/app/privacy/page.tsx`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Rider Search And Rides List Localization

Scope:

- Added translation keys for search filters, search results, ride cards, status chips, and ride list empty states.
- Localized shared ride card badges and seat/price labels.
- Localized search filter panel and mobile drawer labels.
- Localized search results page controls, empty states, alert creation prompt, and sort/filter labels.
- Localized `/rides` booked/published tabs, status filters, pagination labels, booking cards, published ride cards, and empty states.

Code areas:

- `web/src/lib/i18n-dictionaries.ts`
- `web/src/components/RideCard.tsx`
- `web/src/components/SearchFilters.tsx`
- `web/src/app/search/page.tsx`
- `web/src/app/rides/page.tsx`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Profile Image Storage With R2 Support

Scope:

- Kept profile image uploads on the existing authenticated `POST /api/v1/users/me/avatar` endpoint.
- Fixed the web upload field name to match the backend multipart middleware.
- Added `User.avatarKey` so the database stores both public image URL and provider object key.
- Added Cloudflare R2-compatible S3 client support while preserving AWS S3 and local development fallback.
- Added R2 environment variables to Docker Compose and `.env.example`.
- Updated profile image storage documentation with Cloudflare setup steps.

Code areas:

- `prisma/schema.prisma`
- `prisma/migrations/20260621100000_add_user_avatar_key/migration.sql`
- `src/config/s3.config.ts`
- `src/services/s3.service.ts`
- `src/modules/user/user.controller.ts`
- `src/modules/user/user.service.ts`
- `web/src/lib/api.ts`
- `.env.example`
- `docker-compose.yml`

Documentation updated:

- `docs/architecture/profile-image-storage-r2-parked.md`
- `context/09-phase-history.md`

Verification:

- Prisma client generated with a local dummy `DATABASE_URL`.
- Backend TypeScript check passed.
- Web production build passed.

## 2026-06-20 - Web Chat Disabled And Emergency SOS First Slice

Scope:

- Parked profile image storage as a Cloudflare R2 design decision for later implementation.
- Disabled web portal chat surfaces by default with `NEXT_PUBLIC_ENABLE_WEB_CHAT=false` while keeping backend chat available for future clients.
- Added an emergency SOS domain model and migration.
- Added authenticated `POST /api/v1/safety/sos` for riders and drivers tied to a ride or booking.
- Added rider and driver ride-detail SOS buttons that capture optional user message and browser GPS evidence.
- SOS alerts persist in the database and notify admins through the existing notification service.

Code areas:

- `prisma/schema.prisma`
- `prisma/migrations/20260620153000_add_emergency_alerts/migration.sql`
- `src/modules/safety`
- `src/app.ts`
- `web/src/components/EmergencySosButton.tsx`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`
- `web/src/app/chat`
- `web/src/components/Navbar.tsx`

Documentation updated:

- `docs/architecture/profile-image-storage-r2-parked.md`
- `docs/architecture/emergency-sos-design.md`
- `context/02-domain-model.md`
- `context/features/disputes-safety-ratings/prd.md`
- `context/features/communications-notifications/prd.md`
- `context/09-phase-history.md`

Verification:

- Prisma client generated with a local dummy `DATABASE_URL`.
- Backend TypeScript check passed.
- Web production build passed.

## 2026-06-19 - Live Tracking Link Handoff

Scope:

- Removed embedded map dependency from rider ride details and driver manage ride screens.
- Kept location updates and public tracking links as the primary live tracking surface.
- Added ride-start link delivery to persisted notification payloads, email, and SMS.
- Added notification panel support for opening `liveTrackingUrl` when present.

Code areas:

- `src/modules/ride-operations/ride-operations.service.ts`
- `src/modules/tracking/tracking.service.ts`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`
- `web/src/components/NotificationPanel.tsx`

Documentation updated:

- `context/features/ride-operations-live-tracking/prd.md`
- `context/features/ride-operations-live-tracking/adr.md`
- `context/03-system-architecture.md`
- `context/08-feature-decisions-bottlenecks.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Rider And Driver Live Tracking UX

Scope:

- Added explicit open/copy/create live tracking actions to the rider live status panel.
- Added driver manage-ride messaging that confirmed riders receive live tracking links when the ride starts.
- Kept the live tracking UX map-light on authenticated ride detail pages.

Code areas:

- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`

Documentation updated:

- `context/features/ride-operations-live-tracking/prd.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Ongoing Ride Sticky Panel

Scope:

- Added a global authenticated sticky panel for active rides and next-24-hour rides.
- Rider panel links to ride details.
- Driver panel links to manage ride.
- Panel refreshes from canonical APIs and listens to booking, ride, notification, and browser focus events.
- Hidden from auth, onboarding, admin, and public tracking routes.

Code areas:

- `web/src/components/OngoingRidePanel.tsx`
- `web/src/app/providers.tsx`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/features/ride-operations-live-tracking/prd.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Ride Preference Flags And User Gender

Scope:

- Added structured ride preference flags for no smoking, no bicycles, and child-seat availability.
- Kept legacy `backSeatOnly` in storage for compatibility but removed it from the publish UI.
- Added a dedicated `User.gender` database field and migration.
- Made onboarding gender explicit and required in the web flow.
- Moved women-only publishing, search visibility, and booking enforcement from salutation checks to `User.gender === FEMALE`.
- Surfaced preference chips in publish review, search results, and ride details.

Code areas:

- `prisma/schema.prisma`
- `prisma/migrations/20260619090000_add_ride_preference_flags/migration.sql`
- `prisma/migrations/20260619093000_add_user_gender/migration.sql`
- `src/modules/publish-ride`
- `src/modules/search-ride`
- `src/modules/ride-booking`
- `src/modules/user`
- `web/src/app/onboarding/page.tsx`
- `web/src/app/profile/page.tsx`
- `web/src/app/publish/page.tsx`
- `web/src/app/search/page.tsx`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/components/RideCard.tsx`
- `web/src/lib/api.ts`

Documentation updated:

- `context/features/auth-profile-trust/prd.md`
- `context/features/ride-publishing-search-booking/prd.md`
- `context/02-domain-model.md`
- `context/09-phase-history.md`

Verification:

- Prisma client generated with a local dummy `DATABASE_URL`.
- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Landing Search And Role Education

Scope:

- Added seat count to the landing search form and forwarded it to `/search`.
- Updated the search page to hydrate seat count from query parameters.
- Replaced the generic "How Deliivo works" content with separate rider and driver workflows.
- Kept the landing focused on Baltic city-to-city carpooling.

Code areas:

- `web/src/components/SearchForm.tsx`
- `web/src/app/search/page.tsx`
- `web/src/app/page.tsx`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Public Legal And Support Pages

Scope:

- Added public Terms of Service, Privacy Policy, Contact, and FAQ pages.
- Added a shared public contact config for contact, support, legal, and privacy emails.
- Documented `NEXT_PUBLIC_*` contact email environment variables.
- Wired contact email build args through the web Dockerfile and Docker Compose.
- Updated footer support links to resolve to public support/legal pages.

Code areas:

- `web/src/app/terms/page.tsx`
- `web/src/app/privacy/page.tsx`
- `web/src/app/contact/page.tsx`
- `web/src/app/faq/page.tsx`
- `web/src/lib/public-config.ts`
- `web/src/components/Footer.tsx`
- `web/Dockerfile`
- `docker-compose.yml`
- `.env.example`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Error Resilience And Driver Action Feedback

Scope:

- Added a global app feedback event/toast layer for success, error, and info messages.
- Normalized network fetch failures into readable API errors instead of silent failures or raw browser errors.
- Added success and failure feedback to critical driver manage-ride actions.
- Kept inline manage-ride error state while adding transient feedback so users see immediate action results.

Code areas:

- `web/src/lib/api.ts`
- `web/src/lib/app-feedback.ts`
- `web/src/components/AppFeedbackToast.tsx`
- `web/src/app/providers.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Ride Lists Pagination And Grouped Status Filters

Scope:

- Added comma-separated grouped status support to booked ride and published ride list endpoints.
- Updated web API helpers to send grouped status filters for rider and driver ride lists.
- Updated `/rides` to use backend pagination metadata instead of only filtering the first loaded page.
- Added Previous/Next page controls for booked and published ride lists.
- Kept filtered empty states explicit so users can distinguish no history from no records in the selected view.

Code areas:

- `src/modules/ride-booking/ride-booking.validator.ts`
- `src/modules/ride-booking/ride-booking.types.ts`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/publish-ride/publish-ride.validator.ts`
- `src/modules/publish-ride/publish-ride.types.ts`
- `src/modules/publish-ride/publish-ride.service.ts`
- `web/src/lib/api.ts`
- `web/src/app/rides/page.tsx`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/features/ride-publishing-search-booking/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Rider Action Feedback And Ride Detail Resilience

Scope:

- Added shared success and error toasts to rider ride-detail actions.
- Normalized rider ride-detail errors through the shared API error helper.
- Added feedback for booking creation, payment confirmation retry, request cancellation, confirmed booking cancellation, pickup arrival, missed pickup report, drop-off confirmation, live tracking link creation/copy, dispute creation, rating submission, and inline card save.
- Preserved existing inline messages while adding global feedback so users get immediate confirmation even when page refresh/refetch is delayed.

Code areas:

- `web/src/app/rides/[id]/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/app-feedback.ts`
- `web/src/components/AppFeedbackToast.tsx`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/features/ride-publishing-search-booking/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Admin Ride Operations Usability

Scope:

- Improved the admin ride history page around the existing backend search capability.
- Added clearer search copy explaining support for ride, booking, driver, rider, contact, and route searches.
- Added copyable ride, driver, booking, and rider IDs for support and log correlation.
- Added direct links from ride rows to ride details and from driver/rider records to public profile views.
- Added toast feedback for copied IDs and refund action outcomes.

Code areas:

- `web/src/app/admin/rides/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/app-feedback.ts`
- `web/src/components/AppFeedbackToast.tsx`

Documentation updated:

- `context/features/admin-operations/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Admin Dispute To Ride Cross-Navigation

Scope:

- Made admin ride history hydrate `search`, `searchBy`, `status`, and `page` from URL query parameters.
- Fixed dispute lifecycle ride links to open the admin ride history with the related ride pre-filtered.
- Updated dispute table ride links to use the admin-operable ride history path instead of role-restricted ride details.
- Added normalized admin dispute action errors and toast feedback for evidence collection, evaluation, resolution, and lifecycle load failures.
- Kept dispute evidence checklist behavior intact while improving navigation around it.

Code areas:

- `web/src/app/admin/rides/page.tsx`
- `web/src/app/admin/reports/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/app-feedback.ts`
- `web/src/components/AppFeedbackToast.tsx`

Documentation updated:

- `context/features/admin-operations/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.
- Web production build passed after local disk space was freed.

## 2026-06-19 - Payment And Earnings Action Feedback

Scope:

- Added normalized API error handling and toast feedback to rider saved-card actions.
- Added success feedback for saving, removing, and setting default cards.
- Added visible failure feedback when saved cards or payment history cannot load.
- Added normalized API error handling and toast feedback to driver earnings and payout actions.
- Added success feedback for payout requests while keeping the earnings page focused on total, pending, paid, and pending/paid item tabs.

Code areas:

- `web/src/app/profile/payment-methods/page.tsx`
- `web/src/app/profile/earnings/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/app-feedback.ts`
- `web/src/components/AppFeedbackToast.tsx`

Documentation updated:

- `context/features/payments-payouts-reconciliation/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.

## 2026-06-19 - Profile Hub Layout And Feedback

Scope:

- Widened the profile page from a narrow account column into a desktop-friendly account hub.
- Kept the profile summary sticky on desktop and preserved mobile stacking.
- Removed the dead `Documents` shortcut and added a direct `My rides` shortcut.
- Kept rating, successful driven rides, and successful ridden rides visible in the profile banner.
- Added success/failure feedback for avatar upload, profile save, and travel preference save actions.
- Split activity and help sections into two columns on wide screens to reduce vertical clutter.

Code areas:

- `web/src/app/profile/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/app-feedback.ts`
- `web/src/components/AppFeedbackToast.tsx`

Documentation updated:

- `context/features/auth-profile-trust/prd.md`
- `context/features/web-portal/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.
- Web production build passed.

## 2026-06-19 - Search Result Trust Signals

Scope:

- Added clearer driver trust chips to search result cards.
- Surfaced successful driver ride count and successful rider ride count before the rider opens or books a ride.
- Added a visible `View profile` link from each search result card to the driver's public profile.
- Kept the existing driver avatar and name profile links.

Code areas:

- `web/src/app/search/page.tsx`

Documentation updated:

- `context/features/ride-publishing-search-booking/prd.md`
- `context/features/auth-profile-trust/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.
- Web production build passed.

## 2026-06-19 - Batch 1 Remaining Feedback Fixes

Scope:

- Fixed rider ride-detail booking lookup to search all valid booking lifecycle statuses instead of only the default first booking page.
- Added clearer booking price breakdown display for price per seat, subtotal, fees, and total before and after booking.
- Added a driver-side guard for accepting a booking request that has already moved out of pending state.
- Widened the rider payment methods and history page and kept cards above transaction history.
- Widened the driver earnings page and added payout-eligible pending amount copy while keeping pending/paid tabs.

Code areas:

- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`
- `web/src/app/profile/payment-methods/page.tsx`
- `web/src/app/profile/earnings/page.tsx`
- `web/src/lib/api.ts`

Documentation updated:

- `context/features/ride-publishing-search-booking/prd.md`
- `context/features/payments-payouts-reconciliation/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.
- Web production build passed.

## 2026-06-19 - Batch 2 Admin Support And Dispute Operations

Scope:

- Added route-text search scope to admin ride history and backend admin ride search.
- Kept admin ride history navigation inside admin-operable URLs instead of role-restricted rider/driver ride detail pages.
- Added explicit confirmation copy before admin force-refund support overrides.
- Improved admin revenue ledger with copyable booking, payment, and user IDs plus booking-to-ride-history navigation.
- Added success/failure feedback for reconciliation runs and reconciliation issue resolution.
- Expanded admin dispute lifecycle evidence with ride event rows and GPS/no-GPS indicators.

Code areas:

- `src/modules/admin/admin.service.ts`
- `web/src/app/admin/rides/page.tsx`
- `web/src/app/admin/revenue/page.tsx`
- `web/src/app/admin/reports/page.tsx`

Documentation updated:

- `context/features/admin-operations/prd.md`
- `context/features/disputes-safety-ratings/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.
- Web production build passed.

## 2026-06-19 - Batch 3 Production Foundations

Scope:

- Made in-app notification toasts clickable and route-aware for rider and driver ride links.
- Added focus, visibility, and one-minute persisted notification refresh to the notification panel so missed socket events reconcile from the durable store.
- Added production readiness checklist covering environment, Stripe, notifications, operations, and deployment verification.
- Added KPI, SLA, and monitoring document for marketplace, payments, notifications, ride-day operations, disputes, and admin overrides.
- Documented browser push as optional Firebase-backed web behavior while persisted notifications remain the required baseline.
- Documented Stripe test/live separation and added `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to `.env.example`.

Code areas:

- `web/src/components/NotificationToast.tsx`
- `web/src/components/NotificationPanel.tsx`
- `.env.example`

Documentation updated:

- `context/README.md`
- `context/05-open-questions-and-risks.md`
- `context/08-feature-decisions-bottlenecks.md`
- `context/10-production-readiness.md`
- `context/11-kpis-slas-monitoring.md`
- `context/features/communications-notifications/prd.md`
- `context/features/communications-notifications/adr.md`
- `context/features/payments-payouts-reconciliation/prd.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web TypeScript check passed.
- Web production build passed.

## 2026-06-19 - Batch 4 Localization And Content Foundations

Scope:

- Added a language preference foundation for English, Estonian, and Russian.
- Added a public guide/blog page with seeded Baltic rider, driver, and safety content.
- Added an admin content operations page to review guide content and language readiness.
- Wired guide links into top navigation and footer support areas.
- Added admin sidebar navigation for content operations and tightened admin shell spacing on smaller screens.
- Documented that full translation catalogs and persistent CMS editing are still separate backend/product work.

Code areas:

- `web/src/lib/i18n.ts`
- `web/src/components/LanguageSwitcher.tsx`
- `web/src/lib/blog-content.ts`
- `web/src/app/blog/page.tsx`
- `web/src/app/admin/content/page.tsx`
- `web/src/components/Navbar.tsx`
- `web/src/components/Footer.tsx`
- `web/src/app/admin/_components/AdminSidebar.tsx`
- `web/src/app/admin/layout.tsx`
- `.env.example`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/05-open-questions-and-risks.md`
- `context/08-feature-decisions-bottlenecks.md`
- `context/09-phase-history.md`

Verification:

- Backend TypeScript check passed.
- Web production build passed.

## 2026-06-20 - Ride Detail UX Collision Fix

Scope:

- Moved the ongoing ride sticky panel away from bottom action collisions by using a desktop top-right placement and a safer compact mobile bottom offset.
- Promoted driver pickup OTP verification near the top of the manage-ride page.
- Promoted rider pickup OTP display near the top of the rider booking panel.
- Removed authenticated ride-detail live-location cards while preserving background location updates and live sharing links.
- Kept driver live sharing as a lower-page reminder instead of a primary live-location card.

Code areas:

- `web/src/components/OngoingRidePanel.tsx`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`

Documentation updated:

- `context/features/web-portal/prd.md`
- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Ride Detail And Manage Ride Localization

Scope:

- Localized the main rider ride-detail screen across route details, booking, payment card selection, price breakdown, legal consent, pickup OTP, pickup evidence, live sharing, cancellation, dispute reporting, rating, and own-ride guidance.
- Localized the driver manage-ride screen across ride summary, request counts, OTP verification, start/finish/cancel actions, pending requests, passenger actions, dev simulation controls, live sharing, and reject-request dialog.
- Added English and Estonian dictionary coverage for the new ride-detail and manage-ride keys.
- Left Russian ride-detail/manage-ride keys to English fallback for now because the existing Russian catalog section is stored with inconsistent mojibake encoding and should be normalized in a dedicated pass.

Code areas:

- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`
- `web/src/lib/i18n-dictionaries.ts`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Authenticated Localization Completion Pass

Scope:

- Localized the main profile/account page, including profile edit, gender selection, travel preferences, activity links, help links, profile statistics, avatar upload feedback, and preference/profile save feedback.
- Localized the admin dashboard entry page, platform KPI cards, admin sidebar navigation, and admin topbar labels.
- Added English and Estonian profile/admin dictionary coverage for the newly translated authenticated surfaces.
- Revalidated the existing locale fallback behavior: missing Russian keys fall back to English, so app behavior remains stable while the mojibake Russian catalog is normalized in a dedicated translation QA pass.

Code areas:

- `web/src/app/profile/page.tsx`
- `web/src/app/admin/page.tsx`
- `web/src/app/admin/_components/AdminSidebar.tsx`
- `web/src/app/admin/_components/AdminTopBar.tsx`
- `web/src/lib/i18n-dictionaries.ts`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Profile Finance And Support Localization Batch

Scope:

- Localized the payment methods page, including saved cards, default card handling, payment history, and Stripe setup guidance.
- Localized the driver earnings page with payout readiness, pending versus paid tabs, payout request actions, and earnings summaries.
- Localized the rider transactions page with payment, refund, and dispute summaries.
- Localized the vehicle page and its add/edit flow labels.
- Localized the rider disputes page, including create-dispute flow and status labels.
- Added English and Estonian dictionary coverage for the new profile finance, vehicle, and dispute UI text.

Code areas:

- `web/src/app/profile/payment-methods/page.tsx`
- `web/src/app/profile/earnings/page.tsx`
- `web/src/app/profile/transactions/page.tsx`
- `web/src/app/profile/vehicle/page.tsx`
- `web/src/app/profile/disputes/page.tsx`
- `web/src/lib/i18n-dictionaries.ts`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Admin Localization Rolled Back

Scope:

- Reverted admin dashboard, admin sidebar, and admin topbar labels back to hardcoded English per user preference.
- Kept the rest of the app localization work intact.

Code areas:

- `web/src/app/admin/page.tsx`
- `web/src/app/admin/_components/AdminSidebar.tsx`
- `web/src/app/admin/_components/AdminTopBar.tsx`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Pending rebuild after rollback.

## 2026-06-21 - Publish Flow Localization Completion

Scope:

- Localized the ride publish wizard, including route selection, stopovers, date/time, seat preferences, pricing, confirm/publish actions, and publish success state.
- Added publish-flow dictionary coverage for English and Estonian, with Russian continuing to fall back to English for any untranslated keys.
- Kept the main app localization work aligned with the current Baltic-first product copy and women-only / safety preference labels.

Code areas:

- `web/src/app/publish/page.tsx`
- `web/src/lib/i18n-dictionaries.ts`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Publish And Ride Detail Localization Fix Pass

Scope:

- Closed the remaining hardcoded strings on the publish flow that were still rendering in English during manual testing.
- Localized ride detail request-expiry options, payment and booking feedback messages, dispute and pickup/drop-off feedback, and localized date formatting instead of forcing `en-US`.
- Added the missing dictionary coverage required by those publish and ride-detail interactions.

Code areas:

- `web/src/app/publish/page.tsx`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/lib/i18n-dictionaries.ts`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Main App Backlog Batch: Search And Finance Surface

Scope:

- Upgraded the landing page search form to use place autocomplete so the hero search behaves like the main ride search flow instead of relying on blind free-text handoff.
- Consolidated rider finance navigation by turning `/profile/transactions` into a redirect to `/profile/payment-methods`, keeping cards and history on one surface.
- Added direct ride navigation from rider payment history and driver earnings items so users can move from money records back to the ride context.
- Kept completed rider bookings more useful by continuing to show live-sharing links after completion.
- Fixed the public profile metric card so only the rating metric renders a star icon.

Code areas:

- `web/src/components/SearchForm.tsx`
- `web/src/app/profile/payment-methods/page.tsx`
- `web/src/app/profile/transactions/page.tsx`
- `web/src/app/profile/earnings/page.tsx`
- `web/src/app/profile/users/[id]/page.tsx`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/lib/i18n-dictionaries.ts`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Notification Hardening And Client Sync

Scope:

- Centralized client-side notification state into a shared notification store instead of letting navbar, panel, and toast each maintain separate fetch and socket logic.
- Added deterministic notification refresh on socket reconnect, browser focus, page visibility return, and periodic background polling.
- Removed unread-count drift between the navbar badge and the notifications panel by sourcing both from the same shared store.
- Kept on-screen realtime notification toasts while avoiding duplicate per-component socket subscriptions.

Code areas:

- `web/src/lib/notification-store.ts`
- `web/src/components/NotificationPanel.tsx`
- `web/src/components/NotificationToast.tsx`
- `web/src/components/Navbar.tsx`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Batch Of Four: Content, Ops Diagnostics, Notifications, Reconciliation

Scope:

- Added a real file-backed blog/content store at `content/blog-posts.json` with backend public and admin APIs for listing, creating, editing, publishing, and deleting guide posts.
- Switched the public `/blog` page from static seeded data to the backend content API and upgraded `/admin/content` into an editable content operations screen.
- Added an admin operations summary endpoint covering database and Redis health, Stripe/Firebase configuration readiness, webhook volume, payout/reconciliation counts, and content summary.
- Upgraded the admin dashboard and admin settings page to show live operational diagnostics instead of placeholder settings inputs.
- Added notification sync metadata to the shared notification store and surfaced browser alert delivery status plus last-sync visibility in the notification UX.

Code areas:

- `content/blog-posts.json`
- `src/modules/content/*`
- `src/modules/admin/admin.service.ts`
- `src/modules/admin/admin.controller.ts`
- `src/modules/admin/admin.routes.ts`
- `src/modules/index.ts`
- `src/app.ts`
- `web/src/lib/api.ts`
- `web/src/lib/notification-store.ts`
- `web/src/components/NotificationPanel.tsx`
- `web/src/app/profile/notifications/page.tsx`
- `web/src/app/blog/page.tsx`
- `web/src/app/admin/content/page.tsx`
- `web/src/app/admin/page.tsx`
- `web/src/app/admin/settings/page.tsx`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.
- Backend TypeScript and Prisma build passed.

## 2026-06-21 - Batch Of Four: Resilience And Ride-Day Fallbacks

Scope:

- Added a global online/offline connectivity banner so users can distinguish backend delay from client-side connectivity loss and reconnect sync.
- Added browser-local publish wizard recovery so a driver can resume a partially prepared ride after refresh, crash, or tab close.
- Added rider and driver support/override cards on ride-day surfaces with copyable ride and booking identifiers for admin-assisted recovery.
- Added clearer support context messaging on the driver passenger section so escalation and override flows start with the right IDs.

Code areas:

- `web/src/components/ConnectivityBanner.tsx`
- `web/src/components/SupportOverrideCard.tsx`
- `web/src/app/providers.tsx`
- `web/src/app/publish/page.tsx`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`

Documentation updated:

- `context/09-phase-history.md`
- `context/10-production-readiness.md`

Verification:

- Web production build passed.

## 2026-06-21 - Next Phase: Admin Operations Recovery And Financial Workbench

Scope:

- Added a shared retryable load-failure card for operational screens instead of leaving hard failure states as static inline errors.
- Upgraded the admin dashboard with direct action cards for rides, revenue, and disputes plus SLA-style health signals and richer ops snapshots.
- Improved admin ride history with URL-synced filters and quick actions to clear filters or jump into disputes and revenue review.
- Fixed the admin revenue page so ledger pagination and reconciliation-issue pagination no longer fight over the same page state.
- Added reconciliation issue filters for issue type and severity plus booking/payment context links back into ride operations.

Code areas:

- `web/src/components/LoadFailureCard.tsx`
- `web/src/app/admin/page.tsx`
- `web/src/app/admin/rides/page.tsx`
- `web/src/app/admin/revenue/page.tsx`
- `web/src/lib/api.ts`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Next Phase: Main App Recovery Paths

Scope:

- Reused the shared load-failure card on main rider and driver account surfaces so API failures now provide an explicit retry path instead of a dead-end inline error.
- Improved `/rides` recovery UX with retryable load failure handling and quick reset actions when filtered booked or published lists return empty.
- Improved rider payment methods and transaction history with retryable failure handling plus clearer empty-state actions for adding a first card or refreshing history.
- Improved driver earnings with retryable load failure handling and a refresh path when pending or paid earnings tabs are empty.
- Improved the notifications panel so sync failures show a recoverable retry state instead of blending into the normal empty-state path.

Code areas:

- `web/src/components/LoadFailureCard.tsx`
- `web/src/app/rides/page.tsx`
- `web/src/app/profile/payment-methods/page.tsx`
- `web/src/app/profile/earnings/page.tsx`
- `web/src/components/NotificationPanel.tsx`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Next Phase: Notifications And Support Screen Reliability

Scope:

- Improved the full notifications page with explicit sync-failure recovery, last-sync visibility, unread count context, and a manual refresh action alongside browser-alert registration.
- Improved the rider disputes page with retryable load failure handling, support-contact guidance when records do not appear, and better empty-state actions for refresh or creating a new dispute.
- Improved the admin settings diagnostics page with a proper retryable failure state instead of only a toast on load failure.

Code areas:

- `web/src/app/profile/notifications/page.tsx`
- `web/src/app/profile/disputes/page.tsx`
- `web/src/app/admin/settings/page.tsx`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Next Phase: Admin Readiness Workbench

Scope:

- Reworked the admin settings page from a static diagnostics list into a release-readiness workbench.
- Added computed readiness items for runtime, Stripe, notifications, reconciliation backlog, and pending payment cleanup.
- Added blocker and watch-item summaries so operators can see whether the current environment is ready for serious testing.
- Added smoke-check shortcuts for rides, revenue, and disputes to guide manual validation of the critical paths.
- Added support override guardrails directly in the admin UI so operators follow the expected ride ID, booking ID, refund, and reconciliation workflow.
- Added explicit refresh of diagnostics without leaving the page.

Code areas:

- `web/src/app/admin/settings/page.tsx`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.

## 2026-06-21 - Next Phase: Admin Monitoring Workbench

Scope:

- Added an admin monitoring page that surfaces the first live KPI and SLA workbench from the documentation.
- Surfaced marketplace KPIs, operational SLA targets, structured logging requirements, and dashboard links from a single admin screen.
- Wired the monitoring page into the admin sidebar for direct access.
- Kept the page grounded in existing ops summary data so it reflects live runtime, Stripe, notification, and reconciliation readiness instead of placeholder charts.

Code areas:

- `web/src/app/admin/monitoring/page.tsx`
- `web/src/app/admin/_components/AdminSidebar.tsx`

Documentation updated:

- `context/09-phase-history.md`
- `context/11-kpis-slas-monitoring.md`

Verification:

- Web production build passed.

## 2026-06-21 - Next Phase: Deployment Readiness Endpoint

Scope:

- Added a backend `/health/ready` endpoint that checks database, Redis, auth secrets, Stripe, and Firebase readiness.
- Exposed the readiness contract to the web admin API so the UI can reflect deployment gate status.
- Extended the admin settings workbench with readiness endpoint status and individual readiness checks.
- Updated production readiness guidance so the readiness endpoint is part of the deployment gate.

Code areas:

- `src/app.ts`
- `web/src/lib/api.ts`
- `web/src/app/admin/settings/page.tsx`

Documentation updated:

- `context/09-phase-history.md`
- `context/10-production-readiness.md`

Verification:

- Pending web build after readiness patch.

## 2026-06-21 - Next Phase: Health Ready Gate

Scope:

- Added a backend `/health/ready` endpoint that checks core database, Redis, auth secret, Stripe, and Firebase readiness.
- Exposed the readiness gate through the admin API so the web app can show deployment status from the canonical backend signal.
- Extended the admin settings workbench with readiness endpoint status and per-dependency health checks.
- Fixed a duplicate API client method introduced during the readiness wiring.

Code areas:

- `src/app.ts`
- `web/src/lib/api.ts`
- `web/src/app/admin/settings/page.tsx`

Documentation updated:

- `context/09-phase-history.md`
- `context/10-production-readiness.md`

Verification:

- Backend build passed.
- Web production build passed.

## 2026-06-21 - Next Phase: Request Correlation Traceability

Scope:

- Added a request correlation middleware that assigns or preserves `x-request-id` for every HTTP request.
- Echoed the correlation ID back on API responses so support and product can trace a user-visible failure to a backend log entry.
- Updated the web API client to send `x-request-id` headers on every request and preserve the returned ID on client errors.
- Added request completion logging with method, path, status, duration, and user ID when available.
- Surfaced the trace correlation contract in the admin monitoring page so operators know how to follow a request through the system.

Code areas:

- `src/middlewares/requestContext.ts`
- `src/middlewares/errorHandler.ts`
- `src/utils/apiResponse.ts`
- `src/app.ts`
- `web/src/lib/api.ts`
- `web/src/app/admin/monitoring/page.tsx`

Documentation updated:

- `context/09-phase-history.md`
- `context/11-kpis-slas-monitoring.md`

Verification:

- Backend TypeScript compile passed.
- Web production build passed.
- Full backend build remains blocked by Prisma engine download in the network-restricted shell.

## 2026-06-21 - Next Phase: Notification Sync Hardening

Scope:

- Tightened the notification reconciliation loop so the web app refreshes persisted notifications more aggressively after reconnect, focus, online events, and incoming socket events.
- Added sync-attempt visibility to the notification panel so stale UI can be distinguished from a silent failure.
- Kept socket delivery as acceleration while preserving persisted notifications as the canonical source of truth.

Code areas:

- `web/src/lib/notification-store.ts`
- `web/src/components/NotificationPanel.tsx`

Documentation updated:

- `context/09-phase-history.md`

Verification:

- Web production build passed.
- Backend TypeScript compile passed.

## Update Rule

Every future phase should add:

- Date and phase name.
- Scope of behavior changed.
- Code areas touched.
- Documentation updated.
- Verification performed or skipped with reason.
