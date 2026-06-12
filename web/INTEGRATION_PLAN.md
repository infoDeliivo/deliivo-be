# Deliivo Web — Backend Integration Plan

## Overview

This document tracks the phased integration of the Deliivo web frontend (`/web`) with the Express backend API. The backend has **117 endpoints** across 25 modules. The web frontend was initially scaffolded with static/mock data and is being progressively wired to real APIs.

**Backend base URL:** `http://localhost:3000` (or `NEXT_PUBLIC_API_URL` env var)
**Auth mechanism:** JWT Bearer token (`Authorization: Bearer <accessToken>`)
**Token refresh:** `POST /api/v1/auth/access-token` with `{ refreshToken }`

---

## Phase 1 — Auth & Session (Foundation) ✅ COMPLETE

**Goal:** Wire up real authentication so everything else can work.

### Achieved:
- [x] Email/OTP login flow (`POST /api/v1/auth/login` → `POST /api/v1/auth/otp/verify`)
- [x] Phone/OTP login flow (same endpoints, `method: "phone"`)
- [x] Email/Phone signup flow (`POST /api/v1/auth/signup` → OTP verify)
- [x] JWT token storage (localStorage: `deliivo_access_token`, `deliivo_refresh_token`)
- [x] Automatic token refresh on 401 (`POST /api/v1/auth/access-token`)
- [x] User session via `GET /api/v1/users/me`
- [x] Protected route component (redirects to `/auth/signin` if no token)
- [x] Auth context provider (`useAuth()` hook: `user`, `loading`, `login`, `logout`, `refreshUser`)
- [x] Session-aware Navbar (shows user avatar/name when logged in, admin link for ADMIN role)
- [x] Logout (`POST /api/v1/auth/logout` + clear localStorage)
- [x] OTP dev mode display (shows code when `EXPOSE_OTP_IN_RESPONSE=true`)
- [x] OTP resend (`POST /api/v1/auth/otp/resend`)

