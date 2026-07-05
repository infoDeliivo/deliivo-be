# XLSX Feedback Catalogue

Purpose: provide a complete, status-neutral inventory of requested changes from the two testing workbooks. This catalogue does **not** decide whether an item is implemented, critical, or worth doing. Those decisions are the next review phase.

Sources reviewed on 2026-07-03:

- `C:\Users\Ansul Sharma\Downloads\deliivoweb-test-cases.xlsx` (`DTC`)
- `C:\Users\Ansul Sharma\Downloads\WebAap Testing.xlsx` (`WAT`)

## Coverage

- `DTC` contains one visible sheet and 17 feedback rows (`Sheet1!R2:R18`). It has no embedded media or comments. It contains 17 hyperlink cells covering 16 unique Lightshot references; rows 3 and 4 share one screenshot. The host blocked automated opening of those links, so the row descriptions and suggestions are retained as the authoritative content.
- `WAT` contains six visible sheets: Rajesh, Akash, Puja, Rohan, Iti, and Utkarsh. Utkarsh currently contains only the column header.
- `WAT` contains no hidden sheets or comments and includes 54 embedded images: Rajesh 13, Akash 24, Puja 2, Rohan 4, and Iti 11.
- Embedded current-state screenshots, suggested-screen mockups, and the complete homepage redesign were visually reviewed. Screenshot-derived details are labelled below.
- Similar requests are grouped under one normalized item, but every contributing workbook row is cited. Distinct nuances from duplicate rows are retained.
- Non-request structure was retained during review but not converted into work items: workbook headers, `WAT Akash!R14` (`NEW Suggestions`), and the empty Utkarsh sheet. `WAT Iti!R14` is included because it anchors the complete redesign image.

## Type Taxonomy

- Functional correctness and persistence: broken actions, expired routes, missing results, stale rides, failed uploads, lost wizard state, DOB persistence, and auth navigation.
- Validation and product policy: age, names, gender eligibility, vehicle gating, stopover requirements, point limits, cancellation, luggage, and child/alcohol preferences.
- UX and visual design: alignment, control placement, page hierarchy, responsive layout, steppers, maps, cards, navigation, notifications, and global theme consistency.
- Content, branding, and localization: product copy, field labels, logos, social links, author attribution, headers, and translations.
- Product feature enhancements: guest discovery, richer search filters, alerts, popular routes, homepage search, blog tooling, notification preferences, and app-store/footer additions.
- Performance and realtime behavior: duplicate API requests, polling, WebSocket delivery, and shared server state.
- SEO and content architecture: article, breadcrumb, FAQ, and organization structured data.
- Technical implementation proposals: component, form, validation, data-fetching, and state-management library choices.

## 1. Search And Ride Discovery

| ID | Normalized requested change | Sources and retained details |
|---|---|---|
| SRCH-01 | Constrain location autocomplete to the selected city and configured radius. | `DTC Sheet1!R2`: prioritize nearby results and exclude unrelated countries unless explicitly searched. |
| SRCH-02 | Align all search controls on one baseline with consistent height, padding, and spacing. | `DTC Sheet1!R3`; `WAT Puja!R20:R21`. Controls named across the rows: From, To, Date, Seats, and Search. |
| SRCH-03 | Make the seat selector quicker to edit. | `DTC Sheet1!R4`: requests a searchable/editable input instead of dropdown-only selection. |
| SRCH-04 | Add clear labels for origin and destination. | `WAT Puja!R5`: use labels such as `From` / `To` or `Leaving from` / `Going to`. |
| SRCH-05 | Close autocomplete after selecting a destination. | `WAT Puja!R12`: preserve the selected value, remove the overlay, and optionally move focus to the date field. |
| SRCH-06 | Allow guests to see available ride listings. | `WAT Rajesh!R4`; `WAT Akash!R9`; `WAT Puja!R3`. |
| SRCH-07 | Apply authentication only when the guest takes a protected action. | `WAT Rajesh!R4`: require login/register at booking; `WAT Akash!R9`: redirect when a guest opens a specific ride. These describe slightly different auth-gate points and need one final rule. |
| SRCH-08 | Define or remove the guest ride-alert flow. | `WAT Rajesh!R4`: asks how an anonymous guest would be notified; `WAT Akash!R9`: requests the same auth treatment for `Set alert` as ride access. |
| SRCH-09 | Do not show expired departure times in search results. | `WAT Rajesh!R20`: past rides on the current day must be excluded. |
| SRCH-10 | Improve search result cards and result-page controls. | `WAT Akash!R9`, suggested screenshot: seat and women-only filters, additional filters, departure-time sorting, driver verification/rating, top-driver badge, departure/arrival times, direct duration, vehicle, seats remaining, instant-booking state, EUR price per seat, and `View ride`. |
| SRCH-11 | Add a search summary and secondary filters beside results on desktop. | `WAT Akash!R9`, suggested screenshot: current route/date/seats summary, edit-search action, price range, time-of-day filters, ride alert, and safety reassurance. |

