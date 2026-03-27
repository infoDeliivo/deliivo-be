import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './search-ride.controller.js';
import {
  searchRideQuerySchema,
  rideIdParamSchema,
  notifyRideSchema,
  recentSearchesQuerySchema,
  enhancedSearchRideQuerySchema,
} from './search-ride.validator.js';

const router = Router();

// Advanced search rides
router.get(
  '/advanced',
  validate({ query: enhancedSearchRideQuerySchema }),
  controller.searchRidesAdvanced,
);

// Search rides
router.get('/', validate({ query: searchRideQuerySchema }), controller.searchRides);

// Get recent searches
router.get(
  '/user/recent',
  validate({ query: recentSearchesQuerySchema }),
  controller.getRecentSearches,
);

// Get ride details
router.get('/:id', validate({ params: rideIdParamSchema }), controller.getRideDetails);

// Create ride alert (notify when ride available)
router.post('/notify', validate({ body: notifyRideSchema }), controller.createRideAlert);

export default router;