### Not yet implemented:
- [x] Google OAuth login (frontend wired via Google Identity Services; requires `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + backend `POST /api/v1/auth/google`)
- [ ] Apple OAuth login (no backend endpoint — button shown disabled)

### Key files:
- `src/lib/api.ts` — API client with token management, refresh logic, `authApi` methods
- `src/lib/auth-context.tsx` — React context for auth state
- `src/app/providers.tsx` — Client-side providers wrapper
- `src/app/auth/signin/page.tsx` — Sign in with OTP flow
- `src/app/auth/signup/page.tsx` — Sign up with OTP flow
- `src/components/Navbar.tsx` — Auth-aware navigation
- `src/components/ProtectedRoute.tsx` — Route guard component

---

## Phase 2 — Onboarding & Profile ✅ COMPLETE

**Goal:** User can complete onboarding, manage profile, vehicle, and travel preferences.

### Achieved:
- [x] Onboarding page (`POST /api/v1/users/me/onboarding/complete`) — name, salutation, DOB
- [x] Profile page fetches real data from `GET /api/v1/users/me/profile`
- [x] Travel preferences display + inline edit (`GET/POST /api/v1/travel-preferences`)
- [x] Vehicle list from `GET /api/v1/vehicles`
- [x] Add vehicle via draft flow: `POST /vehicles/draft` → `PUT /vehicles/draft/vehicle-details` → `POST /vehicles/draft/save`
- [x] Delete vehicle (`DELETE /api/v1/vehicles/:id`)
- [x] FormData support in API client (for file uploads)
- [x] Vehicle image upload helper in API client (`POST /vehicles/:id/image`)

### Not yet implemented:
- [x] Avatar upload UI (camera icon overlay on profile pic)
- [x] Profile edit form (name, nickName, salutation, DOB via `PUT /api/v1/users/me/profile`)
- [x] Vehicle document upload (`POST /vehicles/draft/upload-document`) — step 3 in add vehicle flow
- [x] Ratings page wired to real API (fetches from `/users/me/profile` rating summary)

### Key files:
- `src/lib/api.ts` — Added `vehicleApi`, `travelPreferencesApi`, types
- `src/app/onboarding/page.tsx` — Onboarding form
- `src/app/profile/page.tsx` — Profile with real travel prefs
- `src/app/profile/vehicle/page.tsx` — Vehicle CRUD with draft flow

---

## Phase 3 — Publish Ride (Driver Flow) ✅ COMPLETE

**Goal:** Driver can publish a ride through the full draft flow.

### Achieved:
- [x] Place autocomplete via `GET /api/v1/maps/place/autocomplete` + place details
- [x] Draft creation with origin (`POST /api/v1/publish-ride/draft/origin`)
- [x] Destination update (`PUT /api/v1/publish-ride/draft/destination`)
- [x] Route computation (`GET /api/v1/publish-ride/draft/routes/compute`) — shows multiple route options
- [x] Route selection (`PUT /api/v1/publish-ride/draft/routes/select`)
- [x] Schedule update (`PUT /api/v1/publish-ride/draft/schedule`) — calendar + time picker
- [x] Capacity update (`PUT /api/v1/publish-ride/draft/capacity`) — seats, luggage, back-seat-only
- [x] Recommended price fetch (`GET /api/v1/publish-ride/draft/pricing/recommended`)
- [x] Pricing update (`PUT /api/v1/publish-ride/draft/pricing`)
- [x] Notes update (`PATCH /api/v1/publish-ride/draft/notes`) — with femaleOnly flag
- [x] Publish ride (`POST /api/v1/publish-ride/draft/publish`)
- [x] Protected route (requires auth)
- [x] Error handling with user-friendly messages
- [x] Loading states throughout wizard

### Also achieved (infrastructure):
- [x] Next.js API proxy route (`/api/proxy/[...path]`) — bypasses Zscaler by proxying browser requests server-side to backend container
- [x] API client updated to use proxy (browser calls go through `/api/proxy/*`, server-side calls go direct)
- [x] `publishRideApi` module added to API client with all draft endpoints
- [x] `mapsApi` module added to API client (autocomplete + place details)

### Not yet implemented:
- [x] Stopover suggestions UI (step 2 in wizard; fetches from `getStopoverSuggestions()`)
- [x] Map visualization of selected route (Google Maps polyline rendering via `@googlemaps/js-api-loader`)
- [x] Vehicle display during publish (shows user's vehicle in Seats step; backend auto-assigns)

### Key files:
- `src/app/api/proxy/[...path]/route.ts` — Server-side API proxy
- `src/app/publish/page.tsx` — Full publish wizard with real API calls
- `src/lib/api.ts` — Added `publishRideApi`, `mapsApi`, proxy-aware base URL

---

## Phase 4 — Search & Book (Rider Flow) ✅ COMPLETE

**Goal:** Rider can search rides, view details, and book.

### Achieved:
- [x] Search with place autocomplete (origin + destination via `mapsApi`)
- [x] Real-time search via `GET /api/v1/search-ride/advanced` with all filters (date, seats, femaleOnly, maxPrice, sortBy)
- [x] Search results with driver info, vehicle, distance, duration, price
- [x] Ride detail page (`/rides/[id]`) with full ride info from `GET /api/v1/search-ride/:id`
- [x] Segment-aware search (supports `segmentId` for partial routes)
- [x] Price preview before booking (`POST /api/v1/bookings/price-preview`)
- [x] Seat selector (1-4 seats, respects available seats)
- [x] Create booking (`POST /api/v1/bookings`) with success confirmation
- [x] My Rides page — "Booked rides" tab fetches real bookings via `GET /api/v1/bookings`
- [x] My Rides page — "Published rides" tab fetches real rides via `GET /api/v1/publish-ride`
- [x] Booking status badges (Pending, Accepted, Completed, Cancelled, etc.)
- [x] Own-ride detection (hides booking UI when viewing own ride)
- [x] Withdraw booking (`POST /api/v1/bookings/:id/withdraw`)
- [x] Cancel booking (`POST /api/v1/bookings/:id/cancel`)
- [x] Protected routes (all ride/booking pages require auth)

### Not yet implemented:
- [x] Payment method selection (Stripe Elements card input at `/profile/payment-methods`; uses setup intent + `@stripe/react-stripe-js`)
- [x] Recent searches display (shown in pre-search state; fetches from `GET /api/v1/search-ride/user/recent`)
- [x] Ride alert notifications (`POST /api/v1/search-ride/notify` — "Set alert" button when no results found)
- [x] Withdraw/cancel actions in UI (buttons on booking cards in My Rides)

### Key files:
- `src/app/search/page.tsx` — Search with autocomplete + results
- `src/app/rides/[id]/page.tsx` — Ride detail + booking flow
- `src/app/rides/page.tsx` — My Rides (booked + published tabs)
- `src/lib/api.ts` — Added `searchRidesApi`, `bookingsApi` with full types

---

## Phase 5 — Live Ride Operations ✅ COMPLETE

**Goal:** Real-time ride execution with OTP verification and tracking.

### Achieved:
- [x] Driver ride management page (`/rides/[id]/manage`)
- [x] Start ride (`POST /api/v1/rides/:rideId/start`) — transitions PUBLISHED → IN_PROGRESS
- [x] Finish ride (`POST /api/v1/rides/:rideId/finish`) — transitions IN_PROGRESS → COMPLETED
- [x] Accept booking (`POST /api/v1/driver/bookings/:id/accept`)
- [x] Reject booking (`POST /api/v1/driver/bookings/:id/reject`)
- [x] Verify pickup OTP (`POST /api/v1/driver/bookings/:id/pickup-otp/verify`)
- [x] Verify drop-off OTP (`POST /api/v1/driver/bookings/:id/drop-otp/verify`)
- [x] OTP input UI with pickup/dropoff mode toggle
- [x] Pending bookings list with accept/reject actions
- [x] Confirmed passengers list with status badges
- [x] Phase-aware UI (published → in_progress → completed)
- [x] Chat conversations list (`GET /api/v1/chat`)
- [x] Chat messages page (`GET /api/v1/chat/:conversationId/messages`)
- [x] Send message (`POST /api/v1/chat/send`) with optimistic updates
- [x] Mark messages as read (`POST /api/v1/chat/:conversationId/read`)
- [x] Unread badge support
- [x] Messages link in Navbar
- [x] Published rides link to manage page

### Not yet implemented:
- [x] Live map with driver GPS position (Google Maps + Socket.IO `ride:location` event; shown on manage page + ride detail)
- [x] Location submission from driver's browser (geolocation `watchPosition` → `POST /rides/:id/locations` + socket emit)
- [x] Passenger OTP display (rider sees pickup/drop OTP codes on ride detail page)
- [x] rider-confirm-dropoff UI (button on ride detail when booking is IN_PROGRESS)
- [x] Rating submission after ride completion (star selector + review text)
- [x] Push notifications via Socket.IO (NotificationToast component listens to `notification` events; shown globally)

### Key files:
- `src/app/rides/[id]/manage/page.tsx` — Driver ride management dashboard
- `src/app/chat/page.tsx` — Conversations list
- `src/app/chat/[conversationId]/page.tsx` — Chat messages + send
- `src/lib/api.ts` — Added `driverBookingApi`, `rideOpsApi`, `chatApi`

---

## Phase 6 — Payments & Payouts ✅ COMPLETE

**Goal:** Stripe integration for payments and driver payouts.

### Achieved:
- [x] Stripe Connect onboarding flow (`POST /api/v1/payments/connect/onboard` → redirect to Stripe)
- [x] Connect status check (`GET /api/v1/payments/connect/status`) — shows connected badge
- [x] Payment confirmation after booking (`POST /api/v1/bookings/:id/payment/confirm`)
- [x] Driver earnings dashboard with balance cards, total earnings, ride count
- [x] Payout history with status badges (paid/pending)
- [x] Dispute creation form with reason selector + description
- [x] Disputes list with status (Open, Under Review, Resolved, Closed)
- [x] API client modules: `paymentsApi`, `payoutsApi`, `disputesApi`
- [x] Earnings link in Navbar dropdown
- [x] Profile page links to Earnings & Disputes

### Not yet implemented:
- [x] Stripe Elements for card input (`/profile/payment-methods` — CardElement + setup intent confirm)
- [x] Request payout button (on earnings page; calls `POST /api/v1/drivers/me/payouts/request`)

### Key files:
- `src/app/profile/earnings/page.tsx` — Driver earnings + payout history + Stripe Connect
- `src/app/profile/disputes/page.tsx` — Disputes list + create form
- `src/lib/api.ts` — Added `paymentsApi`, `payoutsApi`, `disputesApi` with types

---

## Phase 7 — Admin Panel ✅ COMPLETE

**Goal:** Wire admin pages to real backend data.

### Achieved:
- [x] Dashboard with real stats from `GET /api/v1/admin/stats` (totalUsers, totalRides, totalBookings, totalRevenue)
- [x] Users table with server-side search, pagination, and ban/unban actions
- [x] Booking refund tool (`POST /api/v1/admin/bookings/:id/refund`)
- [x] Disputes management — list, filter by status, collect evidence, auto-evaluate, manual resolve (REFUND/PAYOUT/SPLIT/ESCALATE)
- [x] Payouts page — check eligibility scan + process individual driver payout
- [x] Revenue/Reconciliation — summary cards, issue list (open/resolved), severity badges, run hourly/daily jobs, resolve issues with notes
- [x] Admin sidebar updated with Disputes + Payouts nav items
- [x] `adminApi` module added to API client with all admin endpoints + types

### Not yet implemented:
- [ ] Admin rides listing (no backend endpoint for all rides — refund + verify tools provided instead)
- [x] Vehicle verification UI (admin tool on Rides page)

### Key files:
- `src/app/admin/page.tsx` — Dashboard with real stats
- `src/app/admin/users/page.tsx` — Users with search, pagination, ban/unban
- `src/app/admin/rides/page.tsx` — Booking refund tool
- `src/app/admin/reports/page.tsx` — Disputes management with actions
- `src/app/admin/payouts/page.tsx` — Payout processing + eligibility check
- `src/app/admin/revenue/page.tsx` — Reconciliation dashboard
- `src/lib/api.ts` — Added `adminApi` with full types

---

## Architecture Notes

### API Client (`src/lib/api.ts`)
- Centralized `apiFetch<T>()` wrapper with automatic JWT injection
- 401 → auto-refresh token → retry request (once)
- FormData detection (skips Content-Type for file uploads)
- Typed API modules: `authApi`, `userApi`, `vehicleApi`, `travelPreferencesApi`
- Error class: `ApiError` with status code + response data

### Auth Flow
```
Signup/Login → OTP sent → User enters code → Verify OTP → Tokens returned → Stored in localStorage
                                                                              ↓
                                                            AuthProvider fetches /users/me → sets user state
```

### State Management
- Auth state: React Context (`AuthProvider`)
- Page data: Local component state with `useEffect` fetches
- No global state library (Redux/Zustand) needed yet

### API Proxy (Zscaler bypass)
Browser requests go through a Next.js API route (`/api/proxy/*`) which forwards to the backend container server-side. This avoids Zscaler corporate proxy blocking `localhost` traffic.

```
Browser → /api/proxy/api/v1/auth/login → Next.js server → http://backend:3000/api/v1/auth/login
```

### Environment Variables
```
BACKEND_URL=http://backend:3000            # Backend URL (server-side proxy target)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=              # Google OAuth (Identity Services)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=           # Google Maps JavaScript API (polylines, live map)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=        # Stripe Elements (card input, setup intents)
NEXT_PUBLIC_SOCKET_URL=                    # Socket.IO server URL (e.g. http://localhost:3000)
```
