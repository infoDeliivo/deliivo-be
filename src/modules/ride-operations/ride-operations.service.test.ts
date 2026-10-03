const mockPrisma = {
    ride: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    rideBooking: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
    },
    rideEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
    },
    locationUpdate: {
        create: jest.fn(),
    },
};

const mockCreateNotification = jest.fn();
const mockCreateDispute = jest.fn();
const mockIsOtpValid = jest.fn();
const mockEmitToRide = jest.fn();
const mockEmitToUsers = jest.fn();

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    // withPrismaFallback: unlisted models/methods resolve empty instead of throwing.
    prisma: require('../../test-utils/prisma-mock.js').withPrismaFallback(mockPrisma),
}));

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock('../dispute/dispute.service.js', () => ({
    __esModule: true,
    createDispute: (...args: unknown[]) => mockCreateDispute(...args),
}));

jest.mock('../ride-booking/booking-otp.utils.js', () => ({
    __esModule: true,
    isOtpValid: (...args: unknown[]) => mockIsOtpValid(...args),
}));

jest.mock('../../socket/index.js', () => ({
    __esModule: true,
    emitToRide: (...args: unknown[]) => mockEmitToRide(...args),
    emitToUsers: (...args: unknown[]) => mockEmitToUsers(...args),
}));

jest.mock('../tracking/tracking.service.js', () => ({
    __esModule: true,
    createTrackingLink: jest.fn().mockResolvedValue({ token: 'tok', trackingUrl: '/tracking/tok' }),
}));

jest.mock('../rewards/rewards.service.js', () => ({
    __esModule: true,
    awardBookingCompletionRewards: jest.fn().mockResolvedValue(undefined),
    awardRideCompletionRewards: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../mail/mail.service.js', () => ({
    __esModule: true,
    sendMail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../sms/sms.service.js', () => ({
    __esModule: true,
    sendSms: jest.fn().mockResolvedValue(undefined),
}));

import { BookingStatus, RideStatus } from '@prisma/client';
import {
    startRide,
    driverArrived,
    verifyPickupAndBoard,
    markNoShow,
    confirmDropoff,
    finishRide,
} from './ride-operations.service.js';
import { FORCE_REQUIRES_RIDE_IN_PROGRESS } from './force-override.js';

const DRIVER_ID = 'driver-1';
const PASSENGER_ID = 'passenger-1';
const RIDE_ID = 'ride-1';
const BOOKING_ID = 'booking-1';

const rideEvent = (overrides: Record<string, unknown> = {}) => ({
    actionId: '33333333-3333-4333-8333-333333333333',
    clientTimestamp: new Date().toISOString(),
    ...overrides,
});

const FORCED = { force: true, overrideReason: 'Rider phone was dead' };

const buildRide = (overrides: Record<string, unknown> = {}) => ({
    id: RIDE_ID,
    driverId: DRIVER_ID,
    status: RideStatus.IN_PROGRESS,
    originLat: 51.5,
    originLng: -0.12,
    destinationLat: 53.48,
    destinationLng: -2.24,
    originAddress: 'London, UK',
    destinationAddress: 'Manchester, UK',
    departureDate: new Date('2026-09-16T00:00:00.000Z'),
    departureTime: '09:00',
    waypoints: [],
    ...overrides,
});

const buildBooking = (overrides: Record<string, unknown> = {}) => ({
    id: BOOKING_ID,
    rideId: RIDE_ID,
    passengerId: PASSENGER_ID,
    status: BookingStatus.ONBOARD,
    pickupWaypointId: null,
    dropoffWaypointId: null,
    pickupOtpHash: 'hash-123456',
    pickupOtpExpiresAt: new Date(Date.now() + 60_000),
    otpAttemptCount: 0,
    waitTimerStartedAt: null,
    ride: buildRide(),
    ...overrides,
});

/** The single ride event written by the operation under test. */
const writtenEvent = () => mockPrisma.rideEvent.create.mock.calls[0][0].data;

