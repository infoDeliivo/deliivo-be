# Booking Creation & Payment Flow - Complete Diagram

## Overview
This document explains the complete flow from booking creation through Stripe payment integration.

---

## High-Level Flow

```
┌─────────────┐
│   Frontend  │
│  (Passenger)│
└──────┬──────┘
       │
       │ POST /api/v1/bookings
       │ { rideId, seatsBooked, ... }
       ↓
┌──────────────────────────────────────────────────────────┐
│                    BACKEND API                            │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │  1. Route Handler                                  │  │
│  │     router.post('/', validate(), createBooking)    │  │
│  └────────────────┬───────────────────────────────────┘  │
│                   │                                       │
│  ┌────────────────▼───────────────────────────────────┐  │
│  │  2. Controller (ride-booking.controller.ts)        │  │
│  │     - Calls BookingService.createBooking()         │  │
│  │     - Handles errors                               │  │
│  │     - Invalidates cache                            │  │
│  └────────────────┬───────────────────────────────────┘  │
│                   │                                       │
│  ┌────────────────▼───────────────────────────────────┐  │
│  │  3. Service (ride-booking.service.ts)              │  │
│  │     ┌──────────────────────────────────────────┐   │  │
│  │     │ A. Validate Ride & Availability          │   │  │
│  │     │    - Check ride exists                   │   │  │
│  │     │    - Check not own ride                  │   │  │
│  │     │    - Check seats available               │   │  │
│  │     │    - Check no active booking exists      │   │  │
│  │     └──────────────┬───────────────────────────┘   │  │
│  │                    │                                │  │
│  │     ┌──────────────▼───────────────────────────┐   │  │
│  │     │ B. Calculate Price                       │   │  │
│  │     │    - Base price per seat                 │   │  │
│  │     │    - Multiply by seats booked            │   │  │
│  │     │    - Add luggage fees (if any)           │   │  │
│  │     │    - Calculate service fee               │   │  │
│  │     └──────────────┬───────────────────────────┘   │  │
│  │                    │                                │  │
│  │     ┌──────────────▼───────────────────────────┐   │  │
│  │     │ C. Create Booking Record                 │   │  │
│  │     │    - Status: PAYMENT_PENDING             │   │  │
│  │     │    - Reserve seats (decrement available) │   │  │
│  │     │    - Store booking details               │   │  │
│  │     └──────────────┬───────────────────────────┘   │  │
│  │                    │                                │  │
│  │                    │ Check BOOKING_PAYMENT_MODE     │  │
│  │                    │                                │  │
│  │     ┌──────────────▼───────────────────────────┐   │  │
│  │     │ D. Payment Mode Decision                 │   │  │
│  │     │                                           │   │  │
│  │     │  If mode = 'bypass':                     │   │  │
│  │     │    → Skip payment                        │   │  │
│  │     │    → Status: DRIVER_PENDING              │   │  │
│  │     │    → Notify driver immediately           │   │  │
│  │     │                                           │   │  │
│  │     │  If mode = 'stripe':                     │   │  │
│  │     │    → Continue to Stripe integration ↓    │   │  │
│  │     └──────────────┬───────────────────────────┘   │  │
│  │                    │                                │  │
│  │     ┌──────────────▼───────────────────────────┐   │  │
│  │     │ E. Create Stripe Payment Intent          │   │  │
│  │     │    (stripe.service.ts)                   │   │  │
│  │     │                                           │   │  │
│  │     │  1. Convert amount to minor units        │   │  │
│  │     │     (e.g., £50.00 → 5000 pence)          │   │  │
│  │     │                                           │   │  │
│  │     │  2. Call Stripe API:                     │   │  │
│  │     │     stripe.paymentIntents.create({       │   │  │
│  │     │       amount: 5000,                      │   │  │
│  │     │       currency: 'gbp',                   │   │  │
│  │     │       metadata: {                        │   │  │
│  │     │         bookingId: 'xxx',                │   │  │
│  │     │         rideId: 'yyy',                   │   │  │
│  │     │         passengerId: 'zzz'               │   │  │
│  │     │       },                                 │   │  │
│  │     │       automatic_payment_methods: true    │   │  │
│  │     │     })                                   │   │  │
│  │     │                                           │   │  │
│  │     │  3. Idempotency key:                     │   │  │
│  │     │     'booking-payment-intent:{bookingId}' │   │  │
│  │     │                                           │   │  │
│  │     │  4. Returns:                             │   │  │
│  │     │     - paymentIntentId                    │   │  │
│  │     │     - clientSecret                       │   │  │
│  │     │     - currency                           │   │  │
│  │     └──────────────┬───────────────────────────┘   │  │
│  │                    │                                │  │
│  │     ┌──────────────▼───────────────────────────┐   │  │
│  │     │ F. Update Booking with Payment Info      │   │  │
│  │     │    - stripePaymentIntentId               │   │  │
│  │     │    - paymentAmount                       │   │  │
│  │     │    - paymentCurrency                     │   │  │
│  │     └──────────────┬───────────────────────────┘   │  │
│  │                    │                                │  │
│  └────────────────────┼────────────────────────────────┘  │
│                       │                                   │
└───────────────────────┼───────────────────────────────────┘
                        │
                        │ Return Response
                        ↓
┌───────────────────────────────────────────────────────────┐
│  Response to Frontend                                     │
│  {                                                        │
│    "success": true,                                       │
│    "message": "Booking created, payment required",        │
│    "data": {                                              │
│      "booking": {                                         │
│        "id": "booking-uuid",                              │
│        "status": "PAYMENT_PENDING",                       │
│        "totalPrice": 50.00,                               │
│        "seatsBooked": 2                                   │
│      },                                                   │
│      "payment": {                                         │
│        "provider": "stripe",                              │
│        "paymentIntentId": "pi_xxx",                       │
│        "clientSecret": "pi_xxx_secret_yyy",               │
│        "currency": "GBP"                                  │
│      }                                                    │
│    }                                                      │
│  }                                                        │
└───────────────────────┬───────────────────────────────────┘
                        │
                        │ Frontend receives response
                        ↓
┌───────────────────────────────────────────────────────────┐
│  Frontend Payment Flow (Stripe.js)                       │
│                                                           │
│  1. Initialize Stripe with publishable key               │
│     const stripe = Stripe('pk_test_...')                 │
│                                                           │
│  2. Confirm payment with client secret                   │
│     stripe.confirmPayment({                              │
│       clientSecret: payment.clientSecret,                │
│       confirmParams: {                                   │
│         return_url: 'https://app.com/success'            │
│       }                                                  │
│     })                                                   │
│                                                           │
│  3. Stripe handles payment UI                            │
│     - Card input                                         │
│     - 3D Secure authentication                           │
│     - Payment processing                                 │
└───────────────────────┬───────────────────────────────────┘
                        │
                        │ Payment processed by Stripe
                        ↓
┌───────────────────────────────────────────────────────────┐
│  Stripe Webhook (Async)                                  │
│                                                           │
│  POST /api/v1/payments/stripe/webhook                    │
│  Event: payment_intent.succeeded                         │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 1. Verify Webhook Signature                         │ │
│  │    - Check stripe-signature header                  │ │
│  │    - Validate with webhook secret                   │ │
│  └─────────────────┬───────────────────────────────────┘ │
│                    │                                     │
│  ┌─────────────────▼───────────────────────────────────┐ │
│  │ 2. Check for Duplicate Event                        │ │
│  │    - Query StripeWebhookEvent table                 │ │
│  │    - If exists, return { duplicate: true }          │ │
│  └─────────────────┬───────────────────────────────────┘ │
│                    │                                     │
│  ┌─────────────────▼───────────────────────────────────┐ │
│  │ 3. Store Webhook Event                              │ │
│  │    - Save to StripeWebhookEvent table               │ │
│  │    - Prevent duplicate processing                   │ │
│  └─────────────────┬───────────────────────────────────┘ │
│                    │                                     │
│  ┌─────────────────▼───────────────────────────────────┐ │
│  │ 4. Process Payment Success                          │ │
│  │    - Extract bookingId from metadata                │ │
│  │    - Update booking:                                │ │
│  │      * Status: DRIVER_PENDING                       │ │
│  │      * stripePaymentIntentId                        │ │
│  │      * stripeChargeId                               │ │
│  │      * paymentAmount                                │ │
│  │      * paymentCapturedAt                            │ │
│  │      * driverDecisionDeadlineAt (+30 min)           │ │
│  └─────────────────┬───────────────────────────────────┘ │
│                    │                                     │
│  ┌─────────────────▼───────────────────────────────────┐ │
│  │ 5. Notify Driver                                    │ │
│  │    - Create notification                            │ │
│  │    - Type: booking.request.driver_decision          │ │
│  │    - Include booking details                        │ │
│  │    - Send push notification                         │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
└───────────────────────┬───────────────────────────────────┘
                        │
                        │ Driver receives notification
                        ↓
┌───────────────────────────────────────────────────────────┐
│  Driver Decision (30-minute window)                       │
│                                                           │
│  Option 1: Driver Accepts                                │
│    POST /api/v1/driver/bookings/{id}/accept              │
│    → Status: CONFIRMED                                   │
│    → Generate pickup/drop OTPs                           │
│    → Notify passenger                                    │
│                                                           │
│  Option 2: Driver Rejects                                │
│    POST /api/v1/driver/bookings/{id}/reject              │
│    → Status: CANCELLED                                   │
│    → Initiate full refund                                │
│    → Notify passenger                                    │
│                                                           │
│  Option 3: Timeout (30 min expires)                      │
│    Cron job checks expired bookings                      │
│    → Status: CANCELLED                                   │
│    → Initiate full refund                                │
│    → Notify passenger                                    │
└───────────────────────────────────────────────────────────┘
```

