/**
 * Real Stripe Payment Helper for E2E Tests
 * Uses actual Stripe SDK with test cards
 */
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2026-03-25.dahlia' as any,
});

/**
 * Stripe Test Payment Method Tokens
 * https://stripe.com/docs/testing#cards
 * 
 * Using pre-built tokens instead of raw card numbers (safer and recommended by Stripe)
 */
export const TEST_CARDS = {
  VISA_SUCCESS: 'pm_card_visa', // 4242 4242 4242 4242
  VISA_DECLINED: 'pm_card_chargeDeclined', // Generic decline
  VISA_INSUFFICIENT_FUNDS: 'pm_card_chargeDeclinedInsufficientFunds', // Insufficient funds
  MASTERCARD_SUCCESS: 'pm_card_mastercard', // 5555 5555 5555 4444
  AMEX_SUCCESS: 'pm_card_amex', // 3782 822463 10005
};

/**
 * Get payment method token for testing
 * Uses Stripe's pre-built test payment method tokens
 */
export function getTestPaymentMethod(
  paymentMethodToken: string = TEST_CARDS.VISA_SUCCESS
): string {
  console.log(`[Stripe Helper] Using test payment method: ${paymentMethodToken}`);
  return paymentMethodToken;
}

/**
 * Confirm a payment intent with test payment method token
 */
export async function confirmPaymentIntent(
  paymentIntentId: string,
  paymentMethodToken?: string
): Promise<Stripe.PaymentIntent> {
  try {
    console.log(`[Stripe Helper] Confirming payment intent: ${paymentIntentId}`);
    
    // Use provided payment method token or default
    const pmToken = paymentMethodToken || TEST_CARDS.VISA_SUCCESS;
    
    const confirmedIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: pmToken,
    });
    
    console.log(`[Stripe Helper] ✓ Payment intent confirmed: ${confirmedIntent.status}`);
    return confirmedIntent;
  } catch (error: any) {
    console.error('[Stripe Helper] ✗ Failed to confirm payment intent:', error.message);
    throw error;
  }
}

/**
 * Confirm payment with client secret using test payment method token
 */
export async function confirmPaymentWithClientSecret(
  clientSecret: string,
  paymentMethodToken: string = TEST_CARDS.VISA_SUCCESS
): Promise<Stripe.PaymentIntent> {
  try {
    console.log(`[Stripe Helper] Confirming payment with client secret`);
    console.log(`[Stripe Helper] Using payment method: ${paymentMethodToken}`);
    
    // Extract payment intent ID from client secret
    const paymentIntentId = clientSecret.split('_secret_')[0];
    
    // Confirm the payment intent with test payment method token
    // Include return_url to handle redirect-based payment methods
    const confirmedIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethodToken,
      return_url: 'http://localhost:3001/payment/return', // Required for redirect-based payment methods
    });
    
    console.log(`[Stripe Helper] ✓ Payment confirmed: ${confirmedIntent.status}`);
    return confirmedIntent;
  } catch (error: any) {
    console.error('[Stripe Helper] ✗ Payment confirmation failed:', error.message);
    throw error;
  }
}

/**
 * Complete payment flow for a booking
 * This simulates what the frontend would do:
 * 1. Get client secret from booking
 * 2. Confirm payment with Stripe using test payment method token
 * 3. Wait for webhook to update booking status
 */
export async function completeRealPayment(params: {
  clientSecret: string;
  card?: string; // Payment method token, defaults to pm_card_visa
}): Promise<{
  success: boolean;
  paymentIntent: Stripe.PaymentIntent;
}> {
  const { clientSecret, card = TEST_CARDS.VISA_SUCCESS } = params;
  
  try {
    console.log(`[Stripe Helper] Starting real payment flow`);
    console.log(`[Stripe Helper] Using test payment method: ${card}`);
    
    // Confirm payment with Stripe using payment method token
    const paymentIntent = await confirmPaymentWithClientSecret(clientSecret, card);
    
    if (paymentIntent.status === 'succeeded') {
      console.log(`[Stripe Helper] ✓ Payment succeeded!`);
      console.log(`[Stripe Helper] Payment Intent ID: ${paymentIntent.id}`);
      console.log(`[Stripe Helper] Amount: ${paymentIntent.amount / 100} ${paymentIntent.currency.toUpperCase()}`);
      
      // Wait a bit for webhook to process
      console.log(`[Stripe Helper] Waiting 3 seconds for webhook processing...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      return {
        success: true,
        paymentIntent,
      };
    } else {
      console.warn(`[Stripe Helper] ⚠ Payment status: ${paymentIntent.status}`);
      return {
        success: false,
        paymentIntent,
      };
    }
  } catch (error: any) {
    console.error(`[Stripe Helper] ✗ Payment failed:`, error.message);
    throw error;
  }
}

/**
 * Get payment intent details
 */
export async function getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return paymentIntent;
  } catch (error: any) {
    console.error('[Stripe Helper] Failed to retrieve payment intent:', error.message);
    throw error;
  }
}

/**
 * Wait for payment intent to reach specific status
 */
export async function waitForPaymentIntentStatus(
  paymentIntentId: string,
  expectedStatus: string,
  timeoutMs: number = 10000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      
      if (paymentIntent.status === expectedStatus) {
        console.log(`[Stripe Helper] ✓ Payment intent status is ${expectedStatus}`);
        return true;
      }
      
      console.log(`[Stripe Helper] Current status: ${paymentIntent.status}, waiting for ${expectedStatus}...`);
    } catch (error) {
      // Ignore errors and retry
    }
    
    // Wait 1 second before retry
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.warn(`[Stripe Helper] ⚠ Timeout waiting for status ${expectedStatus}`);
  return false;
}

/**
 * Cancel a payment intent
 */
export async function cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  try {
    console.log(`[Stripe Helper] Canceling payment intent: ${paymentIntentId}`);
    const canceledIntent = await stripe.paymentIntents.cancel(paymentIntentId);
    console.log(`[Stripe Helper] ✓ Payment intent canceled`);
    return canceledIntent;
  } catch (error: any) {
    console.error('[Stripe Helper] Failed to cancel payment intent:', error.message);
    throw error;
  }
}
