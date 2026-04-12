import { BookingStatus } from '@prisma/client';
import { z } from 'zod';

/* ================= CREATE BOOKING SCHEMA ================= */
export const createBookingSchema = z.object({
    rideId: z.string().uuid('Invalid ride ID'),
    segmentId: z.string().min(1, 'segmentId is required').optional(),
    seatsBooked: z.number().int().min(1, 'At least 1 seat required').max(4, 'Maximum 4 seats per booking'),
    luggageCount: z.number().int().min(0).max(10).default(0),
    pickupWaypointId: z.string().uuid().optional(),
    dropoffWaypointId: z.string().uuid().optional(),
    notes: z.string().max(300, 'Notes must be 300 characters or less').optional(),
});

/* ================= PRICE PREVIEW SCHEMA ================= */
export const pricePreviewSchema = z.object({
    rideId: z.string().uuid('Invalid ride ID'),
    segmentId: z.string().min(1, 'segmentId is required').optional(),
    seatsBooked: z.number().int().min(1, 'At least 1 seat required').max(4, 'Maximum 4 seats per booking'),
    luggageCount: z.number().int().min(0).max(10).default(0),
    pickupWaypointId: z.string().uuid().optional(),
    dropoffWaypointId: z.string().uuid().optional(),
});

/* ================= BOOKING ID PARAM SCHEMA ================= */
export const bookingIdParamSchema = z.object({
    id: z.string().uuid('Invalid booking ID'),
});

/* ================= LIST BOOKINGS QUERY SCHEMA ================= */
export const listBookingsQuerySchema = z.object({
    status: z.nativeEnum(BookingStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
});
