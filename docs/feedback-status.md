# Web application feedback status

Source: `WebAap Testing.xlsx` from Downloads, including first and second testing rounds. Status reflects the codebase on 2026-07-06 and later product decisions made in this thread.

Status meanings: **Done** is implemented in code, **Configuration** needs deployment setup, **Partial** remains incomplete, **Decision** needs a product/data decision, and **Superseded** was replaced by a later explicit decision.

## Rajesh

| Feedback | Status | Resolution |
| --- | --- | --- |
| Homepage copy and larger route search fields | Done | Revised homepage copy and responsive search hero are present. |
| Guests can discover rides before authentication | Done | Search/listing is public; authentication is required for booking. |
| Guest ride alerts | Superseded | Guest alerts were explicitly removed for now. |
| Onboarding space, logo, DOB consistency, completion CTA | Done | Onboarding was redesigned and DOB validation/label behavior aligned. |
| Women-only controls hidden from men | Done | Search and publish eligibility use profile gender; backend also enforces it. |
| Personalized homepage greeting | Done | Authenticated users receive a welcome message. |
| Pickup controls and route visualization | Done | Add controls are buttons and selected route/meeting points form a routed path. |
| Unlimited pickup/drop-off points | Superseded | Final decision is max three origin points, max three destination points, and one position per selected stopover. |
| Every minute available in the time picker | Done | Minute selection supports all values, not fixed intervals. |
| Seat page copy, vehicle placement, child and alcohol preferences | Done | Vehicle gate, child-seat guidance/check, alcohol-free preference, and revised copy are implemented. |
| Up to ten seats | Done | Seat selector allows 1-10. |
| Price copy and EUR-only symbols | Done | Publish and ride detail price breakdowns use EUR and per-seat wording; luggage fees were removed. |
| Three-hour cancellation/short-notice rule | Done | Same-day booking/publishing lead-time checks and three-hour policy are enforced. |
| Past rides shown in search | Done | Search excludes departures whose date and time have passed. |

## Akash

| Feedback | Status | Resolution |
| --- | --- | --- |
| Profile social-follow section | Superseded | Explicitly removed from profile; social links remain in the footer. |
| Blog categories/search/author and article details | Done | Blog listing, detail route, article metadata, schemas, author display, and card navigation exist. |
| Organization, Article, Breadcrumb, and FAQ schema | Done | All four structured-data types are implemented. |
| Sign-in imagery | Done | Sign-in has a Baltic carpooling visual and responsive two-panel design. |
| Homepage search width/copy | Done | Implemented in the current hero. |
| Vehicle-page UX | Done | Vehicle form was moved up and redesigned for a clearer desktop/mobile flow. |
| Guest ride visibility | Done | Public discovery is supported. |
| Notification-page visual simplification | Done | Notifications use distinct simple cards and a refresh action. |
| Language switching on auth/blog/publish/vehicle/notifications | Partial | Locale routing and core translations work, but auth, vehicle, publish, and blog still contain some English-only supporting copy. |
| Full header on blog, Your rides, and publish | Done | Blog and Your rides use the standard header. Publish intentionally uses a focused flow header with back navigation. |
| Vehicle image upload failure | Configuration | Code and diagnostics are ready; Railway must point to an existing R2/S3 bucket with valid write credentials and public base URL. |
| Public driver ratings/preferences and raw translation keys | Done | No-rating text is translated and partial travel preferences are no longer discarded. |
| Blog article images and homepage article cards | Done | Content supports a cover-image URL, detail heroes, list cards, and three latest homepage articles. |
| Six homepage articles after scrolling | Superseded | Current agreed homepage avoids duplicated content and keeps three latest articles with a link to the full blog. |
| Footer social icons/links and visible logo | Done | Facebook, Instagram, X, TikTok, and LinkedIn are environment-driven; footer brand has sufficient contrast. |
| Duplicate footer menu links | Done | Duplicate ride/blog entries were removed. |
| Recommended homepage slogan | Done | Approved revised homepage positioning is used. |

## Puja

