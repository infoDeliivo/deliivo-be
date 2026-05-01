# Payment Feature Analysis - Carpooling Application

## Overview
The application uses **Stripe** as the payment provider with a comprehensive payment flow including payment intents, webhooks, refunds, and driver decision windows.

---

## Architecture

### Payment Provider
- **Provider**: Stripe
- **Integration Type**: Payment Intents API
- **Default Currency**: INR (Indian Rupees)
- **Supported Features**:
  - Payment capture
  - Automatic payment methods
  - Webhooks for real-time updates
  - Refunds (full and partial)
  - Idempotency for duplicate prevention

---

## Payment Flow

### 1. Booking Creation
```
Passenger creates booking
    ↓
Status: PAYMENT_PENDING
    ↓
Create Stripe Payment Intent
    ↓
Return client secret to frontend
    ↓
Frontend handles payment with Stripe.js
```

### 2. Payment Success (via Webhook)
```
Stripe sends payment_intent.succeeded webhook
    ↓
Update booking status: DRIVER_PENDING
    ↓
Set driver decision deadline (30 minutes)
    ↓
Notify driver of new booking request
    ↓
Driver accepts/rejects within 30 minutes
```

### 3. Payment Failure (via Webhook)
```
Stripe sends payment_intent.payment_failed webhook
    ↓
Update booking status: PAYMENT_FAILED
    ↓
Release reserved seats back to ride
```

---

## Key Components

### 1. Payment Service (`src/modules/payments/stripe.service.ts`)

#### Functions:

**`createBookingPaymentIntent()`**
- Creates Stripe Payment Intent
- Converts amount to minor units (cents/paise)
- Attaches metadata (bookingId, rideId, passengerId)
- Enables automatic payment methods
- Uses idempotency key to prevent duplicates

**`refundPaymentIntent()`**
- Creates refund for a payment intent
- Supports full or partial refunds
- Used for booking cancellations

**`constructStripeEvent()`**
- Validates webhook signature
- Constructs Stripe event from webhook payload
- Ensures webhook authenticity

---

### 2. Webhook Controller (`src/modules/payments/stripe.webhook.controller.ts`)

#### Webhook Events Handled:

1. **`payment_intent.succeeded`**
   - Updates booking status to DRIVER_PENDING
   - Records payment details (amount, currency, charge ID)
   - Sets driver decision deadline (30 minutes)
   - Sends notification to driver

2. **`payment_intent.payment_failed`**
   - Updates booking status to PAYMENT_FAILED
   - Releases reserved seats back to ride

3. **`charge.refunded`**
   - Records refund details
   - Updates refund amount and timestamp

4. **`refund.created` / `refund.updated`**
   - Tracks refund status
   - Updates refund information

#### Security Features:
- Signature verification
- Duplicate event detection (via stripeEventId)
- Idempotent processing

---

### 3. Booking Service Integration

#### Payment Mode Configuration
```typescript
// Environment variable
BOOKING_PAYMENT_MODE = 'stripe' | 'bypass'
```

**Stripe Mode:**
- Creates payment intent
- Status: PAYMENT_PENDING
- Requires payment before driver notification

**Bypass Mode:**
- Skips payment
- Status: DRIVER_PENDING
- Immediately notifies driver
- Used for testing/development

---

## Database Schema

### Booking Payment Fields
```prisma
model RideBooking {
  // Payment tracking
  stripePaymentIntentId   String?
  stripeChargeId          String?
  paymentAmount           Float?
  paymentCurrency         String?
  paymentCapturedAt       DateTime?
  
  // Refund tracking
  refundId                String?
  refundedAt              DateTime?
  refundAmount            Float?
  refundPercent           Float?
  
  // Driver decision
  driverDecisionDeadlineAt DateTime?
  driverDecisionAt        DateTime?
}
```

### Webhook Event Tracking
```prisma
model StripeWebhookEvent {
  id              String   @id @default(uuid())
  stripeEventId   String   @unique
  eventType       String
  paymentIntentId String?
  processedAt     DateTime @default(now())
  payload         Json?
}
```

