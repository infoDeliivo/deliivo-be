import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import {
    connectAcceptTerms,
    connectAccountSession,
    connectBankAccount,
    connectDeleteBankAccount,
    connectIdentityDocument,
    connectOnboard,
    connectRequirements,
    connectResetAccount,
    connectStatus,
    connectUpdateDetails,
} from './stripe.connect.controller.js';
import {
    connectBankAccountSchema,
    connectPersonalDetailsSchema,
    connectTermsSchema,
} from './stripe.connect.validator.js';

const router = Router();

// Custom onboarding — the platform collects every requirement in its own UI.
router.get('/requirements', connectRequirements);
router.put('/details', validate({ body: connectPersonalDetailsSchema }), connectUpdateDetails);
router.post('/bank-account', validate({ body: connectBankAccountSchema }), connectBankAccount);
router.delete('/bank-account/:externalAccountId', connectDeleteBankAccount);
router.post('/identity-document', connectIdentityDocument);
router.post('/terms', validate({ body: connectTermsSchema }), connectAcceptTerms);
router.delete('/account', connectResetAccount);

// Stripe-rendered onboarding, kept for accounts the API cannot finish on its own.
router.post('/onboard', connectOnboard);
router.post('/account-session', connectAccountSession);

router.get('/status', connectStatus);

export default router;