---

## Detailed Code Flow

### 1. Route Definition
**File**: `src/modules/ride-booking/ride-booking.routes.ts`

```typescript
router.post(
    '/',
    validate({ body: createBookingSchema }),
    controller.createBooking
);
```

**What happens:**
- Request validation using Zod schema
- Calls controller if validation passes

---

### 2. Controller Layer
**File**: `src/modules/ride-booking/ride-booking.controller.ts`

```typescript
export const createBooking = async (req: AuthRequest, res: Response) => {
    try {
        // Call service layer
        const booking = await BookingService.createBooking(
            req.user.id,  // Passenger ID from JWT
            req.body      // { rideId, seatsBooked, ... }
        );

        // Invalidate caches
        await deleteCache(cacheKeys.userBookings(req.user.id));
        await deleteCache(cacheKeys.ride(req.body.rideId));

        // Return success response
        return sendSuccess(res, {
            status: HttpStatus.CREATED,
            message: 'Booking created, payment required',
            data: booking,
        });
    } catch (error: any) {
        // Error handling
        // Maps service errors to HTTP status codes
    }
};
```

---

### 3. Service Layer - Main Flow
**File**: `src/modules/ride-booking/ride-booking.service.ts`

```typescript
export const createBooking = async (
    passengerId: string,
    input: CreateBookingInput
) => {
    // STEP 1: Validate ride and availability
    const ride = await validateRideForBooking(passengerId, input);
    
    // STEP 2: Calculate price
    const priceBreakdown = calculateBookingPrice(ride, input);
    
    // STEP 3: Create booking record
    const booking = await prisma.rideBooking.create({
        data: {
            passengerId,
            rideId: input.rideId,
            seatsBooked: input.seatsBooked,
            totalPrice: priceBreakdown.totalPrice,
            status: bypassPayment 
                ? BookingStatus.DRIVER_PENDING 
                : BookingStatus.PAYMENT_PENDING,
            // ... other fields
        }
    });
    
    // STEP 4: Reserve seats
    await prisma.ride.update({
        where: { id: input.rideId },
        data: {
            availableSeats: { decrement: input.seatsBooked }
        }
    });
    
    // STEP 5: Check payment mode
    const paymentMode = process.env.BOOKING_PAYMENT_MODE;
    
    if (paymentMode === 'bypass') {
        // Skip payment, notify driver immediately
        await notifyDriverOfBooking(booking);
        return { booking, payment: null };
    }
    
    // STEP 6: Create Stripe Payment Intent
    const paymentIntent = await createBookingPaymentIntent({
        bookingId: booking.id,
        rideId: booking.rideId,
        passengerId,
        amountMajor: priceBreakdown.totalPrice,
        currency: ride.currency
    });
    
    // STEP 7: Update booking with payment info
    await prisma.rideBooking.update({
        where: { id: booking.id },
        data: {
            stripePaymentIntentId: paymentIntent.paymentIntentId,
            paymentAmount: priceBreakdown.totalPrice,
            paymentCurrency: paymentIntent.currency
        }
    });
    
    // STEP 8: Return booking with payment details
    return {
        booking: {
            id: booking.id,
            status: booking.status,
            totalPrice: booking.totalPrice,
            seatsBooked: booking.seatsBooked
        },
        payment: {
            provider: 'stripe',
            paymentIntentId: paymentIntent.paymentIntentId,
            clientSecret: paymentIntent.clientSecret,
            currency: paymentIntent.currency
        }
    };
};
```

