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
  dlVerificationWebhookRouter,
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
  uploadsRouter,
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
// Stripe needs the raw body for signature verification.
// The raw parser is scoped to the webhook path alone: on the whole /api/v1/payments prefix it
// swallows every payments request body as a Buffer, and express.json() below then skips them
// because body-parser leaves an already-parsed body alone. That left the JSON connect routes
// seeing no fields at all.
app.use('/api/v1/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/v1/payments', paymentsWebhookRouter);

// Stripe Connect identity documents are uploaded as raw bytes, not JSON. Keep this scoped to the
// one authenticated endpoint so ordinary payment routes still use the small JSON parser below.
app.use(
  '/api/v1/payments/connect/identity-document',
  express.raw({ type: ['image/jpeg', 'image/png', 'application/pdf'], limit: '8mb' })
);

// Veriff signs the exact bytes it sends, so its HMAC can only be checked against an
// unparsed body — same constraint as Stripe, same placement. The raw parser is scoped
// to this one path so the authenticated JSON routes under /api/v1/dl-verification
// still receive parsed bodies.
app.use('/api/v1/dl-verification/webhook', express.raw({ type: 'application/json' }));
app.use('/api/v1/dl-verification/webhook', dlVerificationWebhookRouter);

// Now apply JSON parsing for all other routes
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(requestTimeout);

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
      process.env.ACCESS_TOKEN_SECRET
      && process.env.REFRESH_TOKEN_SECRET
      && (process.env.SEGMENT_VIEW_TOKEN_SECRET || process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET)
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

// Disable compression and ETag for auth routes to prevent HTTP/2 stream resets
app.use('/api/v1/auth', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.removeHeader('ETag');
  next();
});

app.use(docsRouter);

app.use('/api/v1/auth/otp/request', otpLimiter);
app.use('/api/v1/auth/otp/resend', otpLimiter);
app.use('/api/v1/auth/otp/verify', otpLimiter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', protect, userRouter);
app.use('/api/v1/publish-ride', protect, publishRideRouter);
app.use('/api/v1/search-rides', searchLimiter, searchRideRouter);
app.use('/api/v1/bookings', protect, bookingLimiter, rideBookingRouter);
app.use('/api/v1/bookings', protect, bookingOperationsRouter);
app.use('/api/v1/driver/bookings', protect, driverBookingRouter);
app.use('/api/v1/rides', protect, rideOperationsRouter);
app.use('/api/v1/vehicles', protect, vehiclesRouter);
app.use('/api/v1/uploads', protect, uploadsRouter);
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
