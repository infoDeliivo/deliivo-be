# Feedback List

Purpose: track product and implementation feedback that needs execution across backend, frontend, admin, and operations flows.

Status key:
- `[ ]` not started
- `[/]` in progress
- `[x]` completed
- `[!]` blocked or needs product clarification

Last updated: 2026-06-24

## Active Feedback

### 1. Pickup location suggestions for ride publishing
- `[/]` Add system-generated pickup suggestions for each route while publishing a ride.
- `[/]` Limit driver selection to a maximum of 3 pickup locations.
- `[/]` Ensure suggestions are route-aware for city-to-city travel, for example Tallinn to Tartu.
- `[/]` Persist selected pickup points as ride waypoints the rider can see during booking.
- `[/]` Let riders use those same points for pickup and drop-off selection.
- `[ ]` Verify these locations also appear in dispute evidence and ride-operation data.

Execution notes:
- Driver should not manually invent all pickup points; the system should propose them.
- Pickup suggestions should be tied to the selected route, not just origin/destination text.

### 2. Fuel and distance-based pricing explanation
- `[ ]` Document how fuel-based recommendation works.
- `[ ]` Document which environment variables influence pricing.
- `[ ]` Document how distance-based pricing aligns with current fare recommendation logic.
- `[ ]` Clarify where the platform uses strict pricing rules versus just recommended pricing.

Execution notes:
- This should result in a readable technical explanation for operations and product review.
- Related source likely includes pricing config, fuel price logic, and route distance usage.

### 3. Rider GPS evidence in disputes
- `[ ]` Verify whether rider GPS is recorded in ride operations.
- `[ ]` Add rider GPS to dispute evidence collection if it is missing there.
- `[ ]` Make evidence output clearly distinguish driver and rider location history.
- `[ ]` Confirm pickup/drop timestamps and evidence are visible in support/admin review.

Execution notes:
- Current feedback suggests rider GPS exists operationally but is missing from evidence exports.

### 4. Ride details sharing link blinking
- `[ ]` Find why the sharing link UI is blinking continuously.
- `[ ]` Remove unnecessary rerenders or unstable loading state around sharing links.
- `[ ]` Confirm link creation/copy/share flow remains stable after the fix.

Execution notes:
- Likely in rider ride detail page state refresh or polling/socket interaction.

### 5. Driver-to-rider rating
- `[ ]` Add the ability for drivers to rate riders.
- `[ ]` Verify current rating model and API support both directions cleanly.
- `[ ]` Add UI entry point in the driver ride completion flow.
- `[ ]` Confirm rating visibility and post-completion gating rules.

Execution notes:
- Current feedback indicates rider-to-driver exists, but reciprocal rating is missing.

### 6. Replace "Guide" wording with "Blog"
- `[ ]` Replace remaining "Guide" or "Guides" wording with "Blog" where product language should now use blog terminology.
- `[ ]` Audit navbar, footer, admin content, and public pages for stale wording.

Execution notes:
- Do not rename places where "guide" is intentionally instructional copy unless product wording requires it.

### 7. Blog publishing and article detail flow
- `[/]` Verify admin content save and publish flow end to end.
- `[/]` Verify published posts appear on `/blog`.
- `[/]` Verify clicking a blog card opens the article detail page.
- `[ ]` Verify locale filtering behaves as expected in production.
- `[ ]` Verify draft posts do not leak into the public blog.

Execution notes:
- Blog detail route has been added in code and still needs production verification.
- Locale normalization has been added and should be rechecked after deploy.

## Suggested Execution Order

1. Blog publishing and article detail verification
2. Sharing link blinking fix
3. Driver-to-rider rating
4. Rider GPS in dispute evidence
5. Pickup location suggestion system
6. Fuel and pricing documentation
7. Final wording cleanup from Guide to Blog

## Verification Checklist

- `[ ]` Backend type check passes
- `[ ]` Frontend build passes
- `[ ]` Admin monitoring/content pages load in production
- `[ ]` Published blog cards open article detail pages
- `[ ]` Ride details page no longer blinks around sharing links
- `[ ]` Dispute evidence shows required GPS traces
- `[ ]` Publish flow shows up to 3 suggested pickup locations
