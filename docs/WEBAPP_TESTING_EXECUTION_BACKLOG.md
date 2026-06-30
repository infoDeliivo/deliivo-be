# WebApp Testing: Execution Backlog

Source inputs:

- [WEBAPP_TESTING_PDF_PLAN.md](/abs/path/D:/projects/carpooling-be/docs/WEBAPP_TESTING_PDF_PLAN.md:1)
- `WebAap Testing.xlsx`

Prepared on: 2026-06-29

## Priority Model

- `P1` critical product correctness or repeated reviewer complaint
- `P2` important UX/product improvement
- `P3` polish, growth, or lower-risk enhancement

## Delivery Principles

- Finish repeated, policy-backed issues first
- Keep frontend and backend changes grouped by dependency
- Do not implement UI that conflicts with the agreed product rules

## P1 Backlog

### P1-01 Guest ride visibility

- Priority: `P1`
- Area: `Frontend + Backend`
- Requested by: `Rajesh`, `Akash`, `Puja`
- Outcome:
  - guests can browse available rides
  - booking/request flow still requires auth
  - guest alert entry point is removed for now
- Work:
  - expose search/listing results to unauthenticated users
  - verify ride detail access behavior
  - remove guest alert CTA and related copy
- Dependencies:
  - none
- Estimated effort:
  - `M`

### P1-02 Women-only enforcement

- Priority: `P1`
- Area: `Frontend + Backend`
- Requested by: `Rajesh`
- Decided behavior:
  - only female drivers can publish women-only rides
  - only women users can book women-only rides
- Work:
  - hide women-only publish option for non-female drivers
  - hide/filter women-only booking for non-women users
  - enforce the rule in backend validation, not only UI
- Dependencies:
  - gender must already exist on profile
- Estimated effort:
  - `M`

### P1-03 DOB and age-policy consistency

- Priority: `P1`
- Area: `Frontend + Backend`
- Requested by: `Rajesh`, `Puja`
- Outcome:
  - DOB is labeled consistently with actual validation
  - age-dependent rules remain enforceable
- Work:
  - remove `optional` labeling if DOB is required
  - verify validation messaging in onboarding/profile setup
  - confirm booking-age rule alignment
- Dependencies:
  - none
- Estimated effort:
  - `S`

### P1-04 Publish success redirect

- Priority: `P1`
- Area: `Frontend`
- Requested by: `Rajesh`, `Puja`
- Outcome:
  - after successful publish, user lands on a useful page
- Work:
  - redirect to home, ride manage page, or published rides list
  - add success state copy
- Dependencies:
  - none
- Estimated effort:
  - `S`

### P1-05 Cancellation policy to 3 hours

- Priority: `P1`
- Area: `Frontend + Backend`
- Requested by: `Rajesh`
- Decided behavior:
  - cancellation threshold becomes `3 hours`
- Work:
  - update backend rule
  - update policy messaging
  - show clear short-notice warnings for rides created inside threshold
- Dependencies:
  - none
- Estimated effort:
  - `M`

### P1-06 Child-seat mandatory rider policy

- Priority: `P1`
- Area: `Frontend + Backend`
- Requested by: workbook feedback + product decision
- Decided behavior:
  - if rider travels with a child aged `<= 2 years`, rider must bring the child seat
  - do not assume drivers provide child seats by default
- Work:
  - add booking-side declaration flow
  - enforce required acknowledgement / selection
  - clarify driver vs rider responsibility in UI copy
- Dependencies:
  - may require extra rider input model if child age is captured per booking
- Estimated effort:
  - `M`

### P1-07 Homepage search clarity

- Priority: `P1`
- Area: `Frontend`
- Requested by: `Rajesh`, `Akash`, `Puja`
- Outcome:
  - search fields are visually stronger
  - labels/copy clearly distinguish origin vs destination
- Work:
  - widen search fields
  - improve labels and supporting text
  - align guest and logged-in home variants
- Dependencies:
  - none
- Estimated effort:
  - `S`

## P2 Backlog

### P2-01 Onboarding layout and CTA polish

- Priority: `P2`
- Area: `Frontend`
- Requested by: `Rajesh`
- Work:
  - denser layout for `Tell us about yourself`
  - CTA rename to `Complete` or `Submit`
  - verify logo treatment on that page
- Dependencies:
  - none
- Estimated effort:
  - `S`

### P2-02 Phone input country code

- Priority: `P2`
- Area: `Frontend + Backend`
- Requested by: `Puja`
- Work:
  - add country selector in phone sign-up
  - normalize stored/submitted number
- Dependencies:
  - verify backend phone format expectations
