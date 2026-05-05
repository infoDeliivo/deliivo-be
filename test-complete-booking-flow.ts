import { prisma } from './src/config/index.js';
import { createBooking } from './src/modules/ride-booking/ride-booking.service.js';
import { RideStatus, WaypointType } from '@prisma/client';
import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Test users
const DRIVER_EMAIL = 'test.driver@example.com';
const PASSENGER_EMAIL = 'test.passenger@example.com';

// Ride details
const DEPARTURE_DATE = new Date('2026-05-10');
const DEPARTURE_TIME = '09:00';

const MATHURA = {
    placeId: 'mathura_city_001',
    address: 'Mathura, Uttar Pradesh',
    lat: 27.4924,
    lng: 77.6737,
};

const DELHI = {
    placeId: 'new_delhi_city_001',
    address: 'Connaught Place, New Delhi, Delhi',
    lat: 28.6315,
    lng: 77.2167,
};

async function createTestUsers() {
    console.log('\n📝 Creating test users...');
    
    const driver = await prisma.user.upsert({
        where: { email: DRIVER_EMAIL },
        update: {
            name: 'Test Driver',
            onboardingStatus: 'COMPLETED',
            isVerified: true,
        },
        create: {
            email: DRIVER_EMAIL,
            name: 'Test Driver',
            onboardingStatus: 'COMPLETED',
            isVerified: true,
        },
    });

    const passenger = await prisma.user.upsert({
        where: { email: PASSENGER_EMAIL },
        update: {
            name: 'Test Passenger',
            onboardingStatus: 'COMPLETED',
            isVerified: true,
        },
        create: {
            email: PASSENGER_EMAIL,
            name: 'Test Passenger',
            onboardingStatus: 'COMPLETED',
            isVerified: true,
        },
    });

    console.log('✅ Driver created:', driver.email, '(ID:', driver.id + ')');
    console.log('✅ Passenger created:', passenger.email, '(ID:', passenger.id + ')');

    return { driver, passenger };
}

async function createTestRide(driverId: string) {
    console.log('\n🚗 Creating test ride...');

    // Clean up old test rides
    await prisma.ride.deleteMany({
        where: {
            driverId,
            originAddress: MATHURA.address,
            destinationAddress: DELHI.address,
            departureDate: DEPARTURE_DATE,
        },
    });

    const ride = await prisma.ride.create({
        data: {
            driverId,
            originPlaceId: MATHURA.placeId,
            originAddress: MATHURA.address,
            originLat: MATHURA.lat,
            originLng: MATHURA.lng,
            destinationPlaceId: DELHI.placeId,
            destinationAddress: DELHI.address,
            destinationLat: DELHI.lat,
            destinationLng: DELHI.lng,
            departureDate: DEPARTURE_DATE,
            departureTime: DEPARTURE_TIME,
            totalSeats: 4,
            availableSeats: 4,
            basePricePerSeat: 650,
            currency: 'INR',
            status: RideStatus.PUBLISHED,
            routeDistanceMeters: 183000,
            routeDurationSeconds: 12600,
            notes: 'Test ride for booking flow',
        },
    });

    console.log('✅ Ride created');
    console.log('   Ride ID:', ride.id);
    console.log('   Route:', `${ride.originAddress} → ${ride.destinationAddress}`);
    console.log('   Price:', ride.basePricePerSeat, ride.currency, 'per seat');
    console.log('   Available seats:', ride.availableSeats);

    return ride;
}

async function createTestBooking(passengerId: string, rideId: string) {
    console.log('\n💺 Creating booking...');

    const booking = await createBooking(passengerId, {
        rideId,
        seatsBooked: 2,
        luggageCount: 1,
        notes: 'Test booking',
    });

    console.log('✅ Booking created');
    console.log('   Booking ID:', booking.id);
    console.log('   Status:', booking.status);
    console.log('   Seats booked:', booking.seatsBooked);
    console.log('   Total price:', booking.totalPrice, booking.payment?.currency);

    if (booking.payment?.clientSecret) {
        console.log('\n💳 Stripe Payment Details:');
        console.log('   Payment Intent ID:', booking.payment.paymentIntentId);
        console.log('   Client Secret:', booking.payment.clientSecret);
        console.log('\n   🔗 Test Payment URL:');
        console.log('   https://dashboard.stripe.com/test/payments/' + booking.payment.paymentIntentId);
    }

    return booking;
}

