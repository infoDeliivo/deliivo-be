# Ride Booking Feature - Complete Flow Plan

## Overview
This document outlines the complete ride booking flow from rider booking to driver confirmation, including payment processing and status management.

---

## Booking Status Flow

```
PAYMENT_PENDING → DRIVER_PENDING → CONFIRMED → IN_PROGRESS → COMPLETED
                                  ↓
                              CANCELLED (at any stage)
```

---

## Complete Booking Flow

### 1. **Rider Books a Ride**
**Endpoint:** `POST /api/bookings`

**Request Body:**
```json
{
  "rideId": "ride-uuid",
  "segmentId": "optional-segment-token",
  "seatsBooked": 2,
  "luggageCount": 1,
  "pickupWaypointId": "optional-waypoint-id",
  "dropoffWaypointId": "optional-waypoint-id",
  "notes": "Optional notes"
}
```

**What Happens:**
1. System validates:
   - Ride exists and is published
   - Rider is not the driver
   - Sufficient seats available (1-4 seats per booking)
   - Valid segment/waypoint selection
   - No existing active booking for this ride

2. System calculates price:
   - Base price per seat × seats booked
   - Luggage fee: £5 per item
   - Service fee: £0 (currently)
   - Total price

3. **Two Payment Modes:**

   **A. Normal Mode (Stripe Payment):**
   - Creates booking with status: `PAYMENT_PENDING`
   - Creates Stripe Payment Intent
   - Returns `clientSecret` for payment UI
   - Decrements available seats

   **B. Bypass Mode (Testing/Development):**
   - Creates booking with status: `DRIVER_PENDING`
   - Skips payment processing
   - Immediately sends notification to driver
   - Decrements available seats

**Response:**
```json
{
  "id": "booking-uuid",
  "status": "PAYMENT_PENDING" or "DRIVER_PENDING",
  "totalPrice": 25.00,
  "priceBreakdown": {
    "basePricePerSeat": 10.00,
    "seatsBooked": 2,
    "subtotal": 20.00,
    "luggageFee": 5.00,
    "serviceFee": 0.00,
    "totalPrice": 25.00,
    "currency": "GBP"
  },
  "payment": {
    "provider": "stripe",
    "paymentIntentId": "pi_xxx",
    "clientSecret": "pi_xxx_secret_xxx",
    "currency": "GBP"
  },
  "ride": { /* ride details */ },
  "segmentRide": { /* segment-specific details */ }
}
```

---

### 2. **Rider Completes Payment**
**Endpoint:** `POST /api/bookings/:id/payment/confirm`

**What Happens:**
1. Rider completes payment in Stripe UI using `clientSecret`
2. Stripe webhook receives `payment_intent.succeeded` event
3. Webhook handler (`src/modules/payments/stripe.webhook.controller.ts`):
   - Updates booking status: `PAYMENT_PENDING` → `DRIVER_PENDING`
   - Records payment details (amount, currency, captured timestamp)
   - Generates driver decision deadline (e.g., 15 minutes)
   - Sends notification to driver

**Notification to Driver:**
```json
{
  "type": "booking.driver.decision_required",
  "title": "New ride request",
  "body": "John wants Palwal to Faridabad",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "passengerName": "John",
    "passengerAvatarUrl": "https://...",
    "originAddress": "Palwal",
    "destinationAddress": "Faridabad",
    "seatsBooked": "2",
    "totalPrice": "25.00",
    "currency": "GBP",
    "decisionDeadlineAt": "2026-05-13T10:15:00Z",
    "deepLink": "app://driver/booking-request/booking-uuid"
  }
}
```

---

### 3. **Driver Sees Booking Request**
**Endpoint:** `GET /api/driver/bookings/:id` (to be implemented)

**What Driver Sees:**
- Passenger name and avatar
- Pickup and dropoff locations
- Number of seats booked
- Total price
- Luggage count
- Booking notes
- Decision deadline timer
- Accept/Reject buttons

