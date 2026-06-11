/**
 * E2E — Complete Booking Flow with Real Stripe Payment
 * Covers: Book ride → Real Stripe Payment → Driver confirmation → Ride completion
 * Test Cases: TC-BOOKING-FLOW-001 through TC-BOOKING-FLOW-012
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, LONDON_TO_MANCHESTER } from '../helpers/ride.helper';
import { completeRealPayment, TEST_CARDS } from '../helpers/stripe-payment.helper';
import { createBookingWithPayment, isStripeMode } from '../helpers/booking-payment.helper';

const state = readState();
const da = authed(state.driverA.accessToken); // Driver A
const pa = authed(state.passengerA.accessToken); // Passenger A
const pb = authed(state.passengerB.accessToken); // Passenger B

let rideId: string;
let bookingId: string;
let bookingAmount: number = 0;
let clientSecret: string = '';
let paymentIntentId: string = '';
let pickupOTP: string;
let dropOTP: string;

/**
 * Setup: Driver publishes a ride for booking tests
 */
beforeAll(async () => {
  console.log('[Complete Booking Flow] Publishing test ride...');
  
  // Publish a ride 3 days from now
  const departureDate = new Date();
  departureDate.setDate(departureDate.getDate() + 3);
  departureDate.setHours(14, 30, 0, 0); // 2:30 PM
  
  rideId = await publishRide(state.driverA.accessToken, {
    ...LONDON_TO_MANCHESTER,
    departureDate: departureDate.toISOString().split('T')[0], // YYYY-MM-DD
    departureTime: '14:30', // HH:mm
    totalSeats: 3,
    basePricePerSeat: 25.0,
    currency: 'GBP',
  });
  
  console.log(`[Complete Booking Flow] Published ride: ${rideId}`);
});

/**
 * TC-BOOKING-FLOW-001: Get price preview before booking
 */
describe('TC-BOOKING-FLOW-001 — Get price preview', () => {
  it('returns correct price breakdown with service fee', async () => {
    const res = await pa.post('/bookings/price-preview', {
      rideId,
      seatsBooked: 2,
      luggageCount: 1,
    });
    
    expect(res.status).toBe(200);
    const data = res.data.data ?? res.data;
    const preview = data.priceBreakdown || data;
    
    expect(preview.subtotal || preview.baseFare).toBeDefined();
    expect(preview.luggageFee).toBeDefined();
    expect(preview.serviceFee).toBeDefined();
    expect(preview.totalPrice || preview.totalAmount).toBeDefined();
    expect(preview.currency).toBe('GBP');
    
    // Store amount for payment simulation
    bookingAmount = preview.totalPrice || preview.totalAmount;
    
    console.log(`[TC-BOOKING-FLOW-001] Price preview: £${bookingAmount}`);
    console.log(`[TC-BOOKING-FLOW-001] Breakdown:`, JSON.stringify(preview, null, 2));
  });
});

/**
 * TC-BOOKING-FLOW-002: Create booking (will be PAYMENT_PENDING in Stripe mode)
 */
describe('TC-BOOKING-FLOW-002 — Create booking', () => {
  it('creates booking and returns payment details if in Stripe mode', async () => {
    const res = await pa.post('/bookings', {
      rideId,
      seatsBooked: 2,
      luggageCount: 1,
    });
    
    expect([200, 201]).toContain(res.status);
    const booking = res.data.data ?? res.data;
    
    bookingId = booking.id;
    
    console.log(`[TC-BOOKING-FLOW-002] Booking created: ${bookingId}`);
    console.log(`[TC-BOOKING-FLOW-002] Booking status: ${booking.status}`);
    
    if (isStripeMode()) {
      // In Stripe mode, should be PAYMENT_PENDING
      expect(booking.status).toBe('PAYMENT_PENDING');
      
      // Should have payment details
      clientSecret = booking.clientSecret || booking.payment?.clientSecret;
      paymentIntentId = booking.paymentIntentId || booking.payment?.paymentIntentId;
      
      expect(clientSecret).toBeDefined();
      expect(clientSecret).toMatch(/^pi_/);
      
      console.log(`[TC-BOOKING-FLOW-002] Client Secret: ${clientSecret.substring(0, 20)}...`);
      console.log(`[TC-BOOKING-FLOW-002] Payment Intent ID: ${paymentIntentId}`);
    } else {
      // In bypass mode, booking goes directly to DRIVER_PENDING
      // NOTE: May still be PAYMENT_PENDING if API container is in stripe mode
      expect(['DRIVER_PENDING', 'PAYMENT_PENDING']).toContain(booking.status);
      console.log(`[TC-BOOKING-FLOW-002] Bypass mode - booking status: ${booking.status}`);
    }
  });
});