- Estimated effort:
  - `M`

### P2-03 Publish-flow copy and pricing UI cleanup

- Priority: `P2`
- Area: `Frontend`
- Requested by: `Rajesh`, `Puja`
- Work:
  - include `per seat` wording
  - remove dollar-sign assumptions
  - better explain notes or rename if needed
  - show payout-readiness warning only if useful
- Dependencies:
  - notes/payout messaging decision
- Estimated effort:
  - `S`

### P2-04 Route-point UI clarity

- Priority: `P2`
- Area: `Frontend`
- Requested by: `Rajesh`
- Decided behavior:
  - bounded limits stay
- Work:
  - make `Add pickup point` a real button
  - visually connect stopovers and route points to the route
  - highlight in-route meaning more clearly
- Dependencies:
  - current bounded route-point model
- Estimated effort:
  - `M`

### P2-05 Alcohol ride preference

- Priority: `P2`
- Area: `Frontend + Backend`
- Requested by: `Rajesh`
- Decided behavior:
  - keep as a real ride preference/restriction
- Work:
  - add publish preference
  - surface it in ride details/search chips where relevant
  - enforce as informational policy flag
- Dependencies:
  - decide final naming and translation keys
- Estimated effort:
  - `M`

### P2-06 Vehicle step flow polish

- Priority: `P2`
- Area: `Frontend`
- Requested by: `Rajesh`, `Akash`
- Work:
  - reconsider `Add vehicle` placement in publish flow
  - improve field grouping and interaction clarity on vehicle page
- Dependencies:
  - none
- Estimated effort:
  - `M`

## P3 Backlog

### P3-01 Blog IA and discovery improvements

- Priority: `P3`
- Area: `Frontend`
- Requested by: `Akash`
- Work:
  - blog nav visibility
  - tags
  - search
  - author block
- Dependencies:
  - current blog routes remain source of truth
- Estimated effort:
  - `M`

### P3-02 Structured data / SEO schema

- Priority: `P3`
- Area: `Frontend`
- Requested by: `Akash`
- Work:
  - `Article`
  - `Breadcrumb`
  - `FAQ`
  - `Organization`
- Dependencies:
  - stable content layout and FAQ structure
- Estimated effort:
  - `M`

### P3-03 Profile social links

- Priority: `P3`
- Area: `Frontend`
- Requested by: `Akash`
- Work:
  - add Facebook and Instagram links in appropriate profile/support surface
- Dependencies:
  - none
- Estimated effort:
  - `S`

### P3-04 Notification page polish

- Priority: `P3`
- Area: `Frontend`
- Requested by: `Akash`
- Work:
  - improve grouping and page density
  - preserve current notification behavior
- Dependencies:
  - none
- Estimated effort:
  - `S`

### P3-05 Sign-in page visual refresh

- Priority: `P3`
- Area: `Frontend`
- Requested by: `Akash`
- Work:
  - improve imagery and balance
  - keep current auth structure
- Dependencies:
  - none
- Estimated effort:
  - `S`

## Deferred / Explicitly Rejected

### D-01 Unlimited pickup / stopover / drop-off points

- Status: `Rejected for now`
- Reason:
  - conflicts with route clarity, pricing, booking, and operations logic

### D-02 Guest alerts

- Status: `Deferred / removed`
- Reason:
  - product decision is to remove for now

### D-03 v0 as implementation requirement

- Status: `Rejected`
- Reason:
  - tooling suggestion only, not product requirement

## Dependency Order

### Wave 1

- `P1-01` Guest ride visibility
- `P1-03` DOB consistency
- `P1-04` Publish success redirect
- `P1-07` Homepage search clarity

### Wave 2

- `P1-02` Women-only enforcement
- `P1-05` Cancellation policy
- `P1-06` Child-seat mandatory rider policy

### Wave 3

- `P2-01` Onboarding polish
- `P2-02` Phone country code
- `P2-03` Publish pricing/copy cleanup
- `P2-04` Route-point UI clarity
- `P2-05` Alcohol preference
- `P2-06` Vehicle flow polish

### Wave 4

- `P3-01` Blog IA
- `P3-02` Structured data
- `P3-03` Social links
- `P3-04` Notification polish
- `P3-05` Sign-in refresh

## Recommended First Implementation Slice

Best first slice for momentum:

1. `P1-01` Guest ride visibility
2. `P1-03` DOB consistency
3. `P1-04` Publish success redirect
4. `P1-07` Homepage search clarity

This gives the highest visible improvement with the lowest policy complexity.

## Effort Legend

- `S` small: up to half day
- `M` medium: one to two days
- `L` large: multi-day / cross-flow change