**Booking Status:** `DRIVER_PENDING`

---

### 4. **Driver Makes Decision**

#### **Option A: Driver Accepts**
**Endpoint:** `POST /api/driver/bookings/:id/accept`

**What Happens:**
1. Validates:
   - Booking exists and belongs to this driver
   - Status is `DRIVER_PENDING`
   - Decision deadline not passed

2. Updates booking:
   - Status: `DRIVER_PENDING` → `CONFIRMED`
   - Records decision timestamp
   - Generates pickup OTP (6-hour expiry)
   - Generates drop OTP (24-hour expiry)
   - Resets OTP attempt counter

3. Sends notification to rider:
```json
{
  "type": "booking.driver.accepted",
  "title": "Ride confirmed",
  "body": "Driver accepted your booking",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "pickupOtp": "123456",
    "dropOtp": "789012",
    "deepLink": "app://booking/booking-uuid"
  }
}
```

**Response:**
```json
{
  "bookingId": "booking-uuid",
  "rideId": "ride-uuid",
  "passengerId": "passenger-uuid",
  "status": "CONFIRMED"
}
```

---

#### **Option B: Driver Rejects**
**Endpoint:** `POST /api/driver/bookings/:id/reject`

**What Happens:**
1. Validates same as accept
2. Updates booking:
   - Status: `DRIVER_PENDING` → `CANCELLED`
   - Records cancellation details
   - Initiates 100% refund to rider
   - Restores available seats

3. Sends notification to rider:
```json
{
  "type": "booking.driver.rejected",
  "title": "Booking declined",
  "body": "The driver declined this ride request",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "refundInitiated": "true",
    "refundPercent": "100",
    "deepLink": "app://booking/booking-uuid"
  }
}
```

---

### 5. **Rider Views Booking Status**
**Endpoint:** `GET /api/bookings/:id`

**Response includes status-specific data:**

**When `PAYMENT_PENDING`:**
```json
{
  "status": "PAYMENT_PENDING",
  "payment": {
    "provider": "stripe",
    "paymentIntentId": "pi_xxx",
    "clientSecret": "pi_xxx_secret_xxx"
  }
}
```

**When `DRIVER_PENDING`:**
```json
{
  "status": "DRIVER_PENDING",
  "driverDecisionDeadlineAt": "2026-05-13T10:15:00Z"
}
```

**When `CONFIRMED`:**
```json
{
  "status": "CONFIRMED",
  "pickupOtp": "123456",
  "dropOtp": "789012",
  "ride": {
    "driver": {
      "id": "driver-uuid",
      "name": "Driver Name",
      "avatarUrl": "https://..."
    },
    "vehicle": {
      "brand": "Toyota",
      "model_name": "Camry",
      "color": "Blue",
      "year": 2020
    }
  }
}
```

---

### 6. **Trip Lifecycle (After Confirmation)**

#### **A. Trip Starts - Pickup OTP Verification**
**Endpoint:** `POST /api/driver/bookings/:id/pickup-otp/verify`

**Request:**
```json
{
  "otp": "123456"
}
```

**What Happens:**
1. Validates OTP (max 5 attempts)
2. Updates status: `CONFIRMED` → `IN_PROGRESS`
3. Records pickup verification timestamp
4. Notifies rider: "Trip started"

---

#### **B. Trip Ends - Drop OTP Verification**
**Endpoint:** `POST /api/driver/bookings/:id/drop-otp/verify`

**Request:**
```json
{
  "otp": "789012"
}
```

**What Happens:**
1. Validates OTP (max 5 attempts)
2. Updates status: `IN_PROGRESS` → `COMPLETED`
3. Records drop verification timestamp
4. Notifies rider: "Trip completed"
5. Triggers rating flow (if implemented)

---

## API Endpoints Summary

