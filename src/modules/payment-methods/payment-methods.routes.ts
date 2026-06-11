import { Router } from 'express';
import { listHandler, setupIntentHandler, saveHandler, setDefaultHandler, removeHandler } from './payment-methods.controller.js';

export const paymentMethodsRouter = Router();

paymentMethodsRouter.get('/', listHandler);
paymentMethodsRouter.post('/setup-intent', setupIntentHandler);
paymentMethodsRouter.post('/save', saveHandler);
paymentMethodsRouter.post('/:id/default', setDefaultHandler);
paymentMethodsRouter.delete('/:id', removeHandler);
