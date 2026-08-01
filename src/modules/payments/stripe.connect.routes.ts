import { Router } from 'express';
import {
    connectAccountSession,
    connectOnboard,
    connectStatus,
} from './stripe.connect.controller.js';

const router = Router();

router.post('/onboard', connectOnboard);
router.post('/account-session', connectAccountSession);
router.get('/status', connectStatus);

export default router;