### Rider Endpoints
| Method | Endpoint | Purpose | Status Change |
|--------|----------|---------|---------------|
| POST | `/api/bookings` | Create booking | → `PAYMENT_PENDING` or `DRIVER_PENDING` |
| POST | `/api/bookings/:id/payment/confirm` | Check payment status | `PAYMENT_PENDING` → `DRIVER_PENDING` (via webhook) |
| GET | `/api/bookings/:id` | Get booking details | - |
| GET | `/api/bookings` | List user bookings | - |
| POST | `/api/bookings/:id/cancel` | Cancel booking | → `CANCELLED` |
| POST | `/api/bookings/price-preview` | Calculate price before booking | - |

### Driver Endpoints
| Method | Endpoint | Purpose | Status Change |
|--------|----------|---------|---------------|
| **GET** | **`/api/publish-ride`** | **List driver's rides with all bookings** | **-** |
| **GET** | **`/api/publish-ride/:id`** | **Get ride details with all bookings** | **-** |
| POST | `/api/driver/bookings/:id/accept` | Accept booking | `DRIVER_PENDING` → `CONFIRMED` |
| POST | `/api/driver/bookings/:id/reject` | Reject booking | `DRIVER_PENDING` → `CANCELLED` |
| POST | `/api/driver/bookings/:id/cancel` | Cancel after accepting | `CONFIRMED` → `CANCELLED` |
| POST | `/api/driver/bookings/:id/pickup-otp/verify` | Start trip | `CONFIRMED` → `IN_PROGRESS` |
| POST | `/api/driver/bookings/:id/drop-otp/verify` | Complete trip | `IN_PROGRESS` → `COMPLETED` |

---

## Driver View: Get Ride with Bookings

### Endpoint: `GET /api/publish-ride/:id`

This endpoint allows drivers to see their ride details along with all bookings (riders) and their statuses.

**Request:**
```http
GET /api/publish-ride/cm123abc456
Authorization: Bearer <driver-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Ride fetched successfully",
  "data": {
    "id": "cm123abc456",
    "driverId": "driver-uuid",
    "originAddress": "Palwal, Haryana",
    "destinationAddress": "Faridabad, Haryana",
    "departureDate": "2026-05-15T00:00:00.000Z",
    "departureTime": "08:00",
    "totalSeats": 4,
    "availableSeats": 2,
    "basePricePerSeat": 10.00,
    "currency": "GBP",
    "status": "PUBLISHED",
    "vehicle": {
      "id": "vehicle-uuid",
      "brand": "Toyota",
      "model_name": "Camry",
      "color": "Blue",
      "year": 2020
    },
    "waypoints": [],
    "bookings": [
      {
        "id": "booking-1",
        "passengerId": "passenger-1-uuid",
        "seatsBooked": 2,
        "totalPrice": 20.00,
        "status": "DRIVER_PENDING",
        "createdAt": "2026-05-13T09:00:00.000Z",
        "driverDecisionDeadlineAt": "2026-05-13T09:15:00.000Z",
        "passenger": {
          "id": "passenger-1-uuid",
          "name": "John Doe",
          "nickName": "Johnny",
          "phone": "+44123456789",
          "avatarUrl": "https://..."
        },
        "pickupLocation": {
          "address": "Palwal, Haryana",
          "placeId": "ChIJ..."
        },
        "dropoffLocation": {
          "address": "Faridabad, Haryana",
          "placeId": "ChIJ..."
        },
        "decisionDeadline": {
          "deadlineAt": "2026-05-13T09:15:00.000Z",
          "timeRemainingMs": 600000,
          "timeRemainingSeconds": 600,
          "isExpired": false
        }
      },
      {
        "id": "booking-2",
        "passengerId": "passenger-2-uuid",
        "seatsBooked": 1,
        "totalPrice": 10.00,
        "status": "CONFIRMED",
        "createdAt": "2026-05-13T08:00:00.000Z",
        "driverDecisionAt": "2026-05-13T08:05:00.000Z",
        "passenger": {
          "id": "passenger-2-uuid",
          "name": "Jane Smith",
          "nickName": "Jane",
          "phone": "+44987654321",
          "avatarUrl": "https://..."
        },
        "pickupLocation": {
          "address": "Palwal, Haryana",
          "placeId": "ChIJ..."
        },
        "dropoffLocation": {
          "address": "Faridabad, Haryana",
          "placeId": "ChIJ..."
        }
      }
    ]
  }
}
```

