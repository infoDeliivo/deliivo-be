# WebAap Testing Workbook: Execution Plan

Sources reviewed:

- `C:\Users\Ansul Sharma\Downloads\WebAap Testing.xlsx`
- `C:\Users\Ansul Sharma\Downloads\WebAap Testing.pdf`

Review date: 2026-06-29

The XLSX is the stronger source because it separates feedback into three sheets:

- `Rajesh`
- `Akash`
- `Puja`

## Goal

Turn the workbook feedback into:

1. `Implement`
2. `Discuss / clarify`
3. `Counter / push back`

Also merge duplicates so the same issue raised by multiple reviewers is treated once with stronger priority.

## 1. Rajesh Feedback

### Implement

- Update homepage hero/supporting text copy.
- Increase width/usability of search boxes.
- Improve `Tell us about yourself` page density.
- Change onboarding CTA from `Complete setup` to `Complete` or `Submit`.
- Improve route-point UI:
  - `Add pickup point` should look like a button
  - stopovers and route points should feel tied to the route visually
- Allow full minute selection instead of fixed `15-minute` intervals, if accepted.
- Update publish copy:
  - include `per seat`
  - remove dollar-sign assumptions
- Move `Add vehicle` earlier if the flow benefits.
- Redirect the user after successful publish.

### Discuss

- Women-only visibility for male users.
- Child traveler handling:
  - driver flag
  - rider need
  - both
- Why notes exist in publish flow and whether the label should change.
- Whether payout readiness should be visible during publish.
- Cancellation policy from `1 hour` to `3 hours`.

### Counter

- Unlimited pickup / stopover / drop-off points.

Recommended counter:

- keep bounded limits
- if needed, adjust limits slightly
- do not allow unlimited route points

## 2. Akash Feedback

### Implement

- Add social follow links:
  - Facebook
  - Instagram
- Add blog discoverability improvements:
  - blog menu
  - tags
  - search
  - author block
- Add structured data where missing:
  - `Article`
  - `Breadcrumb`
  - `FAQ`
  - `Organization`
- Improve signin page image.
- Improve homepage search width and supporting text.
- Improve vehicle page interaction polish.
- Improve notification page visual/content density.
- Show ride listings without sign-in.
- Gate detail click or booking action behind auth if needed.

### Discuss

- none of Akash’s items are deeply ambiguous except whether all blog IA features are needed in first pass

### Counter

- `Using v0 in Vercel` should not be treated as a product requirement.

Recommended counter:

- use current frontend architecture
- take inspiration if useful
- do not rebuild around an external generator

## 3. Puja Feedback

### Implement

- Add country code selector for phone sign-up.
- Show ride listings for guest users.
- Fix the departure/destination label clarity.
- Redirect user after successful publish.

### Discuss

- `Date of Birth optional but required`

This is not really a design preference now because age validation already exists in product rules.

Recommended answer:

- make DOB explicitly required if business rules depend on age
- do not keep it labeled optional

## 4. Duplicate Issues Across Reviewers

These were raised by more than one person and should be treated as highest priority.

### High-confidence duplicates

- Guest users should be able to see ride listings
  - Rajesh
  - Puja
  - Akash

- Homepage search fields are too small / unclear
  - Rajesh
  - Akash
  - Puja

- DOB field behavior is inconsistent
  - Rajesh
  - Puja

- Publish flow should redirect after successful publish
  - Rajesh
  - Puja

## 5. Proposed Buckets

## A. Implement Directly

- Guest ride visibility before authentication
- Homepage copy updates
- Search field sizing and label clarity
- Onboarding CTA rename
- Onboarding layout improvement
- Phone country code selector
- Publish success redirect
- Publish copy cleanup
- Route-point button styling / route visualization improvement
- Social links
- Notification page polish
- Signin image refresh
- Vehicle page polish
- Blog menu / tags / search / author
- Structured data additions

## B. Needs Discussion / Clarification