## 2. Authentication, Onboarding, And Profile

| ID | Normalized requested change | Sources and retained details |
|---|---|---|
| AUTH-01 | Make sign-up visually consistent with the application design system. | `DTC Sheet1!R5`: layout, spacing, typography, color, and component styling. |
| AUTH-02 | Replace or improve the sign-in illustration. | `WAT Akash!R6`, suggested screenshot: Baltic carpooling city/vehicle artwork with supporting copy. |
| AUTH-03 | Authenticate email addresses case-insensitively. | `DTC Sheet1!R7`: normalize email casing before lookup/login. |
| AUTH-04 | Include a selectable country calling code in phone sign-up. | `WAT Puja!R2`. |
| AUTH-05 | Use onboarding space more effectively. | `WAT Rajesh!R6`: the `Tell us about yourself` page feels empty. |
| AUTH-06 | Correct the onboarding logo presentation. | `WAT Rajesh!R6`. |
| AUTH-07 | Rename the onboarding completion action. | `WAT Rajesh!R6`: change `Complete setup` to `Complete` or `Submit`. |
| AUTH-08 | Resolve the DOB optional/required copy mismatch. | `WAT Rajesh!R6`; `WAT Puja!R4`: the field says optional but blocks progress. Puja proposes truly optional; Rajesh primarily reports inconsistency. |
| AUTH-09 | Enforce the agreed minimum age when DOB is saved. | `DTC Sheet1!R17` explicitly requests age 18+. This conflicts with the previously discussed 8+ booking rule and therefore requires a product decision. |
| AUTH-10 | Persist DOB after profile update. | `DTC Sheet1!R18`: value currently clears/resets after save. |
| AUTH-11 | Reject numeric-only names and show validation feedback. | `DTC Sheet1!R16`: allow alphabetic names and supported special characters. |
| AUTH-12 | Redirect authenticated users away from sign-in/sign-up on browser back navigation. | `WAT Rohan!R8`. |
| AUTH-13 | Hide women-only controls from male users. | `WAT Rajesh!R8` for search/home; `WAT Rajesh!R14` for male drivers publishing. |
| AUTH-14 | Personalize the signed-in homepage with the user's name. | `WAT Rajesh!R8`: example `Welcome Rajesh`. |
| AUTH-15 | Show complete driver profile information to riders. | `WAT Akash!R17`: ratings must be visible, coding tags must not render, and chat/pet preferences must match the driver's profile. |

## 3. Ride Publishing, Route, And Policy