**Key Fields for Driver:**

1. **`bookings`** - Array of all active bookings for this ride
2. **`status`** - Booking status (PAYMENT_PENDING, DRIVER_PENDING, CONFIRMED, IN_PROGRESS, COMPLETED)
3. **`passenger`** - Rider information (name, phone, avatar)
4. **`pickupLocation`** / **`dropoffLocation`** - Where to pick up/drop off the rider
5. **`decisionDeadline`** - Only present for DRIVER_PENDING bookings:
   - `deadlineAt` - ISO timestamp when decision expires
   - `timeRemainingMs` - Milliseconds remaining
   - `timeRemainingSeconds` - Seconds remaining (for countdown timer)
   - `isExpired` - Boolean indicating if deadline passed

**Filtering by Status:**

```http
# Get only rides with pending bookings
GET /api/publish-ride?status=PUBLISHED

# Pagination
GET /api/publish-ride?page=1&limit=10
```

---

## Driver Dashboard Use Cases

### 1. **Show Pending Booking Requests**
Filter bookings with `status === "DRIVER_PENDING"` and display countdown timer using `decisionDeadline.timeRemainingSeconds`.

```javascript
const pendingBookings = ride.bookings.filter(b => b.status === 'DRIVER_PENDING');

pendingBookings.forEach(booking => {
  if (booking.decisionDeadline && !booking.decisionDeadline.isExpired) {
    // Show countdown: booking.decisionDeadline.timeRemainingSeconds
    // Display: "10 minutes remaining to accept/reject"
  }
});
```

### 2. **Show Confirmed Bookings**
Filter bookings with `status === "CONFIRMED"` to show riders who are confirmed for the trip.

```javascript
const confirmedBookings = ride.bookings.filter(b => b.status === 'CONFIRMED');
// Display: "2 riders confirmed for this trip"
```

### 3. **Show Active Trips**
Filter bookings with `status === "IN_PROGRESS"` to show ongoing trips.

```javascript
const activeBookings = ride.bookings.filter(b => b.status === 'IN_PROGRESS');
// Display: "Trip in progress with 2 riders"
```

### 4. **Calculate Total Earnings**
Sum up all confirmed and completed bookings.

```javascript
const earnings = ride.bookings
  .filter(b => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(b.status))
  .reduce((sum, b) => sum + b.totalPrice, 0);
// Display: "Total earnings: £30.00"
```

---

## Database Schema (Key Fields)

```prisma
model RideBooking {
  id                        String        @id @default(uuid())
  rideId                    String
  passengerId               String
  seatsBooked               Int
  totalPrice                Float
  status                    BookingStatus
  
  // Payment fields
  stripePaymentIntentId     String?
  paymentAmount             Float?
  paymentCurrency           String?
  paymentCapturedAt         DateTime?
  
  // Driver decision fields
  driverDecisionDeadlineAt  DateTime?
  driverDecisionAt          DateTime?
  
  // OTP fields
  pickupOtpHash             String?
  pickupOtpExpiresAt        DateTime?
  pickupOtpVerifiedAt       DateTime?
  dropOtpHash               String?
  dropOtpExpiresAt          DateTime?
  dropOtpVerifiedAt         DateTime?
  otpAttemptCount           Int           @default(0)
  
  // Segment booking fields
  pickupWaypointId          String?
  dropoffWaypointId         String?
  
  // Cancellation fields
  cancelledAt               DateTime?
  cancelledByRole           String?
  cancellationReason        String?
  refundPercent             Float?
  refundAmount              Float?
  refundedAt                DateTime?
  
  createdAt                 DateTime      @default(now())
  updatedAt                 DateTime      @updatedAt
}

enum BookingStatus {
  PAYMENT_PENDING
  PAYMENT_FAILED
  DRIVER_PENDING
  CONFIRMED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}
```