1. Women-only visibility and policy
   - male users should not see it
   - define behavior for non-female but not male values too

2. Child travel rules
   - `child seat available`
   - `travelling with child`
   - possible `children allowed` rule

3. Notes section purpose
   - keep and explain
   - rename
   - reduce/remove

4. Payout readiness visibility
   - warning only
   - hard requirement
   - no publish-flow presence

5. Cancellation threshold
   - keep `1 hour`
   - move to `3 hours`
   - special case for rides created within the threshold

6. Guest alert delivery model
   - email
   - push
   - both
   - or remove guest alert until delivery path is defined

7. Minute picker
   - allow all minutes
   - keep 15-minute stepping for operational simplicity

## C. Counter / Push Back

1. Unlimited pickup / stopover / drop-off points
   - push back
   - bounded route structure is the correct product choice

2. Rebuild blog work using `v0`
   - push back
   - use current app architecture

3. Alcohol restriction flag
   - likely discuss before adding
   - not a clear immediate requirement

## 6. Recommended Execution Order

### Phase 1: Fast wins and repeated complaints

- Guest ride visibility
- Homepage text and search UX
- Location labels
- DOB label/requirement fix
- Onboarding CTA/layout
- Publish success redirect

### Phase 2: Publish-flow polish

- Route-point button styling
- route-point visual clarity
- minute picker decision
- publish copy updates
- vehicle step placement

### Phase 3: Policy decisions

- women-only behavior
- child traveler rules
- cancellation timeline
- notes/payout discussion

### Phase 4: Growth/content polish

- blog improvements
- structured data
- social links
- signin image
- notification/vehicle polish

## 7. Questions To Bring Back To You

Resolved decisions:

1. Women-only policy:
   - show women-only publish option only to female drivers
   - allow booking of women-only rides only for women users

2. Cancellation policy:
   - change to `3 hours`

3. Pickup/drop-off limits:
   - keep bounded limits as currently designed

4. Guest alerts:
   - remove guest alert for now
   - revisit later if needed

Still open:

5. Alcohol preference:
   - keep it as a real ride preference / restriction

7. Child seat policy:
   - if the rider is travelling with a child aged `2 years or younger`, the rider must bring the child seat
   - do not assume drivers carry child seats by default
   - this should be treated as a mandatory rider-side rule

Resolved:

6. Minute picker:
   - allow all minute values
   - do not restrict to fixed intervals such as `5`, `15`, or `20`

## 8. Recommended Response To Stakeholders

- Accept the repeated UX and guest-discovery issues.
- Treat guest ride visibility as a product fix, not optional polish.
- Treat women-only, child travel, and cancellation timing as policy decisions.
- Push back on unlimited route points.
- Reuse the current frontend architecture for blog improvements instead of rebuilding around tooling suggestions.

## 9. UI Suggestion Review

The workbook contains embedded suggested UI screenshots. These are useful as direction, but they should not be copied literally where they conflict with the existing app structure.

### Applicable now

- Larger and clearer homepage search bar treatment
- Stronger homepage support text / trust copy
- Denser onboarding form layout
- More obvious route-point controls in publish flow
- Cleaner blog landing page with:
  - category grouping
  - author/tags/sidebar metadata
  - stronger article-card layout
- Better notification page content grouping
- Better profile page support/social block
- Vehicle page with clearer field grouping and stronger step progression

### Applicable with adaptation

- Sign-in page visual refresh
  - applicable, but should still match the current Deliivo brand and auth flow
- Blog page redesign
  - applicable, but should be rebuilt within the existing Next.js frontend rather than copied from external tooling
- Publish flow visual cleanup
  - applicable, but must preserve current logic for route, pricing, and policy enforcement

### Not to copy literally

- Any design that assumes guest alert behavior remains in product
  - guest alerts are removed for now
- Any design that implies unlimited route points
  - this conflicts with the bounded route-point decision
- Any design that weakens women-only or child-seat policy rules
  - those are now explicit product decisions and should drive the UI, not the other way around
