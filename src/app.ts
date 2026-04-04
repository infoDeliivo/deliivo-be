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
} from './modules/index.js';
import docsRouter from './docs/docs.routes.js';

import { protect, errorHandler } from './middlewares/index.js';
const app = express();

app.use(cors());
app.use(helmet());
app.use('/api/v1/payments', express.raw({ type: 'application/json' }), paymentsWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
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

app.use(errorHandler);

export default app;