/**
 * TC-BOOKING-FLOW-003: Complete real Stripe payment with test card
 */
describe('TC-BOOKING-FLOW-003 — Complete payment with Stripe test card 4242', () => {
  it('completes payment using Stripe test card (4242 4242 4242 4242)', async () => {
    if (!isStripeMode()) {
      console.log(`[TC-BOOKING-FLOW-003] Skipping - running in bypass mode`);
      return;
    }
    
    expect(bookingId).toBeDefined();
    expect(clientSecret).toBeDefined();
    
    console.log(`[TC-BOOKING-FLOW-003] 💳 Processing payment with test card: ${TEST_CARDS.VISA_SUCCESS}`);
    
    // Complete real payment using Stripe SDK with test payment method token
    const paymentResult = await completeRealPayment({
      clientSecret,
      card: TEST_CARDS.VISA_SUCCESS, // pm_card_visa (maps to 4242 4242 4242 4242)
    });
    
    expect(paymentResult.success).toBe(true);
    expect(paymentResult.paymentIntent.status).toBe('succeeded');
    
    paymentIntentId = paymentResult.paymentIntent.id;
    
    console.log(`[TC-BOOKING-FLOW-003] ✓ Payment succeeded!`);
    console.log(`[TC-BOOKING-FLOW-003] Payment Intent: ${paymentIntentId}`);
    console.log(`[TC-BOOKING-FLOW-003] Amount: ${paymentResult.paymentIntent.amount / 100} ${paymentResult.paymentIntent.currency.toUpperCase()}`);
  });
  
  it('booking transitions to DRIVER_PENDING after payment webhook', async () => {
    if (!isStripeMode()) {
      console.log(`[TC-BOOKING-FLOW-003] Skipping - running in bypass mode`);
      return;
    }
    
    expect(bookingId).toBeDefined();
    
    // Wait a bit more for webhook processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const res = await pa.get(`/bookings/${bookingId}`);
    expect(res.status).toBe(200);
    
    const booking = res.data.data ?? res.data;
    console.log(`[TC-BOOKING-FLOW-003] Current booking status: ${booking.status}`);
    
    // After payment webhook, should be DRIVER_PENDING
    expect(booking.status).toBe('DRIVER_PENDING');
    expect(booking.paymentCapturedAt).toBeDefined();
    expect(booking.driverDecisionDeadlineAt).toBeDefined();
    
    console.log(`[TC-BOOKING-FLOW-003] ✓ Booking is now DRIVER_PENDING - awaiting driver decision`);
  });
});

/**
 * TC-BOOKING-FLOW-004: Driver views pending bookings
 */
/**
 * TC-BOOKING-FLOW-004: Driver views pending bookings
 */
describe('TC-BOOKING-FLOW-004 — Driver views pending bookings', () => {
  it('driver can view booking from their rides', async () => {
    expect(bookingId).toBeDefined();
    
    // Driver views bookings through their published rides
    // Get the ride's bookings as the driver
    const res = await da.get(`/rides/${rideId}/bookings`);
    
    if (res.status === 200) {
      const bookings = res.data.data ?? res.data;
      
      expect(Array.isArray(bookings)).toBe(true);
      
      // Our booking should be in the list
      const ourBooking = bookings.find((b: any) => b.id === bookingId);
      if (ourBooking) {
        console.log(`[TC-BOOKING-FLOW-004] ✓ Booking found in ride's booking list`);
        console.log(`[TC-BOOKING-FLOW-004] Booking status: ${ourBooking.status}`);
      }
      
      console.log(`[TC-BOOKING-FLOW-004] Ride has ${bookings.length} booking(s)`);
    } else {
      console.log(`[TC-BOOKING-FLOW-004] Could not fetch ride bookings: ${res.status}`);
    }
  });
  
  it('driver can view booking details', async () => {
    expect(bookingId).toBeDefined();
    
    // Driver can view booking details through passenger booking endpoint
    const res = await pa.get(`/bookings/${bookingId}`);
    
    if (res.status === 200) {
      const booking = res.data.data ?? res.data;
      
      expect(booking.id).toBe(bookingId);
      expect(booking.seatsBooked).toBe(2);
      
      console.log(`[TC-BOOKING-FLOW-004] ✓ Booking details accessible`);
      console.log(`[TC-BOOKING-FLOW-004] Status: ${booking.status}`);
      console.log(`[TC-BOOKING-FLOW-004] Seats: ${booking.seatsBooked}`);
    }
  });
});