---

## Configuration

### Payment Mode
Set in environment variable:
```bash
# Normal mode (Stripe payment required)
BOOKING_PAYMENT_MODE=normal

# Bypass mode (skip payment, go directly to driver)
BOOKING_PAYMENT_MODE=bypass
```

### Pricing Configuration
Located in `src/modules/ride-booking/ride-booking.service.ts`:
```typescript
const LUGGAGE_FEE_PER_ITEM = 5.00;  // £5 per luggage item
const MAX_SEATS_PER_BOOKING = 4;     // Maximum 4 seats per booking
```

### OTP Configuration
Located in `src/modules/driver-booking/driver-booking.service.ts`:
```typescript
const PICKUP_OTP_TTL_MS = 6 * 60 * 60 * 1000;   // 6 hours
const DROP_OTP_TTL_MS = 24 * 60 * 60 * 1000;    // 24 hours
const MAX_OTP_ATTEMPTS = 5;                      // Maximum attempts
```

---

## Error Handling

### Common Errors
- `RIDE_NOT_FOUND` - Ride doesn't exist or not published
- `CANNOT_BOOK_OWN_RIDE` - Rider is the driver
- `INSUFFICIENT_SEATS` - Not enough seats available
- `BOOKING_ALREADY_EXISTS` - Active booking already exists
- `INVALID_BOOKING_SEGMENT` - Invalid segment/waypoint selection
- `PAYMENT_INITIALIZATION_FAILED` - Stripe payment creation failed
- `BOOKING_NOT_DRIVER_PENDING` - Wrong status for driver action
- `BOOKING_DECISION_DEADLINE_PASSED` - Decision window expired
- `INVALID_PICKUP_OTP` / `INVALID_DROP_OTP` - Wrong OTP entered
- `OTP_ATTEMPT_LIMIT_EXCEEDED` - Too many failed attempts

---

## Testing Flow

### 1. Test with Bypass Mode
```bash
# Set environment
BOOKING_PAYMENT_MODE=bypass

# Create booking - goes directly to DRIVER_PENDING
POST /api/bookings

# Driver accepts
POST /api/driver/bookings/:id/accept

# Verify pickup OTP
POST /api/driver/bookings/:id/pickup-otp/verify

# Verify drop OTP
POST /api/driver/bookings/:id/drop-otp/verify
```

### 2. Test with Stripe
```bash
# Set environment
BOOKING_PAYMENT_MODE=normal

# Create booking - status PAYMENT_PENDING
POST /api/bookings

# Complete payment in Stripe UI
# Webhook updates to DRIVER_PENDING

# Driver accepts
POST /api/driver/bookings/:id/accept

# Continue with OTP flow...
```

---

## Next Steps / Missing Features

1. **Driver Booking List Endpoint**
   - `GET /api/driver/bookings` - List all bookings for driver's rides
   - Filter by status (DRIVER_PENDING, CONFIRMED, IN_PROGRESS)

2. **Real-time Updates**
   - WebSocket notifications for status changes
   - Push notifications via FCM

3. **Rating System**
   - After trip completion, trigger rating flow
   - Rider rates driver, driver rates rider

4. **Cancellation Policies**
   - Time-based refund percentages
   - Driver penalties for late cancellations

5. **Driver Dashboard**
   - View pending booking requests
   - View confirmed bookings
   - View trip history

---

## File Locations

- **Rider Booking:** `src/modules/ride-booking/`
- **Driver Booking:** `src/modules/driver-booking/`
- **Payment Processing:** `src/modules/payments/`
- **Notifications:** `src/modules/notification/`
- **OpenAPI Docs:** `docs/openapi/paths/bookings.yaml`, `docs/openapi/paths/driver-bookings.yaml`