| ID | Normalized requested change | Sources and retained details |
|---|---|---|
| PUB-01 | Require or prominently gate vehicle setup before ride publishing. | `DTC Sheet1!R8`: dedicated vehicle registration step and block publishing without a vehicle; `WAT Rajesh!R14`: move `Add vehicle` earlier in the flow. |
| PUB-02 | Preserve the publish wizard when leaving to add/manage a vehicle. | `WAT Rohan!R5`; closely related to `DTC Sheet1!R12`. Return to the same step with entered state intact. |
| PUB-03 | Put `Add pickup point` below existing pickup points and style it as a clear button. | `DTC Sheet1!R9`; `WAT Rajesh!R10`. |
| PUB-04 | Put `Add drop-off point` below existing drop-off points. | `DTC Sheet1!R11`. |
| PUB-05 | Make `Add stopover point` functional and provide success/error feedback. | `DTC Sheet1!R10`. |
| PUB-06 | Preserve entered publish data when moving backward. | `DTC Sheet1!R12`: Back must return to the previous wizard step instead of Profile and must not reset data. |
| PUB-07 | Recover gracefully when a computed route expires. | `DTC Sheet1!R13`: automatically refresh/recompute before publication or offer recalculation without restarting the wizard. |
| PUB-08 | Decide whether stopovers are mandatory. | `DTC Sheet1!R15` requests required-stopover validation. This conflicts with other workbook language treating stopovers as optional and requires a product decision. |
| PUB-09 | Decide whether pickup/drop-off/stopover limits should remain bounded. | `WAT Rajesh!R10` requests unlimited driver-selected points instead of 3 pickup, 1 stopover, and 3 drop-off points. |
| PUB-10 | Keep selected points route-aware and visually connected to the route. | `WAT Rajesh!R10`: do not show them as random points; highlight stopovers on the route. |
| PUB-11 | Offer every minute value in departure time selection. | `WAT Rajesh!R12`: values from 00 through 59, not fixed intervals. |
| PUB-12 | Change seat-step wording from `Configure` to `Select`. | `WAT Rajesh!R14`. |
| PUB-13 | Add a child-traveller/child acceptance preference. | `WAT Rajesh!R14`: reviewer asks whether this belongs to the driver or only riders travelling with a child. |
| PUB-14 | Add an alcohol-free/no-alcohol ride preference. | `WAT Rajesh!R14`. |
| PUB-15 | Clarify that the entered price is per seat for the complete journey. | `WAT Rajesh!R15:R16`. Row 16 names the price-setting step; row 15 contains its detailed feedback. |
| PUB-16 | Use EUR consistently and remove dollar symbols. | `WAT Rajesh!R15:R16`. |
| PUB-17 | Clarify or remove the publish notes field. | `WAT Rajesh!R15:R16`: asks what purpose Notes serves. |
| PUB-18 | Show whether payout setup is ready before publication. | `WAT Rajesh!R15:R16`. |
| PUB-19 | Resolve generic publication failures with actionable errors. | `WAT Rajesh!R18`: reports an error while publishing without further text detail. |
| PUB-20 | Redirect or offer clear navigation after successful publication. | `WAT Puja!R6`: go home or provide choices instead of remaining on the same screen. |
| PUB-21 | Use a three-hour cancellation cutoff. | `WAT Rajesh!R18`: booked rides should not be cancellable inside three hours. |
| PUB-22 | Warn when a ride published inside the cancellation window becomes non-cancellable after booking. | `WAT Rajesh!R18`. |
| PUB-23 | Clarify whether maximum luggage is per passenger or for the whole ride. | `DTC Sheet1!R14`: example copy `Maximum luggage per passenger`. |
| PUB-24 | Simplify the publish page's navigation and progress UI. | `WAT Rohan!R4`: Back at top-left, remove duplicate steppers, and keep Continue below inputs at the bottom. |
| PUB-25 | Use desktop space better in route selection. | `WAT Rohan!R4`: route search fields on the left and map preview on the right; retain an appropriate mobile stack. |

## 4. Vehicle Management

| ID | Normalized requested change | Sources and retained details |
|---|---|---|
| VEH-01 | Make the vehicle page more interactive and structured. | `WAT Akash!R8`, suggested mockup: two steps (`Vehicle details`, `Review`), explanatory intro, and Back/Next actions. |
| VEH-02 | Capture clear vehicle fields. | `WAT Akash!R8`, screenshot-derived: brand, model number, model name, type, color, and year. |
| VEH-03 | Explain why vehicle details are collected. | `WAT Akash!R8`, screenshot-derived trust/identification rationale panel. |
| VEH-04 | Fix vehicle photo upload. | `WAT Akash!R16`. |

## 5. Homepage, Navigation, Branding, And Footer

