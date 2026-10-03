import { Router } from 'express';
import { validate } from '../../middlewares/index.js';
import { authorize } from '../../middlewares/auth.js';
import { asyncHandler } from '../../utils/index.js';
import { AuthRequest } from '../../types/auth.js';
import * as RewardsController from './rewards.controller.js';
import { rewardCampaignUpsertSchema, rewardGrantSchema, rewardReversalSchema } from './rewards.validator.js';
import { z } from 'zod';
import { requireRewards } from './rewards.feature.js';

const router = Router();
const userIdParamSchema = z.object({ id: z.string().min(1) });

router.get('/me/rewards', requireRewards, asyncHandler<AuthRequest>(RewardsController.getMyRewards));

router.use(authorize('ADMIN') as any);
router.get('/campaigns', requireRewards, asyncHandler<AuthRequest>(RewardsController.listCampaigns));
router.post('/campaigns', requireRewards, validate({ body: rewardCampaignUpsertSchema }), asyncHandler<AuthRequest>(RewardsController.upsertCampaign));
router.put('/campaigns/:id', requireRewards, validate({ params: userIdParamSchema, body: rewardCampaignUpsertSchema }), asyncHandler<AuthRequest>(RewardsController.upsertCampaign));
router.get('/users/:id/rewards', requireRewards, validate({ params: userIdParamSchema }), asyncHandler<AuthRequest>(RewardsController.getAdminUserRewards));
router.post('/users/:id/rewards/manual-grant', requireRewards, validate({ params: userIdParamSchema, body: rewardGrantSchema }), asyncHandler<AuthRequest>(RewardsController.grantManualReward));
router.post('/users/:id/rewards/reverse/:entryId', requireRewards, validate({ params: z.object({ id: z.string().min(1), entryId: z.string().min(1) }), body: rewardReversalSchema }), asyncHandler<AuthRequest>(RewardsController.reverseRewardEntry));

export default router;