---

### 4. Stripe Payment Intent Creation
**File**: `src/modules/payments/stripe.service.ts`

```typescript
export const createBookingPaymentIntent = async (
    input: CreatePaymentIntentInput
): Promise<CreatePaymentIntentResult> => {
    const stripe = getStripeClient();
    
    // Convert £50.00 to 5000 pence
    const amountMinor = toMinorUnits(input.amountMajor);
    
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create(
        {
            amount: amountMinor,
            currency: input.currency.toLowerCase(),
            metadata: {
                bookingId: input.bookingId,
                rideId: input.rideId,
                passengerId: input.passengerId
            },
            automatic_payment_methods: { enabled: true }
        },
        {
            // Prevent duplicate payment intents
            idempotencyKey: `booking-payment-intent:${input.bookingId}`
        }
    );
    
    return {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret!,
        currency: paymentIntent.currency.toUpperCase()
    };
};
```

---

### 5. Frontend Payment Confirmation

```javascript
// Frontend receives response from POST /api/v1/bookings
const response = await fetch('/api/v1/bookings', {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        rideId: 'ride-123',
        seatsBooked: 2
    })
});

const { booking, payment } = await response.json();

// Initialize Stripe
const stripe = Stripe('pk_test_...');

// Confirm payment
const { error } = await stripe.confirmPayment({
    clientSecret: payment.clientSecret,
    confirmParams: {
        return_url: 'https://app.com/booking-success'
    }
});

if (error) {
    // Payment failed
    console.error(error.message);
} else {
    // Payment succeeded
    // Webhook will update booking status
    // Redirect to success page
}
```