| ID | Normalized requested change | Sources and retained details |
|---|---|---|
| HOME-01 | Replace weak/grey homepage copy with approved product copy. | `WAT Rajesh!R2`; `WAT Rajesh!R8`; `WAT Akash!R7,R23`. Proposed wording includes commuting across town/intercity travel, verified drivers, trusted riders, and clear pickup points. Akash proposes `Ride from Baltic cities with trusted local drivers`; the suggested visual also uses `Built for safer Baltic shared travel`. |
| HOME-02 | Increase homepage search-field width and readability. | `WAT Rajesh!R2`; `WAT Akash!R7`. |
| HOME-03 | Put a complete ride search experience in the hero. | `WAT Iti!R2`; screenshot redesigns: From, To, date, passengers/seats, and Search. Related to `HOME-02` but broader. |
| HOME-04 | Add a meaningful Baltic route/travel hero illustration. | `WAT Iti!R4`; screenshots show city skylines, route pins/animation, vehicle, driver/passengers, and Baltic travel imagery. |
| HOME-05 | Reorder homepage information to build trust earlier. | `WAT Iti!R6`: Hero, social proof, How it works, Popular routes, Features. Current order cited as Hero, Featured route, How it works, Why choose us, CTA. |
| HOME-06 | Shorten `How Deliivo works`. | `WAT Iti!R7`: icon, title, and one sentence per step; Search, Book, Ride. Suggested visual also separates three rider steps and three driver steps. |
| HOME-07 | Use stronger benefit-led value propositions. | `WAT Iti!R8`: lower travel cost, verified drivers, women-only option, transparent pricing, live tracking, secure payments, and 24/7 support. |
| HOME-08 | Use a dual rider/driver bottom CTA. | `WAT Iti!R8:R9`: rider message/action (`Ready to travel?`, `Search rides`) and driver message/action (`Want to earn while travelling?`, `Offer a ride`). An alternate embedded concept says `We'd love to have you carpool with us` with `Find a ride` and `Post a trip`. |
| HOME-09 | Add popular-route cards to the homepage. | `WAT Iti!R6:R14`, screenshot-derived: route, duration/date, driver count, price, rating, and booking action. |
| HOME-10 | Add social-proof metrics only if backed by real data. | `WAT Iti!R6:R14`, screenshot-derived: verified rider/driver count, average rating, completion rate, cities connected, response time. The catalogue records the request but not the unverified example values. |
| HOME-11 | Consider App Store/Google Play proof or download links if apps exist. | `WAT Iti!R10` and Poparide reference screenshot. |
| NAV-01 | Rework public navigation order and visibility. | `WAT Iti!R5`: recommended public links Search, Offer Ride, How it Works, Support, Sign In, Sign Up; questions Blog order, guest Notifications visibility, and missing Help. |
| NAV-02 | Increase header height/padding. | `WAT Rohan!R2`: improve spacing around logo and navigation. |
| NAV-03 | Match language-switcher height to Sign In/Sign Up buttons. | `WAT Rohan!R2`. |
| BRAND-01 | Improve logo visibility where contrast is poor. | `DTC Sheet1!R6`; `WAT Akash!R21`; `WAT Iti!R10`. Footer specifically requests a white/light logo variant. |
| FOOT-01 | Use recognizable social icons instead of text abbreviations. | `WAT Rohan!R3`; `WAT Akash!R20`, suggested/footer screenshots. |
| FOOT-02 | Link all official social accounts from the footer. | `WAT Akash!R20`: Facebook, Instagram, X/Twitter, TikTok, and LinkedIn URLs supplied in the workbook. |
| FOOT-03 | Remove duplicate footer menu entries. | `WAT Akash!R22`: Blog, Publish/Search ride, and other repeated links. |
| FOOT-04 | Consider additional footer destinations. | `WAT Iti!R10`: App Store, Google Play, Languages, Safety, Legal, Become a Driver, and Insurance. |
| FOOT-05 | Decide whether Facebook/Instagram should also appear on Profile. | `WAT Akash!R3` requests a `Follow us` profile section. This overlaps `FOOT-02` but is a distinct placement decision. |
| THEME-01 | Standardize global page colors and layout consistency. | `WAT Rohan!R9`: review every component; prefer white/neutral page backgrounds and consistent header/footer/page treatment. |

