import { z } from 'zod';

export const createSosSchema = z.object({
  rideId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  role: z.enum(['RIDER', 'DRIVER']).optional(),
  message: z.string().max(1000).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).refine((data) => data.rideId || data.bookingId, {
  message: 'rideId or bookingId is required',
  path: ['rideId'],
});
