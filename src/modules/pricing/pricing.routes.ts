import { Router } from 'express';
import { pricePreviewHandler, validatePriceHandler, getConfigsHandler } from './pricing.controller.js';
import { validate } from '../../middlewares/validate.js';
import { pricePreviewSchema, validatePriceSchema } from './pricing.validator.js';

export const pricingRouter = Router();

pricingRouter.post('/price-preview', validate({ body: pricePreviewSchema }), pricePreviewHandler);
pricingRouter.post('/validate', validate({ body: validatePriceSchema }), validatePriceHandler);
pricingRouter.get('/configs', getConfigsHandler);
