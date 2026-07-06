# XLSX Feedback Status by Reviewer

Reviewed directly from the downloaded workbooks and reconciled with the current code on 2026-07-06:

- `WebAap Testing.xlsx`
- `deliivoweb-test-cases.xlsx`

Status meanings:

- `Done`: implemented and code/build verified.
- `Partial`: useful parts are implemented, but a requested detail or production verification remains.
- `Decision applied`: intentionally implemented differently following the agreed product decision.
- `Runtime`: code is fixed, but deployed end-to-end verification remains.
- `Rejected`: intentionally not planned.

Current totals across all `68` populated feedback rows:

- `49 Done`
- `5 Partial`
- `2 Runtime verification`
- `8 Decision applied`
- `4 Rejected`

## Rajesh

| Source | Feedback | Status | Current result / remaining work |
|---|---|---|---|
| R2 | Homepage copy and small search fields | Done | Approved copy is used and the hero contains a wider integrated search form. |
| R4 | Guests cannot see rides; guest ride alerts are unclear | Decision applied | Guests can browse rides and open details; login is required for booking. Guest alerts are intentionally hidden. |
| R6 | Empty onboarding layout, logo, optional DOB mismatch, button wording | Done | Onboarding layout/logo were improved, DOB is clearly required, and the action says `Complete`. |
| R8 | Male users see women-only, homepage copy, welcome name | Done | Women-only controls are gender-gated, homepage copy is updated, and signed-in users receive a welcome message. |
| R10 | Unlimited points, Add button styling, route-aware points | Decision applied | Add controls and route-aware pickup/stopover/drop-off points are implemented. Limits remain intentionally bounded. |
| R12 | Minute picker only uses intervals | Done | Every minute from 00 through 59 is available. |
| R14 | Seat-step suggestions including Select wording, vehicle, child and alcohol preferences | Done | Seat wording, vehicle gate, child policy and alcohol-free preference are implemented; seats support 1-10. |
| R15-R16 | Per-seat pricing, EUR, Notes purpose, payout readiness | Done | EUR/per-seat pricing is explicit, Notes is now a rider message, and payout readiness/setup is shown. |
| R18 | Publishing failure and cancellation behavior | Partial | Three-hour cancellation policy and major error mappings are implemented. Generic expired/missing draft errors still need more actionable recovery copy. |
| R20 | Past same-day rides remain visible | Done | Backend removes expired departures and disables same-day search caching. |

## Akash

| Source | Feedback | Status | Current result / remaining work |
|---|---|---|---|
| R3 | Add Facebook/Instagram to Profile | Rejected | Social links intentionally live in the footer, not Profile. |
| R4 | Blog menu, tags, search and author | Done | Blog navigation, search, categories/tags and author presentation exist. |
| R5 | Article, Breadcrumb, FAQ and Organization schemas | Done | All requested structured-data types are implemented. |
| R6 | Unsuitable sign-in image | Done | Sign-in uses Baltic carpooling artwork on desktop and mobile. |
| R7 | Homepage search width and suggested copy | Done | Covered by the new Iti-aligned homepage. |
| R8 | More interactive vehicle page | Done | Vehicle setup has structured Plate, Details and Documents steps with explanation and Back/Next controls. |
| R9 | Guest ride discovery and richer results UX | Decision applied | Guest discovery, filters, verification, ratings, route, vehicle, seats, duration and fare are implemented. Unsupported instant-booking/top-driver/arrival-time claims are intentionally not shown, and guest detail access remains public. |
| R10 | Notification-page redesign | Decision applied | Simple item cards, refresh, read/delete/clear actions and empty state are retained. Heavy category/sidebar/browser-preference design is intentionally omitted. |
| R15 | Language switching and missing headers across named pages | Partial | Language selection is redesigned and persisted in `/en`, `/ee` and `/ru` URLs. Blog, vehicle and notifications have shared navigation; a final EN/ET/RU copy and custom-header visual audit remains. |
| R16 | Vehicle image upload error | Runtime | Validation, document privacy and storage handling are fixed. Railway must be tested with real R2/S3 configuration. |
| R17 | Driver ratings, coding tags, preferences and translation | Runtime | Data rendering and translated preference labels are fixed. A real driver/rider production verification remains. |
| R18 | Improve Blog page | Done | Featured article, compact cards, metadata, categories, popular posts and minimalist treatment are implemented. |
| R19 | Article header, top image and author | Done | Article detail has site header, hero visual, metadata, author section and related articles. |
| R20 | Footer social icons and links | Done | Facebook, Instagram, X, TikTok and LinkedIn use accessible icons and configured URLs. |
| R21 | Footer logo blends into dark background | Done | The dark footer now uses the orange mark with a readable white Deliivo wordmark. |
| R22 | Duplicate footer menu entries | Partial | Most duplicates were removed; `Your Rides` still appears in both driver and passenger columns. |
| R23 | Homepage slogan recommendation | Done | The approved Baltic/local-travel direction is reflected in the hero copy. |

## Puja

| Source | Feedback | Status | Current result / remaining work |
|---|---|---|---|
| R2 | Country code for phone signup | Done | Country code selection and E.164 formatting are implemented. |
| R3 | Guest ride listings missing | Done | Public ride search/listing works without authentication. |
| R4 | DOB says optional but blocks progress | Decision applied | DOB is explicitly required because booking age is enforced. |
| R5 | Missing From/To labels | Done | Clear localized labels are present. |
| R6 | No navigation after publishing | Done | Success view provides navigation and automatically redirects to published rides. |
| R12 | Destination autocomplete remains open | Done | Selection closes the dropdown and preserves the chosen value. |
| R20-R21 | Search fields are vertically misaligned | Done | Search controls use consistent labels, height, spacing and baseline alignment. |

