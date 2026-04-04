import { Router } from 'express';
import { handleStripeWebhook } from './stripe.webhook.controller.js';

const router = Router();

router.post('/stripe/webhook', handleStripeWebhook);

export default router;
