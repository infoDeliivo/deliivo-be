import { Router } from 'express';
import { connectOnboard, connectStatus } from './stripe.connect.controller.js';

const router = Router();

router.post('/onboard', connectOnboard);
router.get('/status', connectStatus);

export default router;