## Rohan

| Source | Feedback | Status | Current result / remaining work |
|---|---|---|---|
| R2 | Header sizing and language/button alignment | Done | Header/logo spacing was increased and right-side controls share a restrained layout. |
| R3 | Footer social presentation | Done | Text abbreviations were replaced with recognizable linked icons. |
| R4 | Publish Back, duplicate stepper, CTA placement, desktop map split | Done | Back is top-left, one stepper remains, Continue is at the bottom, and desktop route fields/map are side by side. |
| R5 | Preserve publish state when adding vehicle | Done | Vehicle detour returns to the same wizard step with in-memory state preserved; stale browser drafts are not restored. |
| R6 | Adopt Shadcn, React Hook Form, Zod, TanStack Query and Axios | Rejected | No broad framework rewrite without a measured engineering need. Existing stack was fixed directly. |
| R7 | Repeated API calls and server-state handling | Partial | Requests are deduplicated, socket payloads update state directly and fallback polling is reduced. Production Railway/Vercel socket behavior still needs runtime verification. |
| R8 | Logged-in user can return to auth pages | Done | Authenticated users are redirected away from sign-in/signup, including browser Back. |
| R9 | Global web theme consistency | Done | Public pages retain orange branding with restrained neutral backgrounds and consistent cards/layout. |

## Iti

| Source | Feedback | Status | Current result / remaining work |
|---|---|---|---|
| R2 | Hero lacks complete search experience | Done | Hero includes From, To, Date, Passengers and Search. |
| R4 | Add emotional Baltic route/travel illustration | Done | A Baltic skyline, road, vehicle and route-pin visual is used. |
| R5 | Rework public navigation and guest visibility | Done | Search, Offer, How it works, Blog and Support are public; account-only links are hidden from guests. |
| R6 | Improve information hierarchy and trust | Decision applied | Concise How it works, routes and benefits are implemented. The unsupported social-proof metrics ribbon was removed rather than presenting unverified claims. |
| R7 | Shorten How Deliivo works | Done | Rider and driver flows use three compact icon/title/one-sentence steps. |
| R8 | Stronger benefit-led propositions | Decision applied | Verified drivers, women-only, transparent pricing, tracking, payments and 24/7 support are shown. The unsupported `70% less` claim is omitted. |
| R9 | Dual rider/driver CTA | Done | Search rides and Offer a ride actions are both present in a compact CTA. |
| R10 | Footer logo and expanded footer/app destinations | Partial | The footer wordmark, legal/support/social links are complete. App badges remain rejected because no mobile apps exist; requested Insurance/Safety destinations are not implemented. |
| R14 | Full homepage redesign reference | Done | The major visual structure and responsive direction were implemented and browser-checked. |

## Utkarsh

The sheet contains only its header and no feedback rows.

## Unattributed `deliivoweb-test-cases.xlsx`

| Source | Feedback | Status | Current result / remaining work |
|---|---|---|---|
| R2 | Location suggestions include unrelated countries | Done | Public autocomplete is constrained to Estonia, Latvia and Lithuania; destination suggestions are biased from the selected origin without blocking valid intercity routes. Publish point searches retain strict radius validation. |
| R3 | Search controls misaligned | Done | Controls now share labels, heights and baseline alignment. |
| R4 | Seat selector should be searchable/editable | Decision applied | Product decision keeps a simple selector, expanded to 1-10 seats. |
| R5 | Signup theme inconsistent | Done | Signup uses the restrained authentication design. |
| R6 | Footer logo contrast | Done | The footer uses an orange mark with a readable white Deliivo wordmark. |
| R7 | Case-sensitive email login | Done | Email normalization and case-insensitive existing-user lookup are implemented across auth flows. |
| R8 | Vehicle registration missing before publishing | Done | Publish surfaces vehicle setup and backend blocks final publication without a vehicle. |
| R9 | Add pickup appears above selected points | Done | Add action follows the selected list. |
| R10 | Add stopover is non-functional/no feedback | Done | Stopovers can be added and success, duplicate, radius and limit feedback is shown. |
| R11 | Add drop-off appears above selected points | Done | Add action follows the selected list. |
| R12 | Publish Back loses data/returns to Profile | Done | Back moves within the wizard and preserves state. |
| R13 | Route expires before publication | Done | Route is recomputed/reselected without restarting the wizard. |
| R14 | Luggage limit is ambiguous | Done | Copy states maximum luggage per passenger. |
| R15 | Stopover should be mandatory | Rejected | Stopovers remain optional by product decision. |
| R16 | Numeric-only name accepted | Done | Unicode-aware name validation rejects numeric-only input. |
| R17 | Minimum age should be 18 | Rejected | Product decision remains minimum booking age 8. |
| R18 | DOB not persisted | Done | DOB is stored, returned and rehydrated after profile save. |

## Remaining Execution Priority

1. Remove the remaining duplicate footer destination.
2. Complete the named-page EN/ET/RU and header audit.
3. Improve publish draft/session-expiry recovery messages.
4. Decide whether separate Insurance/Safety pages are required.
5. Verify Railway R2/S3 uploads, Railway/Vercel sockets, public driver profiles and admin monitoring/content in production.