| Feedback | Status | Resolution |
| --- | --- | --- |
| Country code for phone authentication | Done | Country-code selector and E.164 normalization are implemented. |
| Guest ride listings | Done | Public discovery is supported. |
| DOB marked optional but required | Done | DOB behavior and validation were aligned. |
| Clear origin/destination labels | Done | Search and publish forms identify both fields. |
| Navigation after publishing | Done | Published result provides normal application navigation. |
| Autocomplete remains open after selection | Done | Selection closes suggestion state. |
| Search-field alignment | Done | Responsive search layout uses consistent controls and baseline. |
| Google and Apple buttons do not work | Done | Apple was removed by product decision. Google Identity Services is wired end-to-end and requires the deployment client-ID configuration documented separately. |

## Rohan

| Feedback | Status | Resolution |
| --- | --- | --- |
| Header and language-control sizing | Done | Header controls have consistent touch targets and responsive spacing. |
| Footer social icons | Done | Icon links are used. |
| Publish back button, stepper, CTA, and map layout | Done | Focused back navigation, one stepper, bottom CTA, and right-side maps are implemented. |
| Publish state lost while adding a vehicle | Done | Draft state and return path are preserved. |
| Replace stack with Shadcn/React Hook Form/TanStack Query | Superseded | A wholesale rewrite is not justified for these bugs; existing React/API patterns are retained. |
| Excessive API polling | Done | Notification and ride updates use sockets with bounded fallback refresh; auth refresh is bounded. |
| Auth page visible after browser-back when logged in | Done | Auth pages redirect authenticated users. |
| Consistent neutral application theme | Done | Core pages use the established cream/white/orange design system. |
| Tablet responsiveness | Partial | Major reported screens were repaired and builds pass; a complete device-matrix visual regression pass remains. |
| Debounce place autocomplete | Done | Search and publish inputs debounce requests. |
| Place/swap alignment and suggestion z-index | Done | Search controls and overlays were corrected. |
| Flag-only language selector | Superseded | Later explicit decision requires complete language names and locale URL slugs. |
| Mobile/tablet navigation drawer | Done | Responsive navigation is implemented. |
| Location API called every 0.5-1 second | Done | Realtime socket location remains live while backend evidence submission is throttled to 10 seconds. |
| Use a public user ID instead of database UUID | Decision | Requires a new immutable public-ID schema, backfill, uniqueness policy, and API migration; it should not be improvised as a UI-only change. |
| Quick-start guides for booking and publishing | Done | Concise four-step guides were added to FAQ. |

## Iti

| Feedback | Status | Resolution |
| --- | --- | --- |
| Search-first hero with origin, destination, date, and seats | Done | Homepage hero contains the full search experience. |
| Hero visual/Baltic route imagery | Done | Responsive Baltic travel imagery is present. |
| Navigation hierarchy | Done | Public and authenticated header menus differ; secondary links live in the footer as requested later. |
| Homepage information hierarchy | Done | Hero, routes, how-it-works, benefits, articles, and balanced CTA are ordered intentionally. Unsupported social-proof statistics were removed by later decision. |
| Shorter How it works | Done | Rider and driver flows use icon/title/short-copy cards. |
| Stronger benefit statements | Done | Verified users, transparent pricing, tracking, payments, women-only, and 24/7 support are represented without unsupported savings claims. |
| Balanced rider/driver CTA | Done | Bottom CTA supports both finding and offering a ride. |
| Footer logo and useful links | Done | Logo contrast, language, support, safety/legal, and driver links are present. |
| App Store/Google Play links | Superseded | No mobile apps exist yet, so fake store links are intentionally omitted. |
| Second-round homepage redesign image | Done | The current homepage follows the reference direction while preserving later requirements such as no fake metrics ribbon and restrained route/article counts. |

## Utkarsh

No written test case exists in the workbook. The sheet contains only headers/reference imagery, so there is no testable requirement to mark complete.

## Deployment actions

1. Configure Google OAuth using `docs/google-sign-in.md`.
2. Configure the production upload bucket using `docs/file-storage.md`.
3. Run `prisma migrate deploy` during backend deployment for the new blog `coverImageUrl` column.
4. Decide whether public user IDs are required before creating a schema/backfill migration.
5. Schedule a final tablet/mobile visual regression pass for the remaining broad responsiveness item.