async function simulateStripeWebhook(paymentIntentId: string, bookingId: string) {
    console.log('\n🔔 Simulating Stripe webhook...');

    const webhookPayload = {
        id: 'evt_test_' + Date.now(),
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
            object: {
                id: paymentIntentId,
                object: 'payment_intent',
                amount: 130100, // 1301.00 INR in minor units
                currency: 'inr',
                status: 'succeeded',
                metadata: {
                    bookingId,
                    rideId: 'test-ride-id',
                    passengerId: 'test-passenger-id',
                },
                amount_received: 130100,
                latest_charge: 'ch_test_' + Date.now(),
            },
        },
    };

    try {
        // Note: This will fail signature verification in production
        // For testing, you should use Stripe CLI: stripe trigger payment_intent.succeeded
        console.log('⚠️  Note: Use Stripe CLI for real webhook testing:');
        console.log('   stripe trigger payment_intent.succeeded --add payment_intent:metadata.bookingId=' + bookingId);
        console.log('\n   Or use the Stripe Dashboard to complete the payment');
        
        return webhookPayload;
    } catch (error: any) {
        console.log('❌ Webhook simulation failed (expected in production)');
        console.log('   Use Stripe CLI or Dashboard instead');
    }
}

async function checkBookingStatus(bookingId: string) {
    console.log('\n🔍 Checking booking status...');

    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            ride: {
                select: {
                    originAddress: true,
                    destinationAddress: true,
                    availableSeats: true,
                },
            },
        },
    });

    if (!booking) {
        console.log('❌ Booking not found');
        return;
    }

    console.log('✅ Booking status:', booking.status);
    console.log('   Payment captured:', booking.paymentCapturedAt ? 'Yes' : 'No');
    console.log('   Remaining seats:', booking.ride.availableSeats);

    if (booking.status === 'DRIVER_PENDING') {
        console.log('\n✅ Payment successful! Waiting for driver acceptance.');
    } else if (booking.status === 'PAYMENT_PENDING') {
        console.log('\n⏳ Payment pending. Complete payment using the Stripe link above.');
    }

    return booking;
}

async function main() {
    console.log('🚀 Starting Complete Booking Flow Test\n');
    console.log('=' .repeat(60));

    try {
        // Step 1: Create users
        const { driver, passenger } = await createTestUsers();

        // Step 2: Create ride
        const ride = await createTestRide(driver.id);

        // Step 3: Create booking
        const booking = await createTestBooking(passenger.id, ride.id);

        // Step 4: Show webhook testing instructions
        if (booking.payment?.paymentIntentId) {
            await simulateStripeWebhook(booking.payment.paymentIntentId, booking.id);
        }

        // Step 5: Check initial status
        await checkBookingStatus(booking.id);

        console.log('\n' + '='.repeat(60));
        console.log('✅ Test setup complete!\n');
        console.log('📋 Next Steps:');
        console.log('   1. Complete payment using Stripe Dashboard or CLI');
        console.log('   2. Webhook will update booking to DRIVER_PENDING');
        console.log('   3. Driver can accept/reject the booking');
        console.log('\n💡 To test webhook:');
        console.log('   stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook');
        console.log('   stripe trigger payment_intent.succeeded --add payment_intent:metadata.bookingId=' + booking.id);
        console.log('\n🔍 Check booking status:');
        console.log('   SELECT * FROM "RideBooking" WHERE id = \'' + booking.id + '\';');

    } catch (error: any) {
        console.error('\n❌ Test failed:', error.message);
        if (error.stack) {
            console.error('\nStack trace:', error.stack);
        }
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

main();