describe('ride operations force override', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.ALLOW_RIDE_SIMULATION;
        mockPrisma.rideEvent.findUnique.mockResolvedValue(null);
        mockPrisma.rideEvent.create.mockImplementation(async ({ data }: { data: unknown }) => data);
        mockPrisma.rideBooking.update.mockResolvedValue({ id: BOOKING_ID });
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 0 });
        mockPrisma.locationUpdate.create.mockResolvedValue({
            rideId: RIDE_ID, lat: 51.5, lng: -0.12, speed: null, heading: null, accuracy: null, timestamp: new Date(),
        });
        mockCreateDispute.mockResolvedValue({ id: 'dispute-1' });
        mockIsOtpValid.mockReturnValue(false);
    });

    // ---------- start ride is deliberately not forceable ----------

    it('does not let force start a ride outside its window', async () => {
        process.env.RIDE_START_EARLY_LIMIT_MINUTES = '0';
        mockPrisma.ride.findUnique.mockResolvedValue(
            buildRide({ status: RideStatus.PUBLISHED, departureDate: new Date('2099-01-01T00:00:00.000Z'), bookings: [] })
        );

        await expect(startRide(DRIVER_ID, RIDE_ID, rideEvent(FORCED))).rejects.toThrow('RIDE_TOO_EARLY');
        delete process.env.RIDE_START_EARLY_LIMIT_MINUTES;
    });

    // ---------- the live-ride gate ----------

    it('refuses to force anything once the ride is cancelled', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.WAITING_FOR_PICKUP, ride: buildRide({ status: RideStatus.CANCELLED }) })
        );

        await expect(
            markNoShow(DRIVER_ID, { ...rideEvent(FORCED), bookingId: BOOKING_ID })
        ).rejects.toThrow(FORCE_REQUIRES_RIDE_IN_PROGRESS);
    });

    it('never lets force past the ownership check', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(buildBooking());

        await expect(
            confirmDropoff('someone-else', { ...rideEvent(FORCED), bookingId: BOOKING_ID })
        ).rejects.toThrow('FORBIDDEN_DRIVER');
    });

    // ---------- driver arrived ----------

    it('forces an arrival for a booking that is not waiting for pickup', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(buildBooking({ status: BookingStatus.ONBOARD }));

        const result = await driverArrived(DRIVER_ID, { ...rideEvent(FORCED), bookingId: BOOKING_ID });

        expect(result.forced).toBe(true);
        expect(result.skippedChecks).toEqual(['BOOKING_NOT_WAITING_FOR_PICKUP']);
        expect(writtenEvent().validationStatus).toBe('SUSPICIOUS');
    });

    it('still refuses an arrival out of state without force', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(buildBooking({ status: BookingStatus.ONBOARD }));

        await expect(
            driverArrived(DRIVER_ID, { ...rideEvent(), bookingId: BOOKING_ID })
        ).rejects.toThrow('BOOKING_NOT_WAITING_FOR_PICKUP');
    });

    it('records a geofence miss on a forced arrival', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.WAITING_FOR_PICKUP })
        );

        const result = await driverArrived(DRIVER_ID, {
            ...rideEvent({ ...FORCED, lat: 48.85, lng: 2.35 }),
            bookingId: BOOKING_ID,
        });

        expect(result.skippedChecks).toContain('GEOFENCE_OUT_OF_RANGE');
    });

    // ---------- pickup OTP ----------

    it('boards a passenger on a wrong OTP when forced, without burning an attempt', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.DRIVER_ARRIVED })
        );

        const result = await verifyPickupAndBoard(DRIVER_ID, BOOKING_ID, '000000', rideEvent(FORCED));

        expect(result.status).toBe(BookingStatus.ONBOARD);
        expect(result.skippedChecks).toEqual(['INVALID_PICKUP_OTP']);
        expect(mockPrisma.rideBooking.update).toHaveBeenCalledTimes(1);
        expect(mockPrisma.rideBooking.update).not.toHaveBeenCalledWith(
            expect.objectContaining({ data: { otpAttemptCount: { increment: 1 } } })
        );
    });

    it('burns an attempt on a wrong OTP without force', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.DRIVER_ARRIVED })
        );

        await expect(
            verifyPickupAndBoard(DRIVER_ID, BOOKING_ID, '000000', rideEvent())
        ).rejects.toThrow('INVALID_PICKUP_OTP');
        expect(mockPrisma.rideBooking.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { otpAttemptCount: { increment: 1 } } })
        );
    });

    it('forces past an expired OTP and an exhausted attempt count', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({
                status: BookingStatus.DRIVER_ARRIVED,
                pickupOtpExpiresAt: new Date(Date.now() - 60_000),
                otpAttemptCount: 5,
            })
        );

        const result = await verifyPickupAndBoard(DRIVER_ID, BOOKING_ID, undefined, rideEvent(FORCED));

        expect(result.skippedChecks).toEqual(
            expect.arrayContaining(['PICKUP_OTP_EXPIRED', 'OTP_ATTEMPT_LIMIT_EXCEEDED', 'INVALID_PICKUP_OTP'])
        );
    });

    it('opens a review dispute for a forced boarding', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.DRIVER_ARRIVED })
        );

        await verifyPickupAndBoard(DRIVER_ID, BOOKING_ID, '000000', rideEvent(FORCED));

        expect(mockCreateDispute).toHaveBeenCalledWith(
            expect.objectContaining({
                rideId: RIDE_ID,
                bookingId: BOOKING_ID,
                raisedBy: DRIVER_ID,
                reason: 'FORCED_PICKUP_OTP_VERIFIED',
                status: 'NEEDS_MANUAL_REVIEW',
            })
        );
    });

    it('still completes the boarding when the dispute flag fails', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.DRIVER_ARRIVED })
        );
        mockCreateDispute.mockRejectedValue(new Error('DISPUTE_ALREADY_EXISTS'));

        const result = await verifyPickupAndBoard(DRIVER_ID, BOOKING_ID, '000000', rideEvent(FORCED));

        expect(result.status).toBe(BookingStatus.ONBOARD);
    });

    it('warns the passenger that a step was overridden', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.DRIVER_ARRIVED })
        );

        await verifyPickupAndBoard(DRIVER_ID, BOOKING_ID, '000000', rideEvent(FORCED));

        expect(mockCreateNotification).toHaveBeenCalledWith(
            expect.objectContaining({ userId: PASSENGER_ID, type: 'booking.forced_action' })
        );
    });

    // ---------- no-show ----------

    it('forces a no-show before the wait timer has elapsed', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.DRIVER_ARRIVED, waitTimerStartedAt: new Date() })
        );

        const result = await markNoShow(DRIVER_ID, { ...rideEvent(FORCED), bookingId: BOOKING_ID });

        expect(result.status).toBe(BookingStatus.NO_SHOW);
        expect(result.skippedChecks).toEqual(['WAIT_TIME_NOT_ELAPSED']);
        expect(writtenEvent().metadataJson).toEqual(
            expect.objectContaining({ forced: true, overrideReason: 'Rider phone was dead' })
        );
    });

    it('still refuses an early no-show without force', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.DRIVER_ARRIVED, waitTimerStartedAt: new Date() })
        );

        await expect(
            markNoShow(DRIVER_ID, { ...rideEvent(), bookingId: BOOKING_ID })
        ).rejects.toThrow('WAIT_TIME_NOT_ELAPSED');
    });

    // ---------- drop-off ----------

    it('forces a drop-off for a passenger who never boarded', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.WAITING_FOR_PICKUP })
        );

        const result = await confirmDropoff(DRIVER_ID, { ...rideEvent(FORCED), bookingId: BOOKING_ID });

        expect(result.status).toBe(BookingStatus.DROP_PENDING);
        expect(result.skippedChecks).toEqual(['BOOKING_NOT_ONBOARD']);
    });

    it('does not open a dispute for a forced drop-off', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(
            buildBooking({ status: BookingStatus.WAITING_FOR_PICKUP })
        );

        await confirmDropoff(DRIVER_ID, { ...rideEvent(FORCED), bookingId: BOOKING_ID });

        expect(mockCreateDispute).not.toHaveBeenCalled();
    });

    // ---------- finish ride ----------

    it('forces a finish over bookings that never closed and names them', async () => {
        mockPrisma.ride.findUnique.mockResolvedValue({
            ...buildRide(),
            bookings: [{ id: BOOKING_ID, status: BookingStatus.ONBOARD, passengerId: PASSENGER_ID }],
        });
        mockPrisma.ride.update.mockResolvedValue({
            id: RIDE_ID, status: RideStatus.COMPLETED, actualEndTime: new Date(),
        });

        const result = await finishRide(DRIVER_ID, RIDE_ID, rideEvent(FORCED));

        expect(result.status).toBe(RideStatus.COMPLETED);
        expect(result.skippedChecks).toEqual(['BOOKINGS_NOT_ALL_TERMINAL']);
        expect(writtenEvent().metadataJson).toEqual(
            expect.objectContaining({
                danglingBookings: [{ bookingId: BOOKING_ID, status: BookingStatus.ONBOARD }],
            })
        );
        expect(mockCreateNotification).toHaveBeenCalledWith(
            expect.objectContaining({ userId: PASSENGER_ID, type: 'booking.forced_action' })
        );
    });

    it('still refuses to finish over open bookings without force', async () => {
        mockPrisma.ride.findUnique.mockResolvedValue({
            ...buildRide(),
            bookings: [{ id: BOOKING_ID, status: BookingStatus.ONBOARD, passengerId: PASSENGER_ID }],
        });

        await expect(finishRide(DRIVER_ID, RIDE_ID, rideEvent())).rejects.toThrow('BOOKINGS_NOT_ALL_TERMINAL');
    });

    it('leaves an unforced finish marked VALID', async () => {
        mockPrisma.ride.findUnique.mockResolvedValue({
            ...buildRide(),
            bookings: [{ id: BOOKING_ID, status: BookingStatus.COMPLETED, passengerId: PASSENGER_ID }],
        });
        mockPrisma.ride.update.mockResolvedValue({
            id: RIDE_ID, status: RideStatus.COMPLETED, actualEndTime: new Date(),
        });

        const result = await finishRide(DRIVER_ID, RIDE_ID, rideEvent());

        expect(result.forced).toBe(false);
        expect(writtenEvent().validationStatus).toBe('VALID');
        expect(writtenEvent().metadataJson).toEqual({});
    });
});
