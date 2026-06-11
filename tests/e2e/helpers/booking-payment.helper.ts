/**
 * Booking Payment Helper
 * Handles both bypass and Stripe payment modes for E2E tests
 */
import { authed } from './api.client';
import { completeRealPayment, TEST_CARDS } from './stripe-payment.helper';

const PAYMENT_MODE = process.env.BOOKING_PAYMENT_MODE || 'bypass';

/**
 * Create a booking and handle payment based on the configured mode
 * Returns booking in DRIVER_PENDING state (after payment if needed)
 */
export async function createBookingWithPayment(params: {
  token: string;
  rideId: string;
  seatsBooked: number;
  luggageCount?: number;
  pickupWaypointId?: string | null;
  dropWaypointId?: string | null;
}): Promise<{
  bookingId: string;
  booking: any;
  paymentIntentId?: string;
}> {
  const { token, rideId, seatsBooked, luggageCount = 0, pickupWaypointId, dropWaypointId } = params;
  const api = authed(token);
  
  console.log(`[Booking Payment Helper] Creating booking (mode: ${PAYMENT_MODE})`);
  
  // Step 1: Create the booking
  const createRes = await api.post('/bookings', {
    rideId,
    seatsBooked,
    luggageCount,
    pickupWaypointId,
    dropWaypointId,
  });
  
  if (createRes.status !== 200 && createRes.status !== 201) {
    throw new Error(`Failed to create booking: ${createRes.status} ${JSON.stringify(createRes.data)}`);
  }
  
  const booking = createRes.data.data ?? createRes.data;
  const bookingId = booking.id;
  
  console.log(`[Booking Payment Helper] ✓ Booking created: ${bookingId}`);
  console.log(`[Booking Payment Helper] Initial status: ${booking.status}`);
  
  // Step 2: Handle payment based on mode
  if (PAYMENT_MODE === 'bypass') {
    // In bypass mode, booking should already be DRIVER_PENDING
    if (booking.status !== 'DRIVER_PENDING') {
      console.warn(`[Booking Payment Helper] ⚠ Expected DRIVER_PENDING but got ${booking.status}`);
    }
    
    return {
      bookingId,
      booking,
    };
  } else {
    // Stripe mode: booking is PAYMENT_PENDING, need to complete payment
    if (booking.status !== 'PAYMENT_PENDING') {
      console.warn(`[Booking Payment Helper] ⚠ Expected PAYMENT_PENDING but got ${booking.status}`);
      return { bookingId, booking };
    }
    
    // Check if we have client secret
    const clientSecret = booking.clientSecret || booking.payment?.clientSecret;
    if (!clientSecret) {
      throw new Error('No client secret returned for Stripe payment');
    }
    
    console.log(`[Booking Payment Helper] Completing Stripe payment...`);
    
    // Step 3: Complete payment with Stripe test card
    const paymentResult = await completeRealPayment({
      clientSecret,
      card: TEST_CARDS.VISA_SUCCESS,
    });
    
    if (!paymentResult.success) {
      throw new Error(`Payment failed: ${paymentResult.paymentIntent.status}`);
    }
    
    console.log(`[Booking Payment Helper] ✓ Payment completed successfully`);
    
    // Step 4: Wait for webhook to update booking status
    console.log(`[Booking Payment Helper] Waiting for booking to reach DRIVER_PENDING...`);
    
    let updatedBooking = booking;
    const maxRetries = 10;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      const statusRes = await api.get(`/bookings/${bookingId}`);
      if (statusRes.status === 200) {
        updatedBooking = statusRes.data.data ?? statusRes.data;
        
        if (updatedBooking.status === 'DRIVER_PENDING') {
          console.log(`[Booking Payment Helper] ✓ Booking reached DRIVER_PENDING status`);
          break;
        }
        
        console.log(`[Booking Payment Helper] Status: ${updatedBooking.status}, retrying...`);
      }
    }
    
    if (updatedBooking.status !== 'DRIVER_PENDING') {
      console.warn(`[Booking Payment Helper] ⚠ Booking did not reach DRIVER_PENDING after ${maxRetries} retries`);
    }
    
    return {
      bookingId,
      booking: updatedBooking,
      paymentIntentId: paymentResult.paymentIntent.id,
    };
  }
}

/**
 * Get expected booking status after creation based on payment mode
 */
export function getExpectedBookingStatus(): string {
  return PAYMENT_MODE === 'bypass' ? 'DRIVER_PENDING' : 'PAYMENT_PENDING';
}

/**
 * Check if we're in Stripe mode
 */
export function isStripeMode(): boolean {
  return PAYMENT_MODE === 'stripe';
}

/**
 * Check if we're in bypass mode
 */
export function isBypassMode(): boolean {
  return PAYMENT_MODE === 'bypass';
}

/**
 * Wait for booking to reach a specific status
 */
export async function waitForBookingStatus(
  token: string,
  bookingId: string,
  expectedStatus: string,
  timeoutMs: number = 10000
): Promise<boolean> {
  const api = authed(token);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await api.get(`/bookings/${bookingId}`);
      if (res.status === 200) {
        const booking = res.data.data ?? res.data;
        if (booking.status === expectedStatus) {
          return true;
        }
      }
    } catch (error) {
      // Ignore and retry
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return false;
}
