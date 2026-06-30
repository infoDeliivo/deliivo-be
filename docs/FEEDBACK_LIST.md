# Feedback List

Purpose: track product and implementation feedback that needs execution across backend, frontend, admin, and operations flows.

Status key:
- `[ ]` not started
- `[/]` in progress
- `[x]` completed
- `[!]` blocked or needs product clarification

Last updated: 2026-06-30

## Completed

- `[x]` Sign-up phone flow now requires country code.
- `[x]` Guest users can browse ride listings before login.
- `[x]` Guest ride alerts are hidden; alerts remain available only to authenticated users.
- `[x]` DOB age gating is enforced for onboarding and profile setup.
- `[x]` Onboarding DOB copy, validation, and submit action are translated consistently across supported locales.
- `[x]` Women-only search, direct ride details, publishing, and booking are enforced using authenticated profile gender.
- `[x]` Public search and ride-detail responses no longer expose other riders' booking or contact data.
- `[x]` Minute picker now exposes all 00-59 values.
- `[x]` Seat selection copy now uses "Select" instead of "Configure".
- `[x]` Alcohol-free ride preference is available in publish and rider views.
- `[x]` Drivers can mark child passengers as welcome while riders travelling with a child aged 2 or younger remain required to bring their own seat.
- `[x]` Confirmed bookings cannot be cancelled within 3 hours of departure.
- `[x]` Water / ferry routes are blocked from publishing.
- `[x]` Public blog cards open the article detail page.
- `[x]` Blog navigation and SEO/schema plumbing are in place.
- `[x]` Profile, footer, and organization schema use configurable Deliivo social links.
- `[x]` Notifications page polish is in place.
- `[x]` Sign-in, vehicle, and notification pages use the restrained layouts adapted from the testing workbook screenshots.
- `[x]` Publish flow shows vehicle setup before seat controls and uses a compact carousel for pickup, stopover, and drop-off points.
- `[x]` Profile social section is removed per the revised product decision.
- `[x]` Fuel and distance pricing documentation is completed.

## Pending / In Progress

### 1. Pickup location suggestions for ride publishing
- `[x]` Add system-generated pickup suggestions for each route while publishing a ride.
- `[x]` Limit driver selection to a maximum of 3 pickup locations.
- `[x]` Ensure suggestions are route-aware for city-to-city travel, for example Tallinn to Tartu.
- `[x]` Persist selected pickup points as ride waypoints the rider can see during booking.
- `[x]` Let riders use those same points for pickup and drop-off selection.
- `[x]` Verify these locations also appear in dispute evidence and ride-operation data.

### 2. Rider GPS evidence in disputes
- `[x]` Verify whether rider GPS is recorded in ride operations.
- `[x]` Add rider GPS to dispute evidence collection if it is missing there.
- `[x]` Make evidence output clearly distinguish driver and rider location history.
- `[x]` Confirm pickup/drop timestamps and evidence are visible in support/admin review.

### 3. Ride details sharing link blinking
- `[x]` Find why the sharing link UI is blinking continuously.
- `[x]` Remove unnecessary rerenders or unstable loading state around sharing links.
- `[x]` Confirm link creation/copy/share flow remains stable after the fix.

### 4. Driver-to-rider rating
- `[x]` Add the ability for drivers to rate riders.
- `[x]` Verify current rating model and API support both directions cleanly.
- `[x]` Add UI entry point in the driver ride completion flow.
- `[x]` Confirm rating visibility and post-completion gating rules.

### 5. Replace "Guide" wording with "Blog"
- `[x]` Replace remaining "Guide" or "Guides" wording with "Blog" where product language should now use blog terminology.
- `[x]` Audit navbar, footer, admin content, and public pages for stale wording.

### 6. Blog publishing and article detail flow
- `[x]` Verify admin content save and publish flow end to end.
- `[x]` Verify published posts appear on `/blog`.
- `[x]` Verify clicking a blog card opens the article detail page.
- `[x]` Verify locale filtering behaves as expected in production.
- `[x]` Verify draft posts do not leak into the public blog.

### 7. Home / onboarding polish
- `[x]` Tighten the home search form spacing and legibility.
- `[x]` Make DOB required and keep the onboarding copy aligned with that behavior.
- `[x]` Review the home hero copy and layout against the remaining testing screenshots.

## Suggested Execution Order

1. Pickup location suggestion system
2. Rider GPS in dispute evidence
3. Sharing link stability
4. Driver-to-rider rating
5. Final wording cleanup from Guide to Blog
6. Blog publish / locale verification
7. Home and onboarding visual polish

## Verification Checklist

- `[x]` Backend type check passes
- `[x]` Frontend build passes
- `[x]` Focused policy and regression suite passes (`34` tests)
- `[ ]` Admin monitoring/content pages load in production
- `[x]` Published blog cards open article detail pages
- `[x]` Ride details page no longer blinks around sharing links
- `[x]` Dispute evidence shows required GPS traces
- `[x]` Publish flow shows up to 3 suggested pickup locations
