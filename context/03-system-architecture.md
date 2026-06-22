# System Architecture

## Runtime Shape

The platform is a TypeScript monorepo-style application with:

- Express backend in `src/`
- Next.js web portal in `web/`
- PostgreSQL accessed through Prisma
- Redis for cache, queues, socket adapter, OTPs, and ephemeral state
- BullMQ workers for deadlines, maintenance, SMS, mail, and push jobs
- Socket.IO for realtime events
- Stripe for rider payments and driver payouts
- Google Maps for geocoding, route computation, and place details
- Veriff for driving license verification
- Firebase/Twilio/email providers for communication

See `07-architecture-and-flow-diagrams.md` for the high-level architecture, backend lifecycle, domain model, payment, booking, notification, tracking, and deployment diagrams.

## Backend Entry Points

- `src/server.ts` starts HTTP server, validates database and mailer, initializes Socket.IO, starts scheduled jobs, and handles graceful shutdown.
- `src/app.ts` configures middleware, raw Stripe webhook handling, JSON parsing, health checks, docs, route mounting, and API 404/error behavior.
- `src/modules/index.ts` exports mounted routers.

Important route ordering:

- Stripe webhook is mounted before `express.json()` because it requires raw request body signature verification.

## Backend Route Groups

Mounted under `/api/v1`:

- `/auth`
- `/users`
- `/publish-ride`
- `/search-rides`
- `/bookings`
- `/driver/bookings`
- `/rides`
- `/vehicles`
- `/travel-preferences`
- `/maps`
- `/chat`
- `/notifications`
- `/ratings`
- `/dl-verification`
- `/payments`
- `/payments/connect`
- `/admin`
- `/pricing`
- `/payment-methods`
- `/admin/payouts`
- `/drivers/me`
- `/disputes`
- `/admin/disputes`
- `/tracking`
- `/admin/reconciliation`

## Backend Module Boundaries

### Auth and User

Handles OTP login/signup, JWT access/refresh tokens, user profile, avatar upload, TOS acceptance, GDPR export/deletion, user reports and blocks.

### Vehicles and Verification

Handles driver vehicle CRUD, documents, and driving license verification integration.

### Publish Ride

Implements Redis-backed multi-step ride draft workflow and final publish.

### Search Ride

Searches published rides and supports segment-view booking contexts.

### Ride Booking

Owns rider booking creation, price preview, payment handoff, booking list/detail, withdrawal, cancellation, and driver-decision deadline extension.

### Driver Booking

Owns driver accept/reject decision flow for booking requests.

### Ride Operations

Owns start/finish ride, driver arrived, pickup OTP verification, no-show, drop-off, rider arrival, missed pickup, dev simulation, and location submission.

### Payments, Payment Methods, Ledger, Payout, Reconciliation

Owns Stripe PaymentIntent flow, saved cards, Stripe Connect, webhook handling, ledger accounting, payout batches, payout eligibility, and reconciliation issues.

### Disputes

Owns user dispute creation, evidence collection, admin evaluation, settlement decisions, and payment/dispute consistency.

### Notifications, Chat, Tracking

Owns stored notifications, push delivery, realtime Socket.IO events, chat conversations/messages, and family tracking links.

### Admin

Owns administrative user actions, stats, force refund, dispute operations, payout operations, and reconciliation views.

## Web Portal Architecture

The web portal is a Next.js app under `web/src/app`.

Major route groups:

- `/auth`
- `/onboarding`
- `/profile`
- `/publish`
- `/search`
- `/rides`
- `/tracking`
- `/admin`
- `/driver/stripe-connect/return`
- `/driver/stripe-connect/refresh`

Shared web infrastructure:

- `web/src/lib/api.ts` centralizes API calls and TypeScript response models.
- `web/src/lib/auth-context.tsx` manages auth state.
- `web/src/lib/socket.ts` manages Socket.IO client events.
- `web/src/lib/stripe.tsx` provides Stripe.js/Elements.
- components include navbar, protected routes, notification panel/toasts, live tracking link surfaces, and other UI pieces. Maps remain available in the codebase where needed, but ride detail pages now prioritize compact live status and link handoff instead of full embedded map views.

## Data Architecture

Primary store: PostgreSQL through Prisma.

Important data categories:

- relational core domain: users, rides, bookings, vehicles, payments
- append-only financial records: ledger entries
- stateful process records: payout batches, disputes, reconciliation issues
- operational event history: ride events, location updates
- communication records: notifications, conversations, messages
- integration records: Stripe webhook events, payment methods, device tokens

Redis is used for:

- OTP/session-like temporary values
- ride publish drafts
- caching
- Socket.IO adapter state
- BullMQ queues
- presence and realtime coordination

## Realtime Architecture

Socket.IO is initialized from `src/server.ts`.

The backend emits domain updates to connected users and ride rooms.

Important event types:

- `notification:new`
- `booking:updated`
- `ride:updated`
- `ride:location`

The web portal listens for these events and also performs API refreshes. The product should not rely on sockets as the only state update path; important pages should reconcile from API after actions.

## Queue and Job Architecture

BullMQ queues support:

- booking deadline handling
- maintenance cleanup
- SMS worker
- mail worker
- push worker

Cron/scheduled jobs support:

- fuel price updates
- booking timeout checks
- maintenance processing
- reconciliation and payout eligibility jobs where configured

## Payment Architecture

Current flow:

1. Booking creates Stripe PaymentIntent.
2. Web confirms payment using a saved Stripe payment method.
3. Backend webhook or confirm-status fallback moves booking to `DRIVER_PENDING`.
4. Driver accepts or rejects.
5. Payment can be held, refunded, marked eligible, transferred, or reconciled depending on ride/dispute lifecycle.

Important decision:

- Saved card PaymentIntents must include Stripe `customer`.
- Webhook delivery is still required for full Stripe event consistency, but booking confirmation has a direct Stripe reconciliation fallback.

## Deployment Architecture

Docker Compose defines backend, web, workers, Redis/PostgreSQL dependencies, and environment wiring.

Backend Dockerfile builds TypeScript and Prisma client.

Web Dockerfile builds Next.js with public environment variables embedded at build time.

Important operational constraints:

- Rebuild web after changing `NEXT_PUBLIC_*` values.
- Rebuild backend after changing server code or backend env-only behavior.
- Stripe webhook route must receive raw body.
- `DATABASE_URL` must be available during Prisma generate/build.
