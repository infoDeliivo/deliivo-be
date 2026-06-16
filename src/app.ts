import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import {
  authRouter,
  travelPreferenceRouter,
  vehiclesRouter,
  mapRouter,
  userRouter,
  publishRideRouter,
  searchRideRouter,
  rideBookingRouter,
  driverBookingRouter,
  paymentsWebhookRouter,
  chatRouter,
  notificationRouter,
  ratingsRouter,
  dlVerificationRouter,
} from './modules/index.js';
import docsRouter from './docs/docs.routes.js';

import { protect, errorHandler } from './middlewares/index.js';
import { startBookingDeadlineChecker } from './jobs/booking-deadline-checker.job.js';

const app = express();

// Disable ETag globally to prevent HTTP/2 stream reset issues
app.set('etag', false);

// Set server timeout to handle long-running requests
app.use((req, res, next) => {
  res.setTimeout(30000); // 30 seconds
  next();
});

app.use(cors());
app.use(helmet());

// ⚠️ IMPORTANT: Webhook route MUST come BEFORE express.json()
// Stripe needs the raw body for signature verification
app.use('/api/v1/payments', express.raw({ type: 'application/json' }), paymentsWebhookRouter);

// Now apply JSON parsing for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Disable compression and ETag for auth routes to prevent HTTP/2 stream resets
app.use('/api/v1/auth', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.removeHeader('ETag');
  next();
});

app.use(docsRouter);

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', protect, userRouter);
app.use('/api/v1/publish-ride', protect, publishRideRouter);
app.use('/api/v1/search-rides', protect, searchRideRouter);
app.use('/api/v1/bookings', protect, rideBookingRouter);
app.use('/api/v1/driver/bookings', protect, driverBookingRouter);
app.use('/api/v1/vehicles', protect, vehiclesRouter);
app.use('/api/v1/travel-preferences', protect, travelPreferenceRouter);
app.use('/api/v1/maps', protect, mapRouter);
app.use('/api/v1/chat', protect, chatRouter);
app.use('/api/v1/notifications', protect, notificationRouter);
app.use('/api/v1/ratings', protect, ratingsRouter);
app.use('/api/v1/dl-verification', dlVerificationRouter);

app.use(errorHandler);

// Start background jobs
startBookingDeadlineChecker();

export default app;
