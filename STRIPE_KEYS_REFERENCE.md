# Stripe Keys Reference

## Your Stripe Keys

### Publishable Key (Frontend)
```
pk_test_51TA5TI8tCboslOE2E580Tl94tNPWP3TDt4jztXgw1KnpYuW4aGbvgDuHPQDWc0ZSPhyQqTcsktAatvXbayYD4Dmb00vgmdskGL
```

**Use in**: Frontend JavaScript/React/Mobile app

**Example:**
```javascript
const stripe = Stripe('pk_test_51TA5TI8tCboslOE2E580Tl94tNPWP3TDt4jztXgw1KnpYuW4aGbvgDuHPQDWc0ZSPhyQqTcsktAatvXbayYD4Dmb00vgmdskGL');
```

---

### Secret Key (Backend) ✅ Updated
```
sk_test_51TA5TI8tCboslOE27i0qYb8h4GYZYzR276wl5Db36KEsIiZ7yHpt4844nGMFGRPWcyxI9jzinXJRWdU3IO4QmQUl00dHNE23XH
```

**Use in**: Backend `.env` file (already updated)

**Location**: `.env` file
```bash
STRIPE_SECRET_KEY=sk_test_51TA5TI8tCboslOE27i0qYb8h4GYZYzR276wl5Db36KEsIiZ7yHpt4844nGMFGRPWcyxI9jzinXJRWdU3IO4QmQUl00dHNE23XH
```

---

## ⚠️ Still Need: Webhook Secret

You still need to get your webhook signing secret from Stripe Dashboard.

### How to Get Webhook Secret:

1. **Go to Stripe Dashboard**
   - Visit: https://dashboard.stripe.com/test/webhooks

2. **Add Endpoint**
   - Click "Add endpoint"
   - Endpoint URL: `https://your-domain.com/api/v1/payments/stripe/webhook`
   - Or for local testing: Use Stripe CLI (see below)

3. **Select Events**
   Select these events:
   - ✅ `payment_intent.succeeded`
   - ✅ `payment_intent.payment_failed`
   - ✅ `charge.refunded`
   - ✅ `refund.created`
   - ✅ `refund.updated`

4. **Get Signing Secret**
   - After creating webhook, click "Reveal" under "Signing secret"
   - Copy the secret (starts with `whsec_`)
   - Update in `.env`:
     ```bash
     STRIPE_WEBHOOK_SECRET=whsec_your_actual_secret_here
     ```

---

## Local Development Setup

### Option 1: Stripe CLI (Recommended)

```bash
# Install Stripe CLI
# macOS: brew install stripe/stripe-cli/stripe
# Windows: scoop install stripe
# Linux: Download from https://github.com/stripe/stripe-cli/releases

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook
```

This will output:
```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx
```

Copy that secret and update `.env`:
```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

### Option 2: ngrok + Stripe Dashboard

```bash
# Install ngrok
# Download from https://ngrok.com/download

# Start ngrok
ngrok http 3000

# Use the HTTPS URL in Stripe Dashboard
# Example: https://abc123.ngrok.io/api/v1/payments/stripe/webhook
```

---

## Current Configuration Status

### ✅ Completed
- [x] Publishable key identified
- [x] Secret key updated in `.env`
- [x] Payment mode set to `stripe`

### ⏳ Pending
- [ ] Webhook secret needs to be added
- [ ] Server needs to be restarted

---

## Testing Payment Flow

### 1. Restart Server
```bash
npm run dev
```

### 2. Create Booking
```bash
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rideId": "ride-uuid",
    "seatsBooked": 2
  }'
```

### 3. Expected Response
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

### 4. Frontend Payment Confirmation
```javascript
// Initialize Stripe with your publishable key
const stripe = Stripe('pk_test_51TA5TI8tCboslOE2E580Tl94tNPWP3TDt4jztXgw1KnpYuW4aGbvgDuHPQDWc0ZSPhyQqTcsktAatvXbayYD4Dmb00vgmdskGL');

// Confirm payment
const { error } = await stripe.confirmPayment({
    clientSecret: payment.clientSecret,
    confirmParams: {
        return_url: 'https://your-app.com/booking-success'
    }
});

if (error) {
    console.error('Payment failed:', error.message);
} else {
    console.log('Payment succeeded!');
}
```

---

## Test Cards

Use these test cards in Stripe test mode:

| Card Number | Result |
|-------------|--------|
| 4242 4242 4242 4242 | Success |
| 4000 0000 0000 0002 | Card declined |
| 4000 0000 0000 9995 | Insufficient funds |
| 4000 0025 0000 3155 | Requires 3D Secure |

**Expiry**: Any future date (e.g., 12/25)  
**CVC**: Any 3 digits (e.g., 123)  
**ZIP**: Any 5 digits (e.g., 12345)

---

## Stripe Dashboard Links

- **Test Dashboard**: https://dashboard.stripe.com/test/dashboard
- **Webhooks**: https://dashboard.stripe.com/test/webhooks
- **Payments**: https://dashboard.stripe.com/test/payments
- **Logs**: https://dashboard.stripe.com/test/logs

---

## Security Notes

⚠️ **Never commit these keys to Git!**

Your `.env` file should be in `.gitignore`:
```
.env
.env.local
.env.*.local
```

⚠️ **Never expose secret key in frontend!**

- ✅ Publishable key (`pk_test_...`) → Safe for frontend
- ❌ Secret key (`sk_test_...`) → Backend only, never expose

---

## Summary

### Current Status:
✅ **Secret key updated** in `.env`  
✅ **Payment mode set to Stripe**  
⏳ **Webhook secret pending** (get from Stripe Dashboard or CLI)  
⏳ **Server restart needed**

### Next Steps:
1. Get webhook secret (Stripe CLI or Dashboard)
2. Update `STRIPE_WEBHOOK_SECRET` in `.env`
3. Restart server: `npm run dev`
4. Test booking creation
5. Test payment with test card

Your Stripe integration is almost ready! Just need the webhook secret and a server restart. 🚀
