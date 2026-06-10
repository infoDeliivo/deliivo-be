import { RideStatus, BookingStatus } from '@prisma/client';

// Valid ride state transitions
export const RIDE_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
    DRAFT: ['PUBLISHED'],
    PUBLISHED: ['READY_TO_START', 'CANCELLED'],
    READY_TO_START: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETION_PENDING', 'CANCELLED'],
    COMPLETION_PENDING: ['COMPLETED'],
    COMPLETED: [],
    CANCELLED: [],
};

// Booking states that are terminal (no further transitions from ride-ops)
export const TERMINAL_BOOKING_STATES: BookingStatus[] = [
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.NO_SHOW,
    BookingStatus.DRIVER_MISSED_PICKUP,
    BookingStatus.PAYMENT_FAILED,
];

// Booking states that block ride completion
export const NON_TERMINAL_BOOKING_STATES: BookingStatus[] = [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.DRIVER_PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.WAITING_FOR_PICKUP,
    BookingStatus.DRIVER_ARRIVED,
    BookingStatus.ONBOARD,
    BookingStatus.DROP_PENDING,
    BookingStatus.IN_PROGRESS,
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
};

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
