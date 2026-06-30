import { Router } from 'express';
import { optionalProtect, protect } from '../../middlewares/authMiddleware.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './search-ride.controller.js';
import {
  searchRideQuerySchema,
  rideIdParamSchema,
  rideDetailsQuerySchema,
  notifyRideSchema,
  recentSearchesQuerySchema,
  enhancedSearchRideQuerySchema,
} from './search-ride.validator.js';

const router = Router();

// Advanced search rides
router.get(
  '/advanced',
  optionalProtect,
  validate({ query: enhancedSearchRideQuerySchema }),
  controller.searchRidesAdvanced,
);

// Search rides
router.get('/', optionalProtect, validate({ query: searchRideQuerySchema }), controller.searchRides);

// Get recent searches
router.get(
  '/user/recent',
  protect,
  validate({ query: recentSearchesQuerySchema }),
  controller.getRecentSearches,
);

// Get ride details
router.get(
  '/:id',
  optionalProtect,
  validate({ params: rideIdParamSchema, query: rideDetailsQuerySchema }),
  controller.getRideDetails,
);

// Create ride alert (notify when ride available)
router.post('/notify', protect, validate({ body: notifyRideSchema }), controller.createRideAlert);

export default router;
