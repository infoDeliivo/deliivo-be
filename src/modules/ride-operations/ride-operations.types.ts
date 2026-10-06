import { RideStatus, BookingStatus } from '@prisma/client';
import type { ForceInput } from './force-override.js';

// Valid ride state transitions
export const RIDE_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
    DRAFT: ['PUBLISHED'],
    PUBLISHED: ['SCHEDULED', 'READY_TO_START', 'CANCELLED', 'EXPIRED'],
    SCHEDULED: ['READY_TO_START', 'CANCELLED', 'EXPIRED'],
    READY_TO_START: ['IN_PROGRESS', 'CANCELLED', 'EXPIRED'],
    IN_PROGRESS: ['COMPLETION_PENDING', 'CANCELLED', 'DISPUTED'],
    COMPLETION_PENDING: ['COMPLETED', 'DISPUTED'],
    COMPLETED: ['DISPUTED'],
    CANCELLED: [],
    EXPIRED: [],
    DISPUTED: [],
};

// Booking states that are terminal (no further transitions from ride-ops)
export const TERMINAL_BOOKING_STATES: BookingStatus[] = [
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.NO_SHOW,
    BookingStatus.DRIVER_MISSED_PICKUP,
    BookingStatus.PAYMENT_FAILED,
    // The rider paid but the ride filled up first, so they were refunded. Nothing follows it.
    BookingStatus.RIDE_FULL_REFUNDED,
    BookingStatus.DISPUTED,
];

// Booking states that block ride completion.
// PAYMENT_PENDING is excluded: an unpaid booking holds no seat and no driver obligation,
// so it must not keep a finished ride open.
export const NON_TERMINAL_BOOKING_STATES: BookingStatus[] = [
    BookingStatus.DRIVER_PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.WAITING_FOR_PICKUP,
    BookingStatus.DRIVER_ARRIVED,
    BookingStatus.OTP_PENDING,
    BookingStatus.ONBOARD,
    BookingStatus.DROP_PENDING,
    BookingStatus.DRIVER_DROPPED,
    BookingStatus.IN_PROGRESS,
];

// The driver has confirmed the drop-off; only the rider's own confirmation is outstanding.
// Still non-terminal (the booking is not COMPLETED), but the rider is no longer in the car.
export const DRIVER_DROPPED_OFF_STATES: BookingStatus[] = [
    BookingStatus.DROP_PENDING,
    BookingStatus.DRIVER_DROPPED,
];

export type LocationInput = {
    lat: number;
    lng: number;
    speed?: number;
    heading?: number;
    accuracy?: number;
    timestamp: string; // ISO string from client
};

export type RideEventInput = {
    actionId: string;
    lat?: number;
    lng?: number;
    clientTimestamp: string;
} & ForceInput;

export type DriverArrivedInput = RideEventInput & {
    bookingId: string;
};

export type MarkNoShowInput = RideEventInput & {
    bookingId: string;
};

export type ConfirmDropoffInput = RideEventInput & {
    bookingId: string;
};

export const WAIT_TIME_MINUTES = 10; // Driver must wait 10 min before no-show
export const GEOFENCE_RADIUS_METERS = 200;