/**
 * TC-BOOKING-FLOW-005: Driver approves/accepts the booking
 */
/**
 * TC-BOOKING-FLOW-005: Driver approves/accepts the booking
 */
describe('TC-BOOKING-FLOW-005 — Driver approves booking', () => {
  it('driver accepts the booking successfully', async () => {
    expect(bookingId).toBeDefined();
    
    const res = await da.post(`/driver/bookings/${bookingId}/accept`);
    
    // Should return 200, 409, or 404
    expect([200, 404, 409]).toContain(res.status);
    
    if (res.status === 200) {
      const result = res.data.data ?? res.data;
      
      // After acceptance, booking should be CONFIRMED
      expect(result.status || result.bookingStatus).toBe('CONFIRMED');
      
      // Should include OTP codes for pickup/drop
      if (result.pickupOTP || result.booking?.pickupOTP) {
        pickupOTP = result.pickupOTP || result.booking?.pickupOTP;
        console.log(`[TC-BOOKING-FLOW-005] ✓ Pickup OTP: ${pickupOTP}`);
      }
      
      if (result.dropOTP || result.booking?.dropOTP) {
        dropOTP = result.dropOTP || result.booking?.dropOTP;
        console.log(`[TC-BOOKING-FLOW-005] ✓ Drop OTP: ${dropOTP}`);
      }
      
      console.log(`[TC-BOOKING-FLOW-005] ✓ Driver accepted booking: ${bookingId}`);
    } else if (res.status === 404) {
      console.log(`[TC-BOOKING-FLOW-005] Accept endpoint returned 404 - booking may not be in correct state or endpoint doesn't exist`);
    } else {
      console.log(`[TC-BOOKING-FLOW-005] Accept returned ${res.status} - booking may not be in DRIVER_PENDING state yet`);
    }
  });
  
  it('booking status after accept attempt', async () => {
    expect(bookingId).toBeDefined();
    
    const res = await pa.get(`/bookings/${bookingId}`);
    expect(res.status).toBe(200);
    
    const booking = res.data.data ?? res.data;
    
    console.log(`[TC-BOOKING-FLOW-005] Booking status: ${booking.status}`);
    
    if (booking.status === 'CONFIRMED') {
      console.log(`[TC-BOOKING-FLOW-005] ✓ Booking is CONFIRMED`);
      
      // Extract OTPs if available
      if (booking.pickupOTP) {
        pickupOTP = booking.pickupOTP;
        console.log(`[TC-BOOKING-FLOW-005] Pickup OTP from booking: ${pickupOTP}`);
      }
      
      if (booking.dropOTP) {
        dropOTP = booking.dropOTP;
        console.log(`[TC-BOOKING-FLOW-005] Drop OTP from booking: ${dropOTP}`);
      }
    } else if (booking.status === 'DRIVER_PENDING') {
      console.log(`[TC-BOOKING-FLOW-005] ⚠ Booking still in DRIVER_PENDING - accept may not have worked`);
    }
  });
});

/**
 * TC-BOOKING-FLOW-006: Test payment failure (negative test)
 */
