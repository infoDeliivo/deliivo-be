import { Router } from 'express';
import { riderTransactions } from './payment.controller.js';

export const paymentRouter = Router();

paymentRouter.get('/transactions', riderTransactions as any);
