/**
 * Payment Test Helper
 * Simulates Stripe webhook events for E2E tests
 */
import axios from 'axios';
import crypto from 'crypto';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3001';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';

/**
 * Generate Stripe webhook signature
 * This mimics Stripe's signature verification process
 */
function generateStripeSignature(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Send Stripe webhook event to the server
 */
async function sendStripeWebhook(event: any): Promise<any> {
  const payload = JSON.stringify(event);
  const signature = generateStripeSignature(payload, WEBHOOK_SECRET);
  
  try {
    const response = await axios.post(
      `${BASE_URL}/api/v1/payments/webhook`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signature,
        },
        validateStatus: () => true, // Don't throw on any status
      }
    );
    
    return response;
  } catch (error: any) {
    console.error('[Payment Helper] Webhook error:', error.message);
    throw error;
  }
}

/**
 * Simulate successful payment
 * Triggers payment_intent.succeeded webhook
 */
export async function simulateSuccessfulPayment(params: {
  bookingId: string;
  paymentIntentId?: string;
  amount: number; // in major units (e.g., 25.50)
  currency?: string;
}): Promise<any> {
  const {
    bookingId,
    paymentIntentId = `pi_test_${Date.now()}`,
    amount,
    currency = 'gbp',
  } = params;

  // Convert to minor units (cents/pence)
  const amountMinor = Math.round(amount * 100);

  const event = {
    id: `evt_${Date.now()}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: paymentIntentId,
        object: 'payment_intent',
        amount: amountMinor,
        amount_received: amountMinor,
        currency: currency.toLowerCase(),
        status: 'succeeded',
        metadata: {
          bookingId: bookingId,
        },
        latest_charge: `ch_test_${Date.now()}`,
        charges: {
          data: [
            {
              id: `ch_test_${Date.now()}`,
              amount: amountMinor,
              currency: currency.toLowerCase(),
              status: 'succeeded',
              paid: true,
            },
          ],
        },
      },
    },
  };

  console.log(`[Payment Helper] Simulating successful payment for booking ${bookingId}`);
  const response = await sendStripeWebhook(event);
  
  if (response.status === 200) {
    console.log(`[Payment Helper] ✓ Payment webhook processed successfully`);
  } else {
    console.warn(`[Payment Helper] ⚠ Webhook returned ${response.status}: ${JSON.stringify(response.data)}`);
  }
  
  return response;
}

/**
 * Simulate failed payment
 * Triggers payment_intent.payment_failed webhook
 */
export async function simulateFailedPayment(params: {
  bookingId: string;
  paymentIntentId?: string;
  amount: number;
  currency?: string;
  failureReason?: string;
}): Promise<any> {
  const {
    bookingId,
    paymentIntentId = `pi_test_${Date.now()}`,
    amount,
    currency = 'gbp',
    failureReason = 'card_declined',
  } = params;

  const amountMinor = Math.round(amount * 100);

  const event = {
    id: `evt_${Date.now()}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: paymentIntentId,
        object: 'payment_intent',
        amount: amountMinor,
        amount_received: 0,
        currency: currency.toLowerCase(),
        status: 'requires_payment_method',
        metadata: {
          bookingId: bookingId,
        },
        last_payment_error: {
          type: 'card_error',
          code: failureReason,
          message: 'Your card was declined.',
        },
      },
    },
  };

  console.log(`[Payment Helper] Simulating failed payment for booking ${bookingId}`);
  const response = await sendStripeWebhook(event);
  
  if (response.status === 200) {
    console.log(`[Payment Helper] ✓ Payment failure webhook processed`);
  } else {
    console.warn(`[Payment Helper] ⚠ Webhook returned ${response.status}`);
  }
  
  return response;
}

/**
 * Simulate refund
 * Triggers charge.refunded webhook
 */
export async function simulateRefund(params: {
  paymentIntentId: string;
  chargeId?: string;
  amount: number;
  currency?: string;
}): Promise<any> {
  const {
    paymentIntentId,
    chargeId = `ch_test_${Date.now()}`,
    amount,
    currency = 'gbp',
  } = params;

  const amountMinor = Math.round(amount * 100);

  const event = {
    id: `evt_${Date.now()}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'charge.refunded',
    data: {
      object: {
        id: chargeId,
        object: 'charge',
        amount: amountMinor,
        amount_refunded: amountMinor,
        currency: currency.toLowerCase(),
        payment_intent: paymentIntentId,
        refunded: true,
        refunds: {
          data: [
            {
              id: `re_test_${Date.now()}`,
              amount: amountMinor,
              currency: currency.toLowerCase(),
              status: 'succeeded',
            },
          ],
        },
      },
    },
  };

  console.log(`[Payment Helper] Simulating refund for payment intent ${paymentIntentId}`);
  const response = await sendStripeWebhook(event);
  
  if (response.status === 200) {
    console.log(`[Payment Helper] ✓ Refund webhook processed`);
  } else {
    console.warn(`[Payment Helper] ⚠ Webhook returned ${response.status}`);
  }
  
  return response;
}

/**
 * Wait for booking status to change (with timeout)
 * Useful after sending webhook to wait for DB update
 */
export async function waitForBookingStatus(
  token: string,
  bookingId: string,
  expectedStatus: string,
  timeoutMs: number = 5000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await axios.get(
        `${BASE_URL}/api/v1/bookings/${bookingId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          validateStatus: () => true,
        }
      );
      
      if (response.status === 200) {
        const booking = response.data.data ?? response.data;
        if (booking.status === expectedStatus) {
          console.log(`[Payment Helper] ✓ Booking status is ${expectedStatus}`);
          return true;
        }
      }
    } catch (error) {
      // Ignore errors and retry
    }
    
    // Wait 500ms before retry
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.warn(`[Payment Helper] ⚠ Timeout waiting for status ${expectedStatus}`);
  return false;
}

/**
 * Complete payment flow for a booking
 * Creates booking → simulates payment → waits for confirmation
 */
export async function completePaymentFlow(params: {
  token: string;
  bookingId: string;
  amount: number;
  currency?: string;
}): Promise<boolean> {
  const { token, bookingId, amount, currency = 'gbp' } = params;
  
  console.log(`[Payment Helper] Starting payment flow for booking ${bookingId}`);
  
  // 1. Simulate successful payment webhook
  const webhookResponse = await simulateSuccessfulPayment({
    bookingId,
    amount,
    currency,
  });
  
  if (webhookResponse.status !== 200) {
    console.error(`[Payment Helper] ✗ Webhook failed with status ${webhookResponse.status}`);
    return false;
  }
  
  // 2. Wait for booking to transition to DRIVER_PENDING
  const success = await waitForBookingStatus(token, bookingId, 'DRIVER_PENDING', 5000);
  
  if (success) {
    console.log(`[Payment Helper] ✓ Payment flow completed successfully`);
  } else {
    console.warn(`[Payment Helper] ⚠ Payment flow may not have completed`);
  }
  
  return success;
}
