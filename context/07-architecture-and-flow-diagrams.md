# Architecture And Flow Diagrams

These diagrams use Mermaid syntax so they can be rendered by GitHub, many Markdown tools, and documentation portals.

## High-Level System Architecture

```mermaid
flowchart LR
  RiderWeb[Web Portal - Rider]
  DriverWeb[Web Portal - Driver]
  AdminWeb[Web Portal - Admin]
  Mobile[Mobile App]

  API[Express API]
  Socket[Socket.IO Gateway]
  DB[(PostgreSQL / Prisma)]
  Redis[(Redis)]
  Queue[BullMQ Workers]

  Stripe[Stripe Payments + Connect]
  Maps[Google Maps]
  Veriff[Veriff]
  Firebase[Firebase Push]
  Twilio[Twilio SMS]
  Mail[SMTP Mail]

  RiderWeb --> API
  DriverWeb --> API
  AdminWeb --> API
  Mobile --> API

  RiderWeb <--> Socket
  DriverWeb <--> Socket
  Mobile <--> Socket

  API --> DB
  API --> Redis
  API --> Queue
  Socket --> Redis
  Queue --> Redis
  Queue --> DB

  API --> Stripe
  Stripe --> API
  API --> Maps
  API --> Veriff
  Queue --> Firebase
  Queue --> Twilio
  Queue --> Mail
```

## Backend Request Lifecycle

```mermaid
sequenceDiagram
  participant Client
  participant App as Express app.ts
  participant Auth as Auth middleware
  participant Route as Module router
  participant Service as Domain service
  participant DB as Prisma/Postgres
  participant Redis
  participant Queue
  participant Socket

  Client->>App: HTTP /api/v1/...
  App->>App: raw webhook route before JSON when Stripe
  App->>Auth: protect route
  Auth-->>App: req.user
  App->>Route: validated request
  Route->>Service: command/query
  Service->>DB: read/write transaction
  Service->>Redis: draft/cache/queue state when needed
  Service->>Queue: delayed or async job when needed
  Service->>Socket: emit domain update when needed
  Service-->>Route: typed result
  Route-->>Client: JSON response
```

## Core Domain Model

```mermaid
erDiagram
  User ||--o{ Vehicle : owns
  User ||--o{ Ride : drives
  User ||--o{ RideBooking : books
  Ride ||--o{ RideWaypoint : has
  Ride ||--o{ RideSegmentCapacity : tracks
  Ride ||--o{ RideBooking : receives
  Ride ||--|| RidePricingSnapshot : freezes
  RideBooking ||--o| Payment : has
  Payment ||--o{ LedgerEntry : creates
  RideBooking ||--o{ Dispute : may_have
  RideBooking ||--o{ RideRating : receives
  RideBooking ||--o{ TrackingLink : exposes
  User ||--o{ Notification : receives
  User ||--o{ PaymentMethod : stores
  User ||--o{ PayoutItem : earns
```

## Publish Ride Flow

```mermaid
flowchart TD
  A[Driver starts publish draft] --> B[Set route and route alternatives]
  B --> C[Select schedule and stopovers]
  C --> D[Set seats, luggage, and currency]
  D --> E[Get recommended pricing]
  E --> F[Driver confirms base and stopover pricing]
  F --> G{Payout ready?}
  G -- No --> H[Block publish and send driver to payout setup]
  G -- Yes --> I[Publish ride]
  I --> J[Persist Ride, Waypoints, SegmentCapacity]
  J --> K[Create pricing snapshot if active config exists]
  K --> L[Ride searchable as PUBLISHED]
```

## Search And Booking Flow

```mermaid
flowchart TD
  A[Rider searches route/date] --> B[Search published rides]
  B --> C[Open ride details]
  C --> D[Select pickup/dropoff segment]
  D --> E[Preview price]
  E --> F[Accept terms and privacy]
  F --> G{Saved card exists?}
  G -- Yes --> H[Use saved card]
  G -- No --> I[Collect card inline]
  H --> J[Create booking]
  I --> J
  J --> K{BOOKING_PAYMENT_MODE}
  K -- bypass --> L[Booking DRIVER_PENDING]
  K -- stripe --> M[Booking PAYMENT_PENDING]
  M --> N[Stripe confirms payment]
  N --> O[Booking DRIVER_PENDING]
  L --> P[Notify driver]
  O --> P
  P --> Q[Driver accepts or rejects before deadline]
```

## Booking Request Expiry Flow