---

## Booking Status Flow

```
PAYMENT_PENDING
    ↓ (payment succeeds)
DRIVER_PENDING
    ↓ (driver accepts)
CONFIRMED
    ↓ (ride starts)
IN_PROGRESS
    ↓ (ride completes)
COMPLETED

Alternative flows:
PAYMENT_PENDING → PAYMENT_FAILED (payment fails)
DRIVER_PENDING → CANCELLED (driver rejects or timeout)
CONFIRMED → CANCELLED (cancellation before ride)
```

---

## Refund Policy

### Passenger Cancellation
Refund percentage based on time before departure:

| Time Before Departure | Refund % |
|----------------------|----------|
| > 24 hours           | 100%     |
| 12-24 hours          | 75%      |
| 6-12 hours           | 50%      |
| 3-6 hours            | 25%      |
| < 3 hours            | 0%       |

### Driver Cancellation
- **Before acceptance**: Full refund (100%)
- **After acceptance**: Full refund (100%) + driver penalty

### Automatic Refunds
- Driver doesn't respond within 30 minutes: Full refund
- Payment fails: No charge (seats released)

---

## Configuration

### Environment Variables Required

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Payment Mode
BOOKING_PAYMENT_MODE=stripe  # or 'bypass' for testing
```

---

## API Endpoints

### 1. Create Booking (with Payment)
```
POST /api/v1/bookings
```

**Request:**
```json
{
  "rideId": "ride-uuid",
  "seatsBooked": 2,
  "pickupWaypointId": "waypoint-uuid",
  "dropoffWaypointId": "waypoint-uuid"
}
```

**Response (Stripe Mode):**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": "booking-uuid",
      "status": "PAYMENT_PENDING",
      "totalPrice": 50.00
    },
    "payment": {
      "provider": "stripe",
      "paymentIntentId": "pi_xxx",
      "clientSecret": "pi_xxx_secret_yyy",
      "currency": "GBP"
    }
  }
}
```

### 2. Stripe Webhook
```
POST /api/v1/payments/stripe/webhook
```

**Headers:**
```
stripe-signature: t=xxx,v1=yyy
Content-Type: application/json
```

**Response:**
```json
{
  "received": true
}
```

---

## Frontend Integration

### Payment Flow (Frontend)

```javascript
// 1. Create booking
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

// 2. Initialize Stripe
const stripe = Stripe('pk_test_...');

// 3. Confirm payment
const { error } = await stripe.confirmPayment({
  clientSecret: payment.clientSecret,
  confirmParams: {
    return_url: 'https://app.com/booking-success'
  }
});

// 4. Handle result
if (error) {
  // Payment failed
  console.error(error.message);
} else {
  // Payment succeeded (webhook will update booking)
  // Redirect to success page
}
```

---

## Security Features

### 1. Webhook Signature Verification
```typescript
const event = constructStripeEvent(payload, signature);
// Throws error if signature is invalid
```

### 2. Duplicate Event Prevention
```typescript
// Check if event already processed
const existing = await prisma.stripeWebhookEvent.findUnique({
  where: { stripeEventId: event.id }
});
if (existing) {
  return { received: true, duplicate: true };
}
```

### 3. Idempotency Keys
```typescript
// Prevent duplicate payment intents
idempotencyKey: `booking-payment-intent:${bookingId}`
```

### 4. Amount Validation
```typescript
const toMinorUnits = (amountMajor: number): number => {
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    throw new Error('INVALID_PAYMENT_AMOUNT');
  }
  return Math.round(amountMajor * 100);
};
```

---

## Error Handling

### Payment Errors

| Error | Cause | Action |
|-------|-------|--------|
| STRIPE_SECRET_KEY_MISSING | Missing env variable | Check .env file |
| STRIPE_WEBHOOK_SECRET_MISSING | Missing webhook secret | Configure in Stripe dashboard |
| INVALID_PAYMENT_AMOUNT | Amount <= 0 or invalid | Validate booking price |
| STRIPE_CLIENT_SECRET_MISSING | Payment intent creation failed | Check Stripe logs |
| Invalid signature | Webhook signature mismatch | Verify webhook secret |