## 6. Blog, Article, Content, And SEO

| ID | Normalized requested change | Sources and retained details |
|---|---|---|
| BLOG-01 | Add a full Blog navigation destination and catalogue. | `WAT Akash!R4`; suggested screenshot uses `Blog` rather than `Guides`. |
| BLOG-02 | Add blog search, tags/categories, and author information. | `WAT Akash!R4`. |
| BLOG-03 | Add blog category filters and counts. | `WAT Akash!R4`, screenshot-derived: All Posts, Rider Tips, Driver Tips, Safety, News, Community. |
| BLOG-04 | Add article-card metadata and imagery. | `WAT Akash!R18`, screenshot-derived: image, category, summary, publish date, read time, tags, and locale where applicable. |
| BLOG-05 | Add a featured article plus compact article rows/cards. | `WAT Akash!R18`, suggested screenshot. |
| BLOG-06 | Show three articles without scrolling and six after scrolling/on the page. | `WAT Akash!R18`. |
| BLOG-07 | Add a complete site header to blog and article pages. | `WAT Akash!R18:R19`; overlaps the missing-header audit in `LOC-02`. |
| BLOG-08 | Add a top/hero image to every article detail page. | `WAT Akash!R18:R19`. |
| BLOG-09 | Correct article author attribution and show an author section. | `WAT Akash!R19`; suggested screenshot shows author name/team card. |
| BLOG-10 | Add Popular Posts. | `WAT Akash!R4`, screenshot-derived sidebar. |
| BLOG-11 | Add a topic-suggestion action. | `WAT Akash!R4`, screenshot-derived `Suggest a Topic`. |
| BLOG-12 | Add newsletter subscription UI if email subscription is supported. | `WAT Akash!R4`, screenshot-derived email/Subscribe panel. |
| BLOG-13 | Use the proposed blog copy and minimalist visual treatment. | `WAT Akash!R18:R19`, including `Practical carpooling guidance for riders and drivers` in the suggested visual. |
| SEO-01 | Add Article structured data. | `WAT Akash!R5`. |
| SEO-02 | Add Breadcrumb structured data. | `WAT Akash!R5`. |
| SEO-03 | Add FAQ structured data. | `WAT Akash!R5`. |
| SEO-04 | Add Organization structured data. | `WAT Akash!R5`. |

## 7. Notifications, Realtime Updates, And API Performance

| ID | Normalized requested change | Sources and retained details |
|---|---|---|
| NOTIF-01 | Improve notification-page information structure. | `WAT Akash!R10`, suggested screenshot: category sidebar with counts for all, messages, ride updates, payments, system updates, and promotions. |
| NOTIF-02 | Add clear notification actions and state. | `WAT Akash!R10`, screenshot-derived: unread count, unread markers, timestamps, type badges, item navigation, Mark all as read, and Refresh. |
| NOTIF-03 | Add browser-notification setup status and action. | `WAT Akash!R10`, screenshot-derived: disabled/not-configured state, Enable notifications, and dismiss action. |
| NOTIF-04 | Add notification preferences entry point. | `WAT Akash!R10`, screenshot-derived. |
| NOTIF-05 | Add a clear caught-up/empty state. | `WAT Akash!R10`, screenshot-derived. |
| PERF-01 | Stop repeated high-frequency API calls. | `WAT Rohan!R7`: reported calls to published rides, bookings, notifications, unread count, and `/users/me` every second/on events. |
| PERF-02 | Use realtime notification delivery instead of continuous polling. | `WAT Rohan!R7`: WebSockets recommended, with restrained fallback refresh. |
| PERF-03 | Introduce shared server-state management where it demonstrably removes duplicate requests. | `WAT Rohan!R7`: Redux suggested. Treat library choice separately from the measured request problem. |

## 8. Localization, Headers, And Cross-Cutting UX