```mermaid
stateDiagram-v2
  [*] --> PAYMENT_PENDING: Stripe mode booking created
  [*] --> DRIVER_PENDING: Bypass mode booking created
  PAYMENT_PENDING --> DRIVER_PENDING: payment succeeded
  DRIVER_PENDING --> CONFIRMED: driver accepts before deadline
  DRIVER_PENDING --> CANCELLED: driver rejects before deadline
  DRIVER_PENDING --> DEADLINE_EXPIRED: initial deadline job fires
  DEADLINE_EXPIRED --> DRIVER_PENDING: rider extends once
  DEADLINE_EXPIRED --> CANCELLED: rider cancels
  DRIVER_PENDING --> CANCELLED: extended deadline auto-cancel
  DRIVER_PENDING --> CANCELLED: cron recovery cancel
  CONFIRMED --> CANCELLED: rider/driver cancellation policy
```

## Payment And Payout Flow

```mermaid
flowchart TD
  A[Booking price calculated] --> B[Create Payment record]
  B --> C[Create Stripe PaymentIntent]
  C --> D[Web confirms card payment]
  D --> E{Payment succeeded?}
  E -- No --> F[Booking PAYMENT_FAILED and release seats]
  E -- Yes --> G[Stripe webhook or confirm fallback]
  G --> H[Booking DRIVER_PENDING]
  H --> I{Driver decision}
  I -- Reject --> J[Cancel booking and refund]
  I -- Accept --> K[Booking CONFIRMED]
  K --> L[Ride operations complete]
  L --> M[Ledger creates driver liability and platform fee]
  M --> N[Payout eligibility]
  N --> O[Stripe Connect transfer / payout batch]
  O --> P[Reconciliation checks]
```

## Ride-Day Operations Flow

```mermaid
stateDiagram-v2
  [*] --> PUBLISHED
  PUBLISHED --> ACTIVE: driver starts ride
  ACTIVE --> WAITING_FOR_PICKUP: confirmed bookings moved to pickup state
  WAITING_FOR_PICKUP --> DRIVER_ARRIVED: driver marks arrived
  WAITING_FOR_PICKUP --> DRIVER_MISSED_PICKUP: rider marks missed pickup
  DRIVER_ARRIVED --> OTP_PENDING: rider/driver pickup evidence ready
  OTP_PENDING --> ONBOARD: pickup OTP verified or manual pickup approved
  OTP_PENDING --> NO_SHOW: driver marks no-show
  ONBOARD --> DROP_PENDING: driver marks passenger dropped
  DROP_PENDING --> COMPLETED: rider/driver dropoff confirmation
  COMPLETED --> [*]
```

## Live Tracking Flow

```mermaid
sequenceDiagram
  participant Driver
  participant API as Tracking/Ride Operations API
  participant DB as LocationUpdate
  participant Socket as Socket.IO
  participant Rider
  participant Link as Public Tracking Link

  Driver->>API: submit current location
  API->>DB: persist location update
  API->>Socket: emit ride:location
  Socket-->>Rider: driver position update
  Rider->>API: refresh ride/tracking state
  Link->>API: GET /tracking/:token
  API-->>Link: read-only route and latest location
```

## Notification Delivery Flow

```mermaid
flowchart TD
  A[Domain event] --> B[Create Notification row]
  B --> C[Emit notification:new over Socket.IO]
  B --> D[Queue push/email/SMS when needed]
  C --> E[Active web/mobile clients update panel]
  D --> F[Firebase push]
  D --> G[Email]
  D --> H[SMS]
  E --> I[Client refetches canonical API state]
  F --> I
```

## Dispute And Reconciliation Flow

```mermaid
flowchart TD
  A[Ride or booking problem] --> B[User opens report/dispute]
  B --> C[Dispute record created]
  C --> D[Collect evidence]
  D --> E[Ride events]
  D --> F[Location updates]
  D --> G[Payments and ledger]
  D --> H[Notifications and messages]
  E --> I[Admin review]
  F --> I
  G --> I
  H --> I
  I --> J[Decision terminal]
  J --> K[Refund, payout hold, release, or adjustment]
  K --> L[Reconciliation issue resolved or tracked]
```

## Deployment Topology

```mermaid
flowchart TD
  Compose[Docker Compose] --> Web[Next.js web container]
  Compose --> Backend[Express backend container]
  Compose --> MailWorker[Mail worker]
  Compose --> SmsWorker[SMS worker]
  Compose --> Redis[(Redis)]
  Compose --> Postgres[(PostgreSQL)]

  Web --> Backend
  Backend --> Redis
  Backend --> Postgres
  MailWorker --> Redis
  SmsWorker --> Redis
  MailWorker --> Postgres
  SmsWorker --> Postgres

  Backend --> Stripe[Stripe]
  Backend --> Google[Google Maps]
  Backend --> Veriff[Veriff]
```