---

## Testing

### Test Mode Configuration
```bash
# Use Stripe test keys
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_test_...

# Or bypass payment entirely
BOOKING_PAYMENT_MODE=bypass
```

### Test Cards (Stripe)
```
Success: 4242 4242 4242 4242
Decline: 4000 0000 0000 0002
Insufficient funds: 4000 0000 0000 9995
```

### Webhook Testing
```bash
# Install Stripe CLI
stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook

# Trigger test events
stripe trigger payment_intent.succeeded
stripe trigger payment_intent.payment_failed
```

---

## Monitoring & Logging

### Key Metrics to Track
1. **Payment Success Rate**: % of successful payments
2. **Payment Failure Rate**: % of failed payments
3. **Refund Rate**: % of bookings refunded
4. **Average Refund Amount**: Average refund per booking
5. **Driver Response Time**: Time to accept/reject
6. **Timeout Rate**: % of bookings that timeout

### Webhook Event Logs
All webhook events are stored in `StripeWebhookEvent` table:
- Event ID (for deduplication)
- Event type
- Payment intent ID
- Full payload (for debugging)
- Processed timestamp

---

## Known Issues & Limitations

### Current Limitations
1. **Single Currency per Ride**: Each ride has one currency
2. **No Multi-Currency Support**: Passengers pay in ride's currency
3. **No Payment Method Storage**: No saved cards/payment methods
4. **No Subscription Support**: One-time payments only
5. **No Split Payments**: Cannot split payment across multiple methods

### Future Enhancements
- [ ] Multi-currency support
- [ ] Save payment methods for faster checkout
- [ ] Apple Pay / Google Pay integration
- [ ] Payment method management
- [ ] Subscription for frequent riders
- [ ] Split payments
- [ ] Promotional codes / discounts
- [ ] Dynamic pricing based on demand

---

## Troubleshooting

### Payment Not Processing
1. Check Stripe dashboard for payment intent status
2. Verify webhook is receiving events
3. Check `StripeWebhookEvent` table for processed events
4. Review application logs for errors

### Webhook Not Working
1. Verify webhook secret in environment variables
2. Check Stripe dashboard webhook logs
3. Ensure webhook URL is accessible (not localhost in production)
4. Verify signature validation is working

### Refund Issues
1. Check if payment was captured
2. Verify refund amount calculation
3. Check Stripe dashboard for refund status
4. Review refund policy logic

---

## Summary

### ✅ Implemented Features
- ✅ Stripe Payment Intents integration
- ✅ Webhook handling (payment success/failure)
- ✅ Automatic refunds on cancellation
- ✅ Driver decision window (30 minutes)
- ✅ Duplicate event prevention
- ✅ Idempotent payment creation
- ✅ Refund policy based on cancellation time
- ✅ Payment tracking in database
- ✅ Webhook event logging

### 🔒 Security Features
- ✅ Webhook signature verification
- ✅ Idempotency keys
- ✅ Amount validation
- ✅ Duplicate prevention
- ✅ Secure environment variable handling

### 📊 Status
**Production Ready**: Yes, with proper Stripe account configuration

**Test Mode Available**: Yes, via `BOOKING_PAYMENT_MODE=bypass`

**Documentation**: Complete

---

## Quick Reference

### Payment Flow Summary
```
1. Passenger creates booking → PAYMENT_PENDING
2. Frontend confirms payment with Stripe
3. Webhook updates booking → DRIVER_PENDING
4. Driver accepts within 30 min → CONFIRMED
5. Ride completes → COMPLETED
```

### Key Constants
- Driver decision window: **30 minutes**
- Default currency: **INR**
- Refund calculation: **Time-based percentage**
- Webhook events tracked: **4 types**

### Environment Setup
```bash
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
BOOKING_PAYMENT_MODE=stripe
```
