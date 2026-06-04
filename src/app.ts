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
  chatRouter,
  notificationRouter,
  ratingsRouter,
  dlVerificationRouter,
  adminRouter,
} from './modules/index.js';
import docsRouter from './docs/docs.routes.js';

import { protect, errorHandler, rateLimiter, otpLimiter, requestTimeout } from './middlewares/index.js';
import './queue/deadline.queue.js'; // start BullMQ deadline worker
import './queue/maintenance.queue.js'; // start nightly maintenance worker

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [];

app.use(cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
}));
app.use(helmet());
app.use(rateLimiter);

// ⚠️ IMPORTANT: Webhook route MUST come BEFORE express.json()
// Stripe needs the raw body for signature verification
app.use('/api/v1/payments', express.raw({ type: 'application/json' }), paymentsWebhookRouter);

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

app.use(docsRouter);

app.use('/api/v1/auth/otp/request', otpLimiter);
app.use('/api/v1/auth/otp/resend', otpLimiter);
app.use('/api/v1/auth/otp/verify', otpLimiter);
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
app.use('/api/v1/payments/connect', protect, paymentsConnectRouter);
app.use('/api/v1/admin', protect, adminRouter);

app.use(errorHandler);

export default app;