---

### 6. Webhook Processing
**File**: `src/modules/payments/stripe.webhook.controller.ts`

```typescript
export const handleStripeWebhook = async (req: Request, res: Response) => {
    // 1. Verify signature
    const signature = req.headers['stripe-signature'];
    const event = constructStripeEvent(req.body, signature);
    
    // 2. Check for duplicate
    const existing = await prisma.stripeWebhookEvent.findUnique({
        where: { stripeEventId: event.id }
    });
    if (existing) {
        return res.json({ received: true, duplicate: true });
    }
    
    // 3. Store event
    await prisma.stripeWebhookEvent.create({
        data: {
            stripeEventId: event.id,
            eventType: event.type,
            payload: event
        }
    });
    
    // 4. Process event
    if (event.type === 'payment_intent.succeeded') {
        await applyPaymentIntentSucceeded(event.data.object);
    }
    
    return res.json({ received: true });
};

const applyPaymentIntentSucceeded = async (intent: PaymentIntent) => {
    const bookingId = intent.metadata.bookingId;
    
    // Update booking
    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.DRIVER_PENDING,
            stripePaymentIntentId: intent.id,
            stripeChargeId: intent.latest_charge,
            paymentAmount: intent.amount_received / 100,
            paymentCapturedAt: new Date(),
            driverDecisionDeadlineAt: new Date(Date.now() + 30 * 60 * 1000)
        }
    });
    
    // Notify driver
    await createNotification({
        userId: ride.driverId,
        type: 'booking.request.driver_decision',
        title: 'New ride request',
        body: `${passenger.name} wants to book your ride`,
        data: { bookingId, rideId, ... }
    });
};
```

---

## Request/Response Examples

### Request
```http
POST /api/v1/bookings HTTP/1.1
Host: localhost:3000
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "rideId": "ride-uuid-123",
  "seatsBooked": 2,
  "pickupWaypointId": "waypoint-uuid-456",
  "dropoffWaypointId": null
}
```

### Response (Stripe Mode)
```json
{
  "success": true,
  "message": "Booking created, payment required",
  "data": {
    "booking": {
      "id": "booking-uuid-789",
      "rideId": "ride-uuid-123",
      "passengerId": "user-uuid-abc",
      "seatsBooked": 2,
      "totalPrice": 50.00,
      "status": "PAYMENT_PENDING",
      "createdAt": "2026-04-29T10:00:00.000Z"
    },
    "payment": {
      "provider": "stripe",
      "paymentIntentId": "pi_3MtwBwLkdIwHu7ix28a3tqPa",
      "clientSecret": "pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH",
      "currency": "GBP"
    }
  }
}
```

### Response (Bypass Mode)
```json
{
  "success": true,
  "message": "Booking created, payment required",
  "data": {
    "booking": {
      "id": "booking-uuid-789",
      "status": "DRIVER_PENDING",
      "totalPrice": 50.00
    },
    "payment": null
  }
}
```

---

## Summary

### Key Points:
1. **Route** validates request and calls controller
2. **Controller** calls service and handles errors
3. **Service** validates, calculates price, creates booking
4. **Payment Mode** determines if Stripe is used
5. **Stripe Integration** creates payment intent with metadata
6. **Frontend** confirms payment with Stripe.js
7. **Webhook** updates booking status asynchronously
8. **Driver** gets notified when payment succeeds

### Payment Flow States:
```
PAYMENT_PENDING → (payment succeeds) → DRIVER_PENDING → (driver accepts) → CONFIRMED
```

### Environment Variables:
```bash
BOOKING_PAYMENT_MODE=stripe  # or 'bypass'
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```