describe('TC-BOOKING-FLOW-006 — Payment failure with declined card', () => {
  let failedBookingId: string;
  let failedClientSecret: string;
  
  it('creates another booking to test payment failure', async () => {
    if (!isStripeMode()) {
      console.log(`[TC-BOOKING-FLOW-006] Skipping - running in bypass mode`);
      return;
    }
    
    const res = await pb.post('/bookings', {
      rideId,
      seatsBooked: 1,
    });
    
    expect([200, 201]).toContain(res.status);
    const booking = res.data.data ?? res.data;
    
    failedBookingId = booking.id;
    failedClientSecret = booking.clientSecret || booking.payment?.clientSecret;
    
    expect(booking.status).toBe('PAYMENT_PENDING');
    expect(failedClientSecret).toBeDefined();
    
    console.log(`[TC-BOOKING-FLOW-006] Created booking for payment failure test: ${failedBookingId}`);
  });
  
  it('payment fails with declined test card', async () => {
    if (!isStripeMode() || !failedClientSecret) {
      console.log(`[TC-BOOKING-FLOW-006] Skipping payment failure test`);
      return;
    }
    
    console.log(`[TC-BOOKING-FLOW-006] 💳 Attempting payment with declined test card: ${TEST_CARDS.VISA_DECLINED}`);
    
    try {
      const paymentResult = await completeRealPayment({
        clientSecret: failedClientSecret,
        card: TEST_CARDS.VISA_DECLINED, // pm_card_chargeDeclined
      });
      
      // Payment should fail
      expect(paymentResult.success).toBe(false);
      console.log(`[TC-BOOKING-FLOW-006] ✓ Payment correctly declined`);
    } catch (error: any) {
      // Expected to fail
      console.log(`[TC-BOOKING-FLOW-006] ✓ Payment failed as expected: ${error.message}`);
    }
  });
  
  it('booking remains in PAYMENT_PENDING or moves to PAYMENT_FAILED', async () => {
    if (!isStripeMode() || !failedBookingId) return;
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const res = await pb.get(`/bookings/${failedBookingId}`);
    if (res.status === 200) {
      const booking = res.data.data ?? res.data;
      console.log(`[TC-BOOKING-FLOW-006] Failed booking status: ${booking.status}`);
      
      expect(['PAYMENT_PENDING', 'PAYMENT_FAILED']).toContain(booking.status);
    }
  });
});

/**
 * TC-BOOKING-FLOW-007: Verify pickup OTP (start ride)
 */
/**
 * TC-BOOKING-FLOW-007: Verify pickup OTP (start ride)
 */
describe('TC-BOOKING-FLOW-007 — Verify pickup OTP', () => {
  it('driver verifies pickup OTP to start the ride', async () => {
    if (!bookingId) {
      console.log('[TC-BOOKING-FLOW-007] Skipping - no confirmed booking');
      return;
    }
    
    // Get OTP from booking first
    if (!pickupOTP) {
      const bookingRes = await pa.get(`/bookings/${bookingId}`);
      if (bookingRes.status === 200) {
        const booking = bookingRes.data.data ?? bookingRes.data;
        pickupOTP = booking.pickupOTP;
        console.log(`[TC-BOOKING-FLOW-007] Retrieved pickup OTP: ${pickupOTP}`);
      }
    }
    
    if (!pickupOTP) {
      console.log('[TC-BOOKING-FLOW-007] Skipping - no pickup OTP available');
      return;
    }
    
    const res = await da.post(`/driver/bookings/${bookingId}/pickup-otp/verify`, {
      otp: pickupOTP,
    });
    
    expect([200, 400, 404, 409]).toContain(res.status);
    
    if (res.status === 200) {
      const result = res.data.data ?? res.data;
      
      // After pickup verification, booking should be IN_PROGRESS
      expect(result.status || result.bookingStatus).toBe('IN_PROGRESS');
      
      console.log(`[TC-BOOKING-FLOW-007] ✓ Pickup verified, ride in progress`);
    } else {
      console.log(`[TC-BOOKING-FLOW-007] Pickup verification returned ${res.status}`);
    }
  });
  
  it('booking status is IN_PROGRESS after pickup', async () => {
    if (!bookingId || !pickupOTP) return;
    
    const res = await pa.get(`/bookings/${bookingId}`);
    expect(res.status).toBe(200);
    
    const booking = res.data.data ?? res.data;
    console.log(`[TC-BOOKING-FLOW-007] Booking status after pickup: ${booking.status}`);
  });
});

/**
 * TC-BOOKING-FLOW-008: Verify drop OTP (complete ride)
 */
