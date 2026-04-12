import { BookingStatus } from '@prisma/client';
import {
    BookingContext,
    SegmentDiagnostics,
    WaypointInfo,
} from '../search-ride/search-ride.types.js';

/* ================= PRICE BREAKDOWN ================= */
export interface PriceBreakdown {
    basePricePerSeat: number;
    seatsBooked: number;
    subtotal: number;
    luggageFee: number;
    serviceFee: number;
    totalPrice: number;
    currency: string;
}

/* ================= CREATE BOOKING INPUT ================= */
export interface CreateBookingInput {
    rideId: string;
    segmentId?: string;
    seatsBooked: number;
    luggageCount?: number;
    pickupWaypointId?: string;
    dropoffWaypointId?: string;
    notes?: string;
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
    waypoints?: WaypointInfo[];
    driver: {
        id: string;
        name: string | null;
        avatarUrl: string | null;
    };
}

export interface BookingSegmentRideInfo extends BookingRideInfo {
    bookingContext: BookingContext;
    segment: SegmentDiagnostics;
}

/* ================= BOOKING RESPONSE ================= */
export interface BookingResponse {
    id: string;
    rideId: string;
    passengerId: string;
    seatsBooked: number;
    luggageCount: number;
    totalPrice: number;
    priceBreakdown?: PriceBreakdown;
    status: BookingStatus;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    payment?: BookingPaymentInfo | null;
    ride?: BookingRideInfo;
    fullRide?: BookingRideInfo;
    segmentRide?: BookingSegmentRideInfo | null;
    // OTP fields (only available when booking is confirmed)
    pickupOtp?: string | null;
    dropOtp?: string | null;
    pickupOtpVerifiedAt?: Date | null;
    dropOtpVerifiedAt?: Date | null;
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
    status?: BookingStatus;
    page?: number;
    limit?: number;
}

/* ================= PRICE PREVIEW ================= */
export interface PricePreviewInput {
    rideId: string;
    segmentId?: string;
    seatsBooked: number;
    luggageCount?: number;
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
