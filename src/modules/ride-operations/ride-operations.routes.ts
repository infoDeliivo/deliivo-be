import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './ride-operations.controller.js';
import {
    rideIdParamSchema,
    bookingIdParamSchema,
    rideEventSchema,
    locationSchema,
    verifyPickupOtpSchema,
    offlineSyncSchema,
} from './ride-operations.validator.js';

// ============================================================
//  RIDE ROUTER  -> mounted at /api/v1/rides
// ============================================================
export const rideOperationsRouter = Router();

// Start ride (driver) — PUBLISHED/READY_TO_START -> IN_PROGRESS
rideOperationsRouter.post(
    '/:rideId/start',
    validate({ params: rideIdParamSchema, body: rideEventSchema }),
    controller.startRide
);

// Finish ride (driver) — IN_PROGRESS -> COMPLETED
rideOperationsRouter.post(
    '/:rideId/finish',
    validate({ params: rideIdParamSchema, body: rideEventSchema }),
    controller.finishRide
);

// Driver GPS ping (every 5-10s while IN_PROGRESS)
rideOperationsRouter.post(
    '/:rideId/locations',
    validate({ params: rideIdParamSchema, body: locationSchema }),
    controller.submitLocation
);

// Latest driver position (rider polling fallback for socket)
rideOperationsRouter.get(
    '/:rideId/latest-location',
    validate({ params: rideIdParamSchema }),
    controller.getLatestLocation
);

// ============================================================
//  BOOKING OPERATIONS ROUTER  -> mounted at /api/v1/bookings
// ============================================================
export const bookingOperationsRouter = Router();

// Driver arrived at pickup — starts wait timer
bookingOperationsRouter.post(
    '/:id/driver-arrived',
    validate({ params: bookingIdParamSchema, body: rideEventSchema }),
    controller.driverArrived
);

// Verify pickup OTP and board passenger (DRIVER_ARRIVED -> ONBOARD)
bookingOperationsRouter.post(
    '/:id/verify-pickup-otp',
    validate({ params: bookingIdParamSchema, body: verifyPickupOtpSchema }),
    controller.verifyPickupOtp
);

// Mark passenger as no-show (requires wait time elapsed)
bookingOperationsRouter.post(
    '/:id/mark-no-show',
    validate({ params: bookingIdParamSchema, body: rideEventSchema }),
    controller.markNoShow
);

// Driver confirms drop-off (ONBOARD -> DROP_PENDING)
bookingOperationsRouter.post(
    '/:id/confirm-dropoff',
    validate({ params: bookingIdParamSchema, body: rideEventSchema }),
    controller.confirmDropoff
);

// Rider confirms drop-off (DROP_PENDING -> COMPLETED)
bookingOperationsRouter.post(
    '/:id/rider-confirm-dropoff',
    validate({ params: bookingIdParamSchema, body: rideEventSchema }),
    controller.riderConfirmDropoff
);

// Rider reports the driver missed their pickup
bookingOperationsRouter.post(
    '/:id/report-missed-pickup',
    validate({ params: bookingIdParamSchema, body: rideEventSchema }),
    controller.reportMissedPickup
);

// Offline action sync — batch process queued actions (idempotent)
rideOperationsRouter.post(
    '/offline-sync',
    validate({ body: offlineSyncSchema }),
    controller.offlineSync
);