| ID | Normalized requested change | Sources and retained details |
|---|---|---|
| LOC-01 | Complete language switching on all named pages. | `WAT Akash!R15`: Sign In, Register, Blog, Offer a Ride, Vehicle Add, and Notifications. |
| LOC-02 | Restore the shared header where expected. | `WAT Akash!R15`: Blog, Your Rides, and Offer a Ride. Also overlaps `BLOG-07`. |
| LOC-03 | Translate the rider-facing driver profile completely. | `WAT Akash!R17`. |
| UX-01 | Keep visual patterns consistent across auth, vehicle, publish, search, notifications, footer, and page backgrounds. | Consolidates `DTC Sheet1!R3:R6`; `WAT Akash!R6:R10`; `WAT Rohan!R2:R4,R9` without replacing the specific items above. |

## 9. Technical Implementation Suggestions

These are implementation proposals, not user-facing requirements. They should be evaluated against measured problems rather than accepted as a mandatory rewrite.

| ID | Proposed change | Source |
|---|---|---|
| TECH-01 | Adopt Shadcn/UI for UI components. | `WAT Rohan!R6`. |
| TECH-02 | Adopt React Hook Form and Zod for forms/validation. | `WAT Rohan!R6`. |
| TECH-03 | Adopt TanStack Query for server state. | `WAT Rohan!R6`. |
| TECH-04 | Standardize API calls on Axios or Fetch. | `WAT Rohan!R6`. |
| TECH-05 | Adopt Redux for shared state/request deduplication. | `WAT Rohan!R7`; also represented by `PERF-03`. |
| TECH-06 | Use WebSockets for notification updates. | `WAT Rohan!R7`; also represented by `PERF-02`. |

## 10. Similarity And Conflict Map

### Strong duplicate or overlap groups

- Search layout: `SRCH-02`, `HOME-02`.
- Guest ride visibility/auth gating: `SRCH-06`, `SRCH-07`, `SRCH-08`.
- DOB consistency and eligibility: `AUTH-08`, `AUTH-09`, `AUTH-10`.
- Vehicle-before-publish and state preservation: `PUB-01`, `PUB-02`, `VEH-01` through `VEH-04`.
- Pickup/drop-off/stopover UX: `PUB-03` through `PUB-10`.
- Publish navigation/layout: `PUB-02`, `PUB-06`, `PUB-20`, `PUB-24`, `PUB-25`.
- Homepage hero/search: `HOME-01` through `HOME-04`.
- Homepage structure and conversion: `HOME-05` through `HOME-11`, `NAV-01`.
- Footer branding/social/menu: `BRAND-01`, `FOOT-01` through `FOOT-05`.
- Blog catalogue/detail/header: `BLOG-01` through `BLOG-13`, `LOC-02`.
- Notifications and request load: `NOTIF-01` through `NOTIF-05`, `PERF-01` through `PERF-03`.
- Global design consistency: `AUTH-01`, `NAV-02`, `NAV-03`, `THEME-01`, `UX-01`.

### Explicit conflicts requiring a decision

- DOB: make optional (`AUTH-08`) versus mandatory age enforcement (`AUTH-09`).
- Minimum age: workbook requests 18+ (`AUTH-09`) versus the previously discussed 8+ booking eligibility rule.
- Stopovers: required validation (`PUB-08`) versus optional stopovers elsewhere in the product flow.
- Point limits: unlimited (`PUB-09`) versus the bounded pickup/drop-off model described by other feedback and prior product discussion.
- Guest auth gate: opening ride details versus starting booking (`SRCH-07`).
- Guest alerts: support anonymous alerts versus require authentication/remove guest alerts (`SRCH-08`).
- Social placement: add Profile social links (`FOOT-05`) versus footer-only placement.
- Homepage: integrated search form (`HOME-03`) versus earlier requests to simplify/remove a heavy homepage search card.
- Homepage trust metrics (`HOME-10`) must not use mock values unless production data supports them.
- Global framework migration (`TECH-01` through `TECH-05`) versus targeted fixes within the current architecture.

## Next Review Fields

The next pass should assign these fields without modifying the source workbooks:

- Current status: Done / Partial / Missing / Cannot reproduce
- Severity: Critical / High / Medium / Low
- Value: Must do / Worth doing / Optional / Reject
- Scope: Frontend / Backend / Data / Infrastructure / Product decision
- Evidence: code reference, test, screenshot, or production reproduction
- Decision owner and implementation order
