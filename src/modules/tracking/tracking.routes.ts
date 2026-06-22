import { Router } from 'express';
import { createLinkHandler, getTrackingHandler, revokeLinkHandler, listLinksHandler } from './tracking.controller.js';

// Authenticated routes (mounted at /api/v1/tracking)
export const trackingRouter = Router();
trackingRouter.post('/links', createLinkHandler);
trackingRouter.get('/bookings/:bookingId/links', listLinksHandler);
trackingRouter.delete('/links/:id', revokeLinkHandler);

// Public route (no auth, mounted at /api/v1/tracking)
export const publicTrackingRouter = Router();
publicTrackingRouter.get('/:token', getTrackingHandler);
