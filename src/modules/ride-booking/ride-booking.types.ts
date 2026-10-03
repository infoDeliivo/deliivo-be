import { BookingStatus } from '@prisma/client';
import {
    BookingContext,
    SegmentDiagnostics,
    WaypointInfo,
} from '../search-ride/search-ride.types.js';

/* ================= VEHICLE INFO ================= */
export interface VehicleInfo {
    id: string;
    brand: string | null;
    model_num: string | null;
    model_name: string | null;
    type: string | null;
    color: string | null;
    year: number | null;
    imageUrl: string | null;
    isVerified: boolean;
}

/* ================= PRICE BREAKDOWN ================= */
export interface PriceBreakdown {
    basePricePerSeat: number;
    seatsBooked: number;
    subtotal: number;
    luggageFee: number;
    serviceFee: number;
    totalPrice: number;
    currency: string;
    /** Rate the fee was computed at, so clients can label it without doing arithmetic. */
    serviceFeePercent: number;
    serviceFeeFlat: number;
}

/* ================= CREATE BOOKING INPUT ================= */
export interface CreateBookingInput {
    rideId: string;
    segmentId?: string;
    seatsBooked: number;
    luggageCount?: number;
    requiresChildSeat?: boolean;
    travelingWithChildUnderTwo?: boolean;
    bringingOwnChildSeat?: boolean;
    pickupWaypointId?: string;
    dropoffWaypointId?: string;
    notes?: string;
    responseExpiryOption?: string; // ONE_HOUR, THREE_HOURS, SIX_HOURS, TWELVE_HOURS, TWENTY_FOUR_HOURS, BEFORE_DEPARTURE
}

export interface BookingPaymentInfo {
    provider: 'stripe';
    paymentIntentId: string;
    clientSecret?: string;
    currency?: string;
}

export interface BookingRideInfo {
    id: string;
    originPlaceId?: string;
    originAddress: string;
    originLat?: number;
    originLng?: number;
    destinationPlaceId?: string;
    destinationAddress: string;
    destinationLat?: number;
    destinationLng?: number;
    routePolyline?: string | null;
    routeDistanceMeters?: number | null;
    routeDurationSeconds?: number | null;
    departureDate: Date;
    departureTime: string;
    totalSeats?: number;
    availableSeats?: number;
    basePricePerSeat: number;
    currency: string;
    status?: string; // Ride status
    waypoints?: WaypointInfo[];
    driver: {
        id: string;
        firstName: string | null;
        avatarUrl: string | null;
    };
    vehicle?: VehicleInfo | null;
}

export interface BookingSegmentRideInfo extends BookingRideInfo {
    bookingContext: BookingContext;
    segment: SegmentDiagnostics;
}

/* ================= BOOKING RESPONSE ================= */
export interface BookingResponse {
    id: string;
    /**
     * True when this is an existing unpaid booking handed back for the rider to finish
     * paying, rather than a newly created one. The API answers 200 instead of 201 for it.
     */
    resumed?: boolean;
    bookingReference: string;
    rideId: string;
    passengerId: string;
    seatsBooked: number;
    luggageCount: number;
    totalPrice: number;
    priceBreakdown?: PriceBreakdown;
    status: BookingStatus;
    displayStatus?: string;
    cancelledAt?: Date | null;
    /** 'PASSENGER' | 'DRIVER' | 'ADMIN' | 'SYSTEM' — who ended the booking. */
    cancelledByRole?: string | null;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    decisionDeadline?: {
        deadlineAt: Date;
        timeRemainingMs: number;
        timeRemainingSeconds: number;
        isExpired: boolean;
        canExtend?: boolean;
        hasBeenExtended?: boolean;
        autoCancelAt?: Date | null;
        autoCancelTimeRemainingMs?: number | null;
        autoCancelTimeRemainingSeconds?: number | null;
    } | null;
    payment?: BookingPaymentInfo | null;
    ride?: BookingRideInfo;
    fullRide?: BookingRideInfo;
    segmentRide?: BookingSegmentRideInfo | null;
    // OTP fields (only available when booking is confirmed)
    pickupOtp?: string | null;
    dropOtp?: string | null;
    pickupOtpVerifiedAt?: Date | null;
    dropOtpVerifiedAt?: Date | null;
    ratingByViewer?: {
        id: string;
        stars: number;
        reviewText: string | null;
        createdAt: Date;
    } | null;
}

export interface CancelBookingResult {
    bookingId: string;
    rideId: string;
    refundPercent: number;
    refundAmount: number;
    refundInitiated: boolean;
}

/* ================= BOOKING LIST RESPONSE ================= */
export interface BookingListResponse {
    bookings: BookingResponse[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

/* ================= LIST BOOKINGS QUERY ================= */
export interface ListBookingsQuery {
    status?: BookingStatus | string;
    page?: number;
    limit?: number;
}

/* ================= PRICE PREVIEW ================= */
export interface PricePreviewInput {
    rideId: string;
    segmentId?: string;
    seatsBooked: number;
    luggageCount?: number;
    requiresChildSeat?: boolean;
    travelingWithChildUnderTwo?: boolean;
    bringingOwnChildSeat?: boolean;
    pickupWaypointId?: string;
    dropoffWaypointId?: string;
}

export interface PricePreviewResponse {
    priceBreakdown: PriceBreakdown;
    ride: {
        id: string;
        originAddress: string;
        destinationAddress: string;
        basePricePerSeat: number;
        currency: string;
        availableSeats: number;
    };
    segmentRide?: {
        originAddress: string;
        destinationAddress: string;
        basePricePerSeat: number;
    } | null;
}
