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
import ratingsRouter from './ratings/ratings.routes.js';
import dlVerificationRouter from './dl-verification/dl-verification.routes.js';

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
    ratingsRouter,
    dlVerificationRouter,
};
