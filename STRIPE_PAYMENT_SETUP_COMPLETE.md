# ✅ Stripe Payment Mode - Setup Complete

## Configuration Updated

Your `.env` file has been updated to use **Stripe payment mode** instead of bypass.

---

## Changes Made

### Added to `.env`:
```bash
BOOKING_PAYMENT_MODE=stripe
```

This ensures that all bookings will require Stripe payment processing.

---

## Current Stripe Configuration

```bash
# Stripe Payment Configuration
STRIPE_SECRET_KEY=sk_test_51TAaCFFXatlDaxiew8fLJ5IW9zjYaklc0GKujVfF1FsWwASdKr4CjrRXwdZsaGmZh0QDUsXsgmccwwqT166whG8R00t1DHqjbH
STRIPE_WEBHOOK_SECRET=whsec_replace_me
BOOKING_PAYMENT_MODE=stripe
```

---

## ⚠️ Important: Update Webhook Secret

Your webhook secret is currently set to `whsec_replace_me`. You need to update this with your actual Stripe webhook secret.

### How to Get Your Webhook Secret:

1. **Go to Stripe Dashboard**
   - Visit: https://dashboard.stripe.com/test/webhooks

2. **Create or Select Webhook**
   - Click "Add endpoint" or select existing webhook
   - Endpoint URL: `https://your-domain.com/api/v1/payments/stripe/webhook`

3. **Select Events to Listen**
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `refund.created`
   - `refund.updated`

4. **Get Signing Secret**
   - After creating webhook, click "Reveal" under "Signing secret"
   - Copy the secret (starts with `whsec_`)

5. **Update .env**
   ```bash
   STRIPE_WEBHOOK_SECRET=whsec_your_actual_secret_here
   ```

---

## Testing Locally with Stripe CLI

For local development, use Stripe CLI to forward webhooks:

### 1. Install Stripe CLI
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Windows
scoop install stripe

# Linux
# Download from https://github.com/stripe/stripe-cli/releases
```

### 2. Login to Stripe
```bash
stripe login
```

### 3. Forward Webhooks to Local Server
```bash
stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook
```

This will output a webhook signing secret like:
```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx
```

### 4. Update .env with Local Secret
```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

### 5. Test Payment Events
In another terminal:
```bash
# Trigger successful payment
stripe trigger payment_intent.succeeded

# Trigger failed payment
stripe trigger payment_intent.payment_failed
```

---

## How Booking Flow Works Now

### 1. Create Booking
```bash
POST /api/v1/bookings
{
  "rideId": "ride-uuid",
  "seatsBooked": 2
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking created, payment required",
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

### 2. Frontend Confirms Payment
```javascript
const stripe = Stripe('pk_test_...');
await stripe.confirmPayment({
    clientSecret: payment.clientSecret,
    confirmParams: {
        return_url: 'https://app.com/success'
    }
});
```

### 3. Webhook Updates Booking
- Stripe sends `payment_intent.succeeded` webhook
- Backend updates booking status to `DRIVER_PENDING`
- Driver receives notification
- Driver has 30 minutes to accept/reject

---

## Payment Status Flow

```
PAYMENT_PENDING
    ↓ (payment succeeds via webhook)
DRIVER_PENDING
    ↓ (driver accepts)
CONFIRMED
    ↓ (ride starts)
IN_PROGRESS
    ↓ (ride completes)
COMPLETED
```

---

## Test Cards

Use these test cards in Stripe test mode:

| Card Number | Description |
|-------------|-------------|
| 4242 4242 4242 4242 | Success |
| 4000 0000 0000 0002 | Card declined |
| 4000 0000 0000 9995 | Insufficient funds |
| 4000 0025 0000 3155 | Requires authentication (3D Secure) |

**Expiry**: Any future date  
**CVC**: Any 3 digits  
**ZIP**: Any 5 digits

---

## Restart Server

After updating `.env`, restart your server for changes to take effect:

```bash
# Stop server (Ctrl+C)
# Then restart
npm run dev
```

---

## Verify Configuration

### Check Payment Mode
```bash
# In your code, this will now return 'stripe'
process.env.BOOKING_PAYMENT_MODE
```

### Test Booking Creation
```bash
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rideId": "ride-uuid",
    "seatsBooked": 2
  }'
```

**Expected**: Response includes `payment` object with `clientSecret`

---

## Switching Between Modes

### Use Stripe (Production/Testing)
```bash
BOOKING_PAYMENT_MODE=stripe
```

### Use Bypass (Development Only)
```bash
BOOKING_PAYMENT_MODE=bypass
```

---

## Troubleshooting

### Issue: Bookings Skip Payment
**Cause**: `BOOKING_PAYMENT_MODE` not set or set to `bypass`  
**Solution**: Ensure `.env` has `BOOKING_PAYMENT_MODE=stripe`

### Issue: Webhook Not Working
**Cause**: Invalid webhook secret  
**Solution**: Update `STRIPE_WEBHOOK_SECRET` with actual secret from Stripe dashboard

### Issue: Payment Intent Creation Fails
**Cause**: Invalid Stripe secret key  
**Solution**: Verify `STRIPE_SECRET_KEY` is correct and starts with `sk_test_` or `sk_live_`

### Issue: Webhook Signature Verification Fails
**Cause**: Webhook secret mismatch  
**Solution**: 
- For local: Use secret from `stripe listen` command
- For production: Use secret from Stripe dashboard webhook settings

---

## Production Checklist

Before going to production:

- [ ] Replace test Stripe key with live key (`sk_live_...`)
- [ ] Update webhook secret with production webhook secret
- [ ] Set up production webhook endpoint in Stripe dashboard
- [ ] Test payment flow end-to-end
- [ ] Verify webhook events are being received
- [ ] Test refund flow
- [ ] Monitor Stripe dashboard for errors

---

## Summary

✅ **Payment mode set to Stripe**  
✅ **Booking flow will require payment**  
✅ **Webhooks will update booking status**  
⚠️ **Update webhook secret before testing**  
⚠️ **Restart server for changes to take effect**

---

## Next Steps

1. **Update webhook secret** in `.env`
2. **Restart server**: `npm run dev`
3. **Test booking creation** with Stripe test card
4. **Verify webhook processing** with Stripe CLI
5. **Monitor Stripe dashboard** for payment events

Your payment system is now configured to use Stripe! 🎉
