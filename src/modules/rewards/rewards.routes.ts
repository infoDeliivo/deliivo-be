import { Router } from 'express';
import { validate } from '../../middlewares/index.js';
import { authorize } from '../../middlewares/auth.js';
import { asyncHandler } from '../../utils/index.js';
import { AuthRequest } from '../../types/auth.js';
import * as RewardsController from './rewards.controller.js';
import { rewardCampaignUpsertSchema, rewardGrantSchema } from './rewards.validator.js';
import { z } from 'zod';

const router = Router();
const userIdParamSchema = z.object({ id: z.string().min(1) });

router.get('/me/rewards', asyncHandler<AuthRequest>(RewardsController.getMyRewards));

router.use(authorize('ADMIN') as any);
router.get('/campaigns', asyncHandler<AuthRequest>(RewardsController.listCampaigns));
router.post('/campaigns', validate({ body: rewardCampaignUpsertSchema }), asyncHandler<AuthRequest>(RewardsController.upsertCampaign));
router.put('/campaigns/:id', validate({ params: userIdParamSchema, body: rewardCampaignUpsertSchema }), asyncHandler<AuthRequest>(RewardsController.upsertCampaign));
router.get('/users/:id/rewards', validate({ params: userIdParamSchema }), asyncHandler<AuthRequest>(RewardsController.getAdminUserRewards));
router.post('/users/:id/rewards/manual-grant', validate({ params: userIdParamSchema, body: rewardGrantSchema }), asyncHandler<AuthRequest>(RewardsController.grantManualReward));

export default router;
