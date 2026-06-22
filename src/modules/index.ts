import authRouter from './auth/auth.routes.js';
import vehiclesRouter from './vehicles/vehicle.routes.js';
import travelPreferenceRouter from './travel-preferences/travelPreference.routes.js';
import mapRouter from './maps/google.routes.js';
import userRouter from './user/user.routes.js';
import publishRideRouter from './publish-ride/publish-ride.routes.js';
import searchRideRouter from './search-ride/search-ride.routes.js';
import rideBookingRouter from './ride-booking/ride-booking.routes.js';
import driverBookingRouter from './driver-booking/driver-booking.routes.js';
import chatRouter from './chat/chat.routes.js';
import notificationRouter from './notification/notification.routes.js';
import paymentsWebhookRouter from './payments/stripe.webhook.routes.js';
import paymentsConnectRouter from './payments/stripe.connect.routes.js';
import { paymentRouter } from './payments/payment.routes.js';
import ratingsRouter from './ratings/ratings.routes.js';
import dlVerificationRouter from './dl-verification/dl-verification.routes.js';
import adminRouter from './admin/admin.routes.js';
import { rideOperationsRouter, bookingOperationsRouter } from './ride-operations/ride-operations.routes.js';
import { pricingRouter } from './pricing/pricing.routes.js';
import { paymentMethodsRouter } from './payment-methods/payment-methods.routes.js';
import { adminPayoutRouter, driverPayoutRouter } from './payout/payout.routes.js';
import { disputeRouter, adminDisputeRouter } from './dispute/dispute.routes.js';
import { trackingRouter, publicTrackingRouter } from './tracking/tracking.routes.js';
import { reconciliationRouter } from './reconciliation/reconciliation.routes.js';
import safetyRouter from './safety/safety.routes.js';
import { contentRouter, adminContentRouter } from './content/content.routes.js';

export {
    authRouter,
    vehiclesRouter,
    travelPreferenceRouter,
    mapRouter,
    userRouter,
    publishRideRouter,
    searchRideRouter,
    rideBookingRouter,
    driverBookingRouter,
    chatRouter,
    notificationRouter,
    paymentsWebhookRouter,
    paymentsConnectRouter,
    paymentRouter,
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
};
