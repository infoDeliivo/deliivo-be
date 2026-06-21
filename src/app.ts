import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from './config/index.js';
import redis from './cache/redis.js';

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
  paymentsConnectRouter,
  paymentRouter,
  chatRouter,
  notificationRouter,
  ratingsRouter,
  dlVerificationRouter,
  adminRouter,
  rideOperationsRouter,
  bookingOperationsRouter,
  pricingRouter,
  paymentMethodsRouter,
  adminPayoutRouter,
  driverPayoutRouter,
  disputeRouter,
  adminDisputeRouter,
  trackingRouter,
  publicTrackingRouter,
  reconciliationRouter,
  safetyRouter,
  contentRouter,
  adminContentRouter,
} from './modules/index.js';
import docsRouter from './docs/docs.routes.js';

import { protect, errorHandler, rateLimiter, otpLimiter, requestTimeout, searchLimiter, bookingLimiter, requestContext } from './middlewares/index.js';
import './queue/deadline.queue.js'; // start BullMQ deadline worker
import './queue/maintenance.queue.js'; // start nightly maintenance worker

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [];

app.use(cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
}));
app.use(helmet());
app.use(requestContext);
app.use(rateLimiter);

// ⚠️ IMPORTANT: Webhook route MUST come BEFORE express.json()
// Stripe needs the raw body for signature verification
app.use('/api/v1/payments', express.raw({ type: 'application/json' }), paymentsWebhookRouter);

// Now apply JSON parsing for all other routes
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(requestTimeout);

// Serve local uploads (dev fallback when S3 is not configured)
app.use('/uploads', express.static('uploads'));

app.get('/health', async (req, res) => {
  const checks: Record<string, boolean> = { database: false, redis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {}

  try {
    await redis.ping();
    checks.redis = true;
  } catch {}

  const healthy = checks.database && checks.redis;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
    uptime: process.uptime(),
  });
});

app.get('/health/ready', async (req, res) => {
  const checks: Record<string, boolean> = {
    database: false,
    redis: false,
    authSecrets: Boolean(
      process.env.JWT_SECRET
      && process.env.ACCESS_TOKEN_SECRET
      && process.env.REFRESH_TOKEN_SECRET
      && process.env.SEGMENT_VIEW_TOKEN_SECRET
    ),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    firebase: Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
      || process.env.FIREBASE_SERVICE_ACCOUNT
      || process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      || process.env.GOOGLE_APPLICATION_CREDENTIALS
    ),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {}

  try {
    await redis.ping();
    checks.redis = true;
  } catch {}

  const ready = checks.database
    && checks.redis
    && checks.authSecrets
    && checks.stripe;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks,
    uptime: process.uptime(),
  });
});

app.use(docsRouter);

app.use('/api/v1/auth/otp/request', otpLimiter);
app.use('/api/v1/auth/otp/resend', otpLimiter);
app.use('/api/v1/auth/otp/verify', otpLimiter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', protect, userRouter);
app.use('/api/v1/publish-ride', protect, publishRideRouter);
app.use('/api/v1/search-rides', protect, searchLimiter, searchRideRouter);
app.use('/api/v1/bookings', protect, bookingLimiter, rideBookingRouter);
app.use('/api/v1/bookings', protect, bookingOperationsRouter);
app.use('/api/v1/driver/bookings', protect, driverBookingRouter);
app.use('/api/v1/rides', protect, rideOperationsRouter);
app.use('/api/v1/vehicles', protect, vehiclesRouter);
app.use('/api/v1/travel-preferences', protect, travelPreferenceRouter);
app.use('/api/v1/maps', mapRouter);
app.use('/api/v1/chat', protect, chatRouter);
app.use('/api/v1/notifications', protect, notificationRouter);
app.use('/api/v1/content', contentRouter);
app.use('/api/v1/safety', protect, safetyRouter);
app.use('/api/v1/ratings', protect, ratingsRouter);
app.use('/api/v1/dl-verification', dlVerificationRouter);
app.use('/api/v1/payments', protect, paymentRouter);
app.use('/api/v1/payments/connect', protect, paymentsConnectRouter);
app.use('/api/v1/admin', protect, adminRouter);
app.use('/api/v1/admin/content', protect, adminContentRouter);
app.use('/api/v1/pricing', protect, pricingRouter);
app.use('/api/v1/payment-methods', protect, paymentMethodsRouter);
app.use('/api/v1/admin/payouts', protect, adminPayoutRouter);
app.use('/api/v1/drivers/me', protect, driverPayoutRouter);
app.use('/api/v1/disputes', protect, disputeRouter);
app.use('/api/v1/admin/disputes', protect, adminDisputeRouter);
app.use('/api/v1/tracking', publicTrackingRouter); // public endpoint, no auth
app.use('/api/v1/tracking', protect, trackingRouter);
app.use('/api/v1/admin/reconciliation', protect, reconciliationRouter);

app.use('/api', (req, res) => {
  res.status(404).json({
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use(errorHandler);

export default app;
