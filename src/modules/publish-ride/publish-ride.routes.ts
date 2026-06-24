import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './publish-ride.controller.js';
import {
    createOriginSchema,
    updateDestinationSchema,
    updateScheduleSchema,
    updateCapacitySchema,
    updatePricingSchema,
    updateNotesSchema,
    listRidesQuerySchema,
    rideIdParamSchema,
    updatePickupsSchema,
    updateDropoffsSchema,
    updateStopoversSchema,
    selectRouteSchema,
} from './publish-ride.validator.js';

const router = Router();

/* ============================================================
   PUBLISH RIDE WIZARD — Single draft per user (Redis)
   Flow: Origin (+ pickup) → Destination (+ dropoff) → Compute Routes
         → Select Route → Stopovers → Schedule → Capacity
         → Get Price Recommendation → Set Pricing → Notes → Publish

   Draft auto-deletes when user creates a new Origin or after 10 min TTL.
   ============================================================ */

// Step 1: Create draft with origin + pickup point
router.post(
    '/draft/origin',
    validate({ body: createOriginSchema }),
    controller.createWithOrigin
);

// Step 2: Set destination + dropoff point
router.put(
    '/draft/destination',
    validate({ body: updateDestinationSchema }),
    controller.updateDestination
);

// Step 2b: Set origin-area pickup points
router.put(
    '/draft/pickups',
    validate({ body: updatePickupsSchema }),
    controller.updatePickups
);

// Step 2c: Set destination-area dropoff points
router.put(
    '/draft/dropoffs',
    validate({ body: updateDropoffsSchema }),
    controller.updateDropoffs
);

// Step 3: Compute route options
router.get(
    '/draft/routes/compute',
    controller.computeRoutes
);

// Step 4: Select route
router.put(
    '/draft/routes/select',
    validate({ body: selectRouteSchema }),
    controller.selectRoute
);

// Step 9: Get stopper point suggestions
router.get(
    '/draft/stopovers/suggestions',
    controller.getStopoverSuggestions
);

router.get(
    '/draft/location-suggestions',
    controller.getLocationSuggestions
);

// Step 6: Set stopper points
router.put(
    '/draft/stopovers',
    validate({ body: updateStopoversSchema }),
    controller.updateStopovers
);

// Step 7: Set schedule
router.put(
    '/draft/schedule',
    validate({ body: updateScheduleSchema }),
    controller.updateSchedule
);

// Step 8: Set capacity
router.put(
    '/draft/capacity',
    validate({ body: updateCapacitySchema }),
    controller.updateCapacity
);

// Step 9: Get recommended price
router.get(
    '/draft/pricing/recommended',
    controller.getRecommendedPrice
);

// Step 10: Set pricing
router.put(
    '/draft/pricing',
    validate({ body: updatePricingSchema }),
    controller.updatePricing
);

// Step 11: Update notes
router.patch(
    '/draft/notes',
    validate({ body: updateNotesSchema }),
    controller.updateNotes
);

// Step 12: Publish ride — Redis → DB
router.post(
    '/draft/publish',
    controller.publishRide
);

/* ============================================================
   FUEL PRICE — DEBUG & REFRESH
   ============================================================ */

// Get current UK fuel price (cached or live)
router.get('/fuel-price', controller.getFuelPrice);

// Force refresh fuel price from GOV.UK
router.post('/fuel-price/refresh', controller.refreshFuelPrice);

/* ============================================================
   PUBLISHED RIDE OPERATIONS (DB)
   ============================================================ */

// List user's published rides with pagination
router.get(
    '/',
    validate({ query: listRidesQuerySchema }),
    controller.getUserRides
);

// Get single published ride by ID
router.get(
    '/:id',
    validate({ params: rideIdParamSchema }),
    controller.getRideById
);

// Start ride (PUBLISHED -> IN_PROGRESS)
router.post(
    '/:id/start',
    validate({ params: rideIdParamSchema }),
    controller.startRide
);

// Complete ride (IN_PROGRESS -> COMPLETED)
router.post(
    '/:id/complete',
    validate({ params: rideIdParamSchema }),
    controller.completeRide
);

// Cancel ride
router.delete(
    '/:id',
    validate({ params: rideIdParamSchema }),
    controller.cancelRide
);

export default router;

