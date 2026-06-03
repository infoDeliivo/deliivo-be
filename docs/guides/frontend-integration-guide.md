# Frontend Integration Guide

> This document covers every backend change from the production readiness work (Phases A–E).
> Read this before building or modifying any feature that talks to the API.
> Last updated: 2026-05-25

---

## Table of Contents

1. [Authentication & ToS Acceptance](#1-authentication--tos-acceptance)
2. [Stripe Payment Flow — Booking](#2-stripe-payment-flow--booking)
3. [Stripe Connect — Driver Payout Onboarding](#3-stripe-connect--driver-payout-onboarding)
4. [Price Breakdown Display](#4-price-breakdown-display)
5. [Driver Verification Gate](#5-driver-verification-gate)
6. [Publish Ride — femaleOnly Toggle](#6-publish-ride--femaleonly-toggle)
7. [Ride Lifecycle — Start & Complete (Driver)](#7-ride-lifecycle--start--complete-driver)
8. [Booking Status & Driver Decision Countdown](#8-booking-status--driver-decision-countdown)
9. [OTP Display — Read from Booking Object](#9-otp-display--read-from-booking-object)
10. [User Safety — Report & Block](#10-user-safety--report--block)
11. [Search Results — Booking Data Shape Change](#11-search-results--booking-data-shape-change)
12. [GDPR — Data Export & Account Deletion](#12-gdpr--data-export--account-deletion)
13. [Admin Dashboard](#13-admin-dashboard)
14. [CORS — Origin Registration](#14-cors--origin-registration)
15. [Error Code Reference](#15-error-code-reference)

---

## 1. Authentication & ToS Acceptance

### What changed
The backend now blocks two critical actions — publishing a ride and booking a ride — unless the user has accepted the Terms of Service. The `User` model has new fields: `tosAcceptedAt`, `tosVersion`, `privacyAcceptedAt`, `privacyVersion`. If these are null, the user gets an HTTP 403 with error `TOS_NOT_ACCEPTED`.

### What to build

#### A. ToS acceptance screen
This screen must appear during onboarding (after phone/email verification, before the user can do anything meaningful). It should also be triggered reactively any time the app receives a `TOS_NOT_ACCEPTED` 403 from any endpoint.

Show:
- Full Terms of Service text (or a scroll-and-accept UI)
- Privacy Policy text or a link to it
- An "I accept" / "Agree and continue" button

On accept, call:

```
POST /api/v1/auth/accept-tos
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "tosVersion": "2026-05-01",
  "privacyVersion": "2026-05-01"
}
```

Success response (200):
```json
{
  "success": true,
  "message": "Terms of Service accepted",
  "data": {
    "tosAcceptedAt": "2026-05-25T10:00:00.000Z",
    "tosVersion": "2026-05-01",
    "privacyAcceptedAt": "2026-05-25T10:00:00.000Z",
    "privacyVersion": "2026-05-01"
  }
}
```

#### B. Intercept TOS_NOT_ACCEPTED globally
In your API error interceptor (Axios interceptor, fetch wrapper, etc.), catch any 403 with message containing `TOS_NOT_ACCEPTED` and redirect the user to the ToS acceptance screen. After they accept, retry the original request.

```javascript
// Example Axios interceptor
axios.interceptors.response.use(null, (error) => {
  if (error.response?.status === 403 && error.response?.data?.message?.includes('Terms of Service')) {
    navigationRef.navigate('AcceptTos'); // adjust to your navigation
  }
  return Promise.reject(error);
});
```

#### C. Version management
The `tosVersion` and `privacyVersion` strings should be hardcoded in the app as constants, matching whatever version the legal team publishes. When T&Cs are updated, bump the version string and re-trigger the acceptance screen for all existing users (detect by comparing the stored `tosVersion` from the user profile against the current app version).

---

## 2. Stripe Payment Flow — Booking

### What changed
The backend now requires real Stripe payments. When a booking is created in stripe mode, the API returns a Stripe `clientSecret`. The app must use the Stripe SDK to collect card details and confirm the payment. **Without this, no real booking can be completed.**

### What to build

#### A. Install Stripe SDK
```bash
# React Native
npm install @stripe/stripe-react-native

# Web
npm install @stripe/stripe-js @stripe/react-stripe-js
```

Initialise the Stripe provider at the root of your app with your **publishable key** (not the secret key — that stays on the server):
```jsx
<StripeProvider publishableKey="pk_live_...">
  <App />
</StripeProvider>
```

#### B. Booking creation flow

Step 1 — Create booking (existing call, no change):
```
POST /api/v1/bookings
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "rideId": "...",
  "seatsBooked": 1,
  "luggageCount": 0
}
```

When in stripe mode, the response will have a `payment` object:
```json
{
  "success": true,
  "data": {
    "id": "booking-uuid",
    "status": "PAYMENT_PENDING",
    "totalPrice": 15.50,
    "priceBreakdown": {
      "baseFare": 14.00,
      "luggageFee": 0,
      "serviceFee": 1.50,
      "totalPrice": 15.50,
      "currency": "GBP"
    },
    "payment": {
      "provider": "stripe",
      "paymentIntentId": "pi_...",
      "clientSecret": "pi_..._secret_..."
    }
  }
}
```

Step 2 — Present Stripe payment sheet to the user using the `clientSecret`:

```javascript
// React Native example
import { useStripe } from '@stripe/stripe-react-native';

const { initPaymentSheet, presentPaymentSheet } = useStripe();

// After creating the booking:
await initPaymentSheet({
  paymentIntentClientSecret: booking.payment.clientSecret,
  merchantDisplayName: 'Your App Name',
});

const { error } = await presentPaymentSheet();

if (error) {
  // User cancelled or card declined
  // The booking status is still PAYMENT_PENDING — show a retry or cancel option
  console.error(error.message);
} else {
  // Payment succeeded — Stripe webhook will transition booking to DRIVER_PENDING
  // Poll GET /api/v1/bookings/:id until status !== 'PAYMENT_PENDING'
  pollBookingStatus(booking.id);
}
```

#### C. Polling after payment
After the Stripe sheet closes successfully, the booking status transitions from `PAYMENT_PENDING` → `DRIVER_PENDING` via a Stripe webhook (server-side). Poll the booking endpoint until the status changes:

```javascript
const pollBookingStatus = async (bookingId) => {
  const MAX_POLLS = 10;
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(2000); // wait 2 seconds between polls
    const booking = await api.get(`/bookings/${bookingId}`);
    if (booking.status !== 'PAYMENT_PENDING') {
      navigateToBookingConfirmation(booking);
      return;
    }
  }
  // If still PAYMENT_PENDING after all polls, show a "processing" screen
  navigateToPaymentProcessing(bookingId);
};
```

#### D. Payment failure handling
If the user's card is declined or payment fails, the booking will transition to `PAYMENT_FAILED`. Handle this in your booking status screen by showing an appropriate message and a "Try again" button that starts a new booking.

---

## 3. Stripe Connect — Driver Payout Onboarding

### What changed
Drivers must connect a Stripe account before they can receive payouts. A new set of endpoints handles the Connect onboarding flow. Until a driver completes this, they can still publish rides and accept bookings — but they will not receive automatic payouts.

### What to build

#### A. "Set up payouts" step in driver onboarding
Add a step to the driver onboarding flow (after DL verification, before or alongside publishing the first ride).

Call the onboard endpoint:
```
POST /api/v1/payments/connect/onboard
Authorization: Bearer <accessToken>
```

Response:
```json
{
  "success": true,
  "data": {
    "onboardingUrl": "https://connect.stripe.com/setup/e/..."
  }
}
```

Open `onboardingUrl` in an in-app browser (WebView or system browser). Stripe will walk the driver through entering their bank details, ID, etc.

Stripe redirects back to `APP_BASE_URL/driver/stripe-connect/return` when done. Your app needs to handle this deep link / redirect URL and navigate back into the app.

#### B. Check connection status after return
When the driver returns from Stripe onboarding, call:

```
GET /api/v1/payments/connect/status
Authorization: Bearer <accessToken>
```

Response when complete:
```json
{
  "success": true,
  "data": {
    "connected": true,
    "accountId": "acct_...",
    "chargesEnabled": true,
    "payoutsEnabled": true,
    "detailsSubmitted": true
  }
}
```

Show a "Payouts active" badge when `chargesEnabled: true && payoutsEnabled: true`.

Response when not yet started:
```json
{
  "data": {
    "connected": false,
    "stripeOnboardingComplete": false
  }
}
```

#### C. Ongoing status display
Show the Connect status on the driver's profile/settings screen. If `connected: false`, show a "Connect bank account" CTA. If `chargesEnabled: false` after onboarding, Stripe may need more information — show a "Resume setup" CTA that calls the onboard endpoint again (it reuses the existing Stripe account).

---

## 4. Price Breakdown Display

### What changed
`calculateBookingPrice` now includes a `serviceFee` (platform commission). The `priceBreakdown` object is returned on both the price preview endpoint and the booking creation response.

### What to build

On any booking summary, confirmation, or receipt screen, display all line items from `priceBreakdown`:

```
Base fare:       £14.00
Luggage fee:     £0.00
Service fee:     £1.50
─────────────────────
Total:           £15.50
```

Fields in `priceBreakdown`:
```json
{
  "baseFare": 14.00,
  "luggageFee": 0.00,
  "serviceFee": 1.50,
  "totalPrice": 15.50,
  "currency": "GBP"
}
```

If `serviceFee` is `0`, hide that line item to keep the UI clean.

---

## 5. Driver Verification Gate

### What changed
Drivers cannot publish a ride or accept a booking unless `dlVerified = true` on their account. The API returns HTTP 403 with `DRIVER_NOT_VERIFIED` if they try.

### What to build

#### A. Check `dlVerified` before entering publish-ride flow
When the driver taps "Publish a ride", fetch their profile first:
```
GET /api/v1/users/me
```

Check `dlVerified` in the response. If `false`, redirect them to the DL verification screen instead of the publish-ride wizard.

#### B. Handle the 403 defensively
If `DRIVER_NOT_VERIFIED` is returned from either the publish or accept booking endpoints, show:
> "Your driving licence needs to be verified before you can do this. Go to verification."

Do not let them retry the same action — send them to the verification flow.

---

## 6. Publish Ride — femaleOnly Toggle

### What changed
A new `femaleOnly` boolean field has been added to rides. When enabled, only passengers with salutation `MS`, `MRS`, or `MX` can book. The backend enforces this — the frontend just needs to expose the toggle and display the badge.

### What to build

#### A. Toggle in publish-ride wizard
Add a toggle (step or inline option) labelled "Female passengers only". When enabled, include `femaleOnly: true` in the create/update ride request body.

```json
POST /api/v1/publish-ride
{
  "femaleOnly": true,
  ...other fields
}
```

#### B. Badge in search results and ride detail
If `ride.femaleOnly === true`, show a "Female only" badge on the ride card and detail screen.

#### C. Booking error handling
If a male passenger tries to book a female-only ride (they somehow bypassed the UI filter), the API returns:
- HTTP 403 `"This ride is for female passengers only"`
- Error code: `FEMALE_ONLY_RIDE`

Show an appropriate error message and do not offer a retry.

---

## 7. Ride Lifecycle — Start & Complete (Driver)

### What changed
Two new endpoints allow the driver to move a ride through its lifecycle. Previously there was no way to start or end a ride.

### What to build

#### A. "Start ride" button
Show this button on the driver's active ride screen when the ride status is `PUBLISHED` (ideally only near the departure time).

```
POST /api/v1/publish-ride/:rideId/start
Authorization: Bearer <accessToken>
```

Success: ride status transitions to `IN_PROGRESS`. Update the UI to reflect the in-progress state.

#### B. "Complete ride" button
Show this button when the ride status is `IN_PROGRESS`.

```
POST /api/v1/publish-ride/:rideId/complete
Authorization: Bearer <accessToken>
```

Success: ride status transitions to `COMPLETED`. All passenger bookings are automatically moved to `COMPLETED`. Each passenger receives a push notification with a deep link to rate the driver.

#### C. Rating deep link
The notification sent after ride completion contains:
```json
{
  "deepLink": "app://booking/{bookingId}/rate"
}
```

Handle this deep link and navigate to the rating screen for that booking. Similarly, send the driver a prompt to rate their passengers.

#### D. Status display on ride cards
Map ride statuses to user-facing labels:

| API status | Display label |
|-----------|---------------|
| `PUBLISHED` | Upcoming |
| `IN_PROGRESS` | In progress |
| `COMPLETED` | Completed |
| `CANCELLED` | Cancelled |

---

## 8. Booking Status & Driver Decision Countdown

### What changed
When a booking is in `DRIVER_PENDING` status, the API now returns a rich `decisionDeadline` object with real-time countdown data.

### What to build

#### A. Countdown timer on passenger booking screen
When `booking.status === 'DRIVER_PENDING'`, display the countdown from `decisionDeadline`:

```json
{
  "decisionDeadline": {
    "deadlineAt": "2026-05-25T14:00:00.000Z",
    "timeRemainingMs": 3540000,
    "timeRemainingSeconds": 3540,
    "isExpired": false,
    "canExtend": false,
    "hasBeenExtended": false,
    "autoCancelAt": null,
    "autoCancelTimeRemainingMs": null,
    "autoCancelTimeRemainingSeconds": null
  }
}
```

Display: "Waiting for driver — 59 min remaining"

Use `timeRemainingSeconds` as the initial value for a local countdown timer. Do not re-fetch every second — just decrement locally.

#### B. "Extend deadline" button
When `isExpired: true` AND `canExtend: true`, show an "Extend deadline" button. This means the driver's initial window has expired but the passenger can give them one more hour.

#### C. Auto-cancel warning
When `autoCancelAt` is not null, show a secondary message: "Booking will auto-cancel in X minutes" using `autoCancelTimeRemainingSeconds`.

#### D. Display status mapping for passengers

| `status` | `displayStatus` | Passenger-facing label |
|----------|-----------------|------------------------|
| `PAYMENT_PENDING` | `PAYMENT_PENDING` | Awaiting payment |
| `DRIVER_PENDING` | `PENDING_DRIVER_DECISION` | Waiting for driver |
| `CONFIRMED` | `UPCOMING` | Confirmed |
| `IN_PROGRESS` | `ONGOING` | In progress |
| `COMPLETED` | `COMPLETED` | Completed |
| `CANCELLED` | `CANCELLED` | Cancelled |
| `PAYMENT_FAILED` | `PAYMENT_FAILED` | Payment failed |

---

## 9. OTP Display — Read from Booking Object

### What changed
**Breaking change.** OTPs are no longer stored in or sent via notification payloads. They are now stored directly on the booking record. If your app currently reads OTPs from notification `data`, it will stop working.

### What to build

Read OTPs from the booking detail endpoint:
```
GET /api/v1/bookings/:bookingId
Authorization: Bearer <accessToken>
```

The response includes:
```json
{
  "data": {
    "id": "...",
    "status": "CONFIRMED",
    "pickupOtp": "4821",
    "dropOtp": "9034",
    ...
  }
}
```

**Remove** any code that reads `notification.data.pickupOtp` or `notification.data.dropOtp`. Those fields are no longer present in notification payloads.

Display `pickupOtp` to the passenger on their confirmed booking screen so they can show it to the driver at pickup. Display `dropOtp` after the pickup OTP has been verified.

---

## 10. User Safety — Report & Block

### What changed
Users can now report or block other users. Blocks are enforced at booking time — if either party has blocked the other, the booking will be rejected.

### What to build

#### A. Report user
Add a "Report user" option to the three-dot menu on any user's public profile screen, and on the post-ride screen.

```
POST /api/v1/users/:userId/report
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "reason": "SAFETY",
  "details": "Optional longer description"
}
```

Show a reason picker before submitting. Suggested reasons to show in the UI:
- Safety concern
- No-show
- Abusive behaviour
- Fraud
- Other

#### B. Block user
Add a "Block user" option alongside the report option.

```
POST /api/v1/users/:userId/block
Authorization: Bearer <accessToken>
```

After blocking, the user will no longer appear in that user's search results (UX — the backend enforces the booking block automatically).

#### C. Unblock user
Add an "Unblocked users" list in Settings.

Fetch the list:
```
GET /api/v1/users/me/blocked
Authorization: Bearer <accessToken>
```

Unblock:
```
DELETE /api/v1/users/:userId/block
Authorization: Bearer <accessToken>
```

#### D. Handle booking blocked errors
If `createBooking` returns HTTP 403:

| Error message | What to show |
|---------------|--------------|
| `"You cannot book this ride"` (`USER_BLOCKED`) | Show a neutral message — do not reveal who blocked whom |
| `"Your account has been suspended"` (`USER_BANNED`) | Show a suspension notice with a link to contact support |

---

## 11. Search Results — Booking Data Shape Change

### What changed
**Breaking change.** The `bookings` array inside each ride in search results has been slimmed down. It no longer includes `rider` (passenger name, avatar, phone). If your search results UI renders passenger avatars from this data, it will break.

### What to change

**Before (no longer returned):**
```json
{
  "bookings": [
    {
      "id": "...",
      "rider": {
        "id": "...",
        "name": "Jane Smith",
        "avatarUrl": "https://..."
      },
      "seatsBooked": 1,
      "status": "CONFIRMED"
    }
  ]
}
```

**After (new shape):**
```json
{
  "bookings": [
    {
      "passengerId": "...",
      "seatsBooked": 1,
      "status": "CONFIRMED",
      "pickupWaypointId": null,
      "dropoffWaypointId": null
    }
  ]
}
```

**Action required:** Remove any UI that renders passenger names or avatars in search result cards. Seat availability is still derivable from `ride.availableSeats` directly — that field is always present and is the correct source of truth.

---

## 12. GDPR — Data Export & Account Deletion

### What to build

Both options belong in the user's **Settings → Account** screen.

#### A. Download my data

Button: "Download my data"

```
GET /api/v1/users/me/data-export
Authorization: Bearer <accessToken>
```

Returns a JSON object with the user's full data. On mobile, trigger a file download or share sheet with the JSON. On web, trigger a `Blob` download.

The response includes: profile, travel preferences, vehicles, rides, bookings, ratings, reports made, and blocked users list.

#### B. Delete account

Button: "Delete my account" (place behind a confirmation dialog)

Confirmation dialog text:
> "Are you sure? This will permanently delete your account and all personal data. Active rides and bookings will be cancelled. This cannot be undone."

On confirm, call:
```
DELETE /api/v1/users/me
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "confirm": true
}
```

The `confirm: true` body field is required — the API will return 400 if it is missing.

On success:
1. Clear all local storage, tokens, and cached data
2. Log the user out
3. Navigate to the app's logged-out landing screen
4. Show a brief confirmation: "Your account has been deleted."

Note: The account is anonymised on the server (PII zeroed out) rather than hard-deleted, to preserve booking history for other users. The user will not be able to log in again with the same phone/email.

---

## 13. Admin Dashboard

### What to build

This is a separate internal web app (not part of the main user app). It requires a user with `role: ADMIN` — admin accounts are seeded directly in the database by the backend team.

All endpoints are under `/api/v1/admin/*` and require the admin's JWT.

#### User Management

**List users:**
```
GET /api/v1/admin/users
  ?page=1
  &limit=20
  &search=john               # searches name, email, phone
  &role=USER                 # USER or ADMIN
  &dlVerified=false          # filter unverified drivers
  &isBanned=false            # filter banned users
```

Response includes paginated user list with `{ id, name, email, phone, role, isBanned, isVerified, dlVerified, onboardingStatus, createdAt }`.

**Ban a user:**
```
POST /api/v1/admin/users/:id/ban
```

**Unban a user:**
```
POST /api/v1/admin/users/:id/unban
```

#### Platform Stats

```
GET /api/v1/admin/stats
```

Response:
```json
{
  "data": {
    "totalUsers": 1240,
    "totalRides": 860,
    "totalBookings": 3100,
    "totalRevenue": 24850.00
  }
}
```

Display as a simple dashboard with four metric cards.

#### Vehicle Verification

```
POST /api/v1/admin/vehicles/:id/verify
```

Used to mark a driver's vehicle as verified after reviewing documents.

#### Manual Refund

```
POST /api/v1/admin/bookings/:id/refund
```

Issues a full Stripe refund and cancels the booking. Show this on a booking detail screen accessible from the user detail page.

---

## 14. CORS — Origin Registration

### What changed
The backend now rejects all requests from origins not listed in the `ALLOWED_ORIGINS` environment variable. In development this might manifest as all API calls failing with a CORS error.

### What to do

Provide the backend/DevOps team with all origins that need to be allowed:

| Environment | Origin to add |
|-------------|---------------|
| Local development | `http://localhost:3000` (or your dev port) |
| Staging | `https://staging.yourapp.com` |
| Production web | `https://app.yourapp.com` |

Mobile apps (React Native with native HTTP) do not send an `Origin` header and are not affected by CORS. This only affects web apps and browser-based testing tools.

---

## 15. Error Code Reference

Complete list of application-level error codes the frontend should handle explicitly:

| HTTP | Error code in message | When it occurs | Recommended UX |
|------|-----------------------|----------------|----------------|
| 403 | `TOS_NOT_ACCEPTED` | Publishing a ride or booking without accepting ToS | Navigate to ToS acceptance screen |
| 403 | `DRIVER_NOT_VERIFIED` | Publishing a ride or accepting a booking with unverified DL | Navigate to DL verification screen |
| 403 | `FEMALE_ONLY_RIDE` | Male passenger booking a female-only ride | "This ride is for female passengers only" |
| 403 | `USER_BANNED` | Banned user trying to book | "Your account has been suspended" |
| 403 | `USER_BLOCKED` | Booking blocked due to a block between parties | "You cannot book this ride" |
| 409 | `BOOKING_ALREADY_EXISTS` | Duplicate booking attempt | "You already have a booking on this ride" |
| 409 | `INSUFFICIENT_SEATS` | Seat race condition | "No seats available — try another ride" |
| 409 | `BOOKING_DECISION_DEADLINE_PASSED` | Driver tries to accept after deadline | "The decision window has passed" |
| 400 | `CANNOT_BOOK_OWN_RIDE` | Driver tries to book their own ride | Hide the book button for the driver's own rides |
| 400 | `CANNOT_REPORT_SELF` | User tries to report themselves | Disable report button on own profile |
| 400 | `CANNOT_BLOCK_SELF` | User tries to block themselves | Disable block button on own profile |
| 503 | `PAYMENT_INITIALIZATION_FAILED` | Stripe payment intent creation failed | "Payment could not be started, please try again" |
| 404 | `RIDE_NOT_FOUND` | Ride no longer exists | "This ride is no longer available" |
| 404 | `BOOKING_NOT_FOUND` | Booking no longer exists | Navigate back to booking list |
| 404 | `USER_NOT_FOUND` | Profile fetch for a deleted user | "This user is no longer available" |