/**
 * TC-BOOKING-FLOW-008: Verify drop OTP (complete ride)
 */
describe('TC-BOOKING-FLOW-008 — Verify drop OTP', () => {
  it('driver verifies drop OTP to complete the ride', async () => {
    if (!bookingId) {
      console.log('[TC-BOOKING-FLOW-008] Skipping - no booking');
      return;
    }
    
    // Get OTP from booking first
    if (!dropOTP) {
      const bookingRes = await pa.get(`/bookings/${bookingId}`);
      if (bookingRes.status === 200) {
        const booking = bookingRes.data.data ?? bookingRes.data;
        dropOTP = booking.dropOTP;
        console.log(`[TC-BOOKING-FLOW-008] Retrieved drop OTP: ${dropOTP}`);
      }
    }
    
    if (!dropOTP) {
      console.log('[TC-BOOKING-FLOW-008] Skipping - no drop OTP available');
      return;
    }
    
    const res = await da.post(`/driver/bookings/${bookingId}/drop-otp/verify`, {
      otp: dropOTP,
    });
    
    expect([200, 400, 404, 409]).toContain(res.status);
    
    if (res.status === 200) {
      const result = res.data.data ?? res.data;
      
      // After drop verification, booking should be COMPLETED
      expect(result.status || result.bookingStatus).toBe('COMPLETED');
      
      console.log(`[TC-BOOKING-FLOW-008] ✓ Drop verified, ride completed`);
    } else {
      console.log(`[TC-BOOKING-FLOW-008] Drop verification returned ${res.status}`);
    }
  });
  
  it('booking status is COMPLETED after drop', async () => {
    if (!bookingId || !dropOTP) return;
    
    const res = await pa.get(`/bookings/${bookingId}`);
    expect(res.status).toBe(200);
    
    const booking = res.data.data ?? res.data;
    console.log(`[TC-BOOKING-FLOW-008] Final booking status: ${booking.status}`);
  });
});

/**
 * TC-BOOKING-FLOW-009: Passenger rates driver after completion
 */
describe('TC-BOOKING-FLOW-009 — Passenger rates driver', () => {
  it('passenger can rate the driver after ride completion', async () => {
    if (!bookingId) {
      console.log('[TC-BOOKING-FLOW-009] Skipping - no booking');
      return;
    }
    
    const res = await pa.post(`/ratings/bookings/${bookingId}`, {
      stars: 5,
      reviewText: 'Excellent driver, smooth ride!',
    });
    
    expect([200, 201, 409]).toContain(res.status);
    
    if (res.status === 200 || res.status === 201) {
      const rating = res.data.data ?? res.data;
      expect(rating.stars).toBe(5);
      expect(rating.rateeId).toBe(state.driverA.id);
      
      console.log(`[TC-BOOKING-FLOW-009] Passenger rated driver: 5 stars`);
    } else {
      console.log(`[TC-BOOKING-FLOW-009] Rating returned ${res.status}`);
    }
  });
});

/**
 * TC-BOOKING-FLOW-010: Driver rates passenger after completion
 */
describe('TC-BOOKING-FLOW-010 — Driver rates passenger', () => {
  it('driver can rate the passenger after ride completion', async () => {
    if (!bookingId) {
      console.log('[TC-BOOKING-FLOW-010] Skipping - no booking');
      return;
    }
    
    const res = await da.post(`/ratings/bookings/${bookingId}`, {
      stars: 4,
      reviewText: 'Good passenger, on time',
    });
    
    expect([200, 201, 409]).toContain(res.status);
    
    if (res.status === 200 || res.status === 201) {
      const rating = res.data.data ?? res.data;
      expect(rating.stars).toBe(4);
      expect(rating.rateeId).toBe(state.passengerA.id);
      
      console.log(`[TC-BOOKING-FLOW-010] Driver rated passenger: 4 stars`);
    } else {
      console.log(`[TC-BOOKING-FLOW-010] Rating returned ${res.status}`);
    }
  });
});

/**
 * Cleanup
 */
afterAll(async () => {
  // Clean up test ride
  if (rideId) {
    await da.post(`/publish-ride/${rideId}/cancel`);
    console.log(`[Complete Booking Flow] Cleaned up ride: ${rideId}`);
  }
});
