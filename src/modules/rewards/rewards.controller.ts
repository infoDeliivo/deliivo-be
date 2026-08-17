import { Response } from 'express';
import { AuthRequest } from '../../types/auth.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import { logError } from '../../utils/logger.js';
import * as RewardsService from './rewards.service.js';

export const getMyRewards = async (req: AuthRequest, res: Response) => {
  try {
    const result = await RewardsService.getRewardWallet(req.user.id);
    return sendSuccess(res, { message: 'Reward wallet fetched', data: result });
  } catch (error: any) {
    if (error.message === 'USER_NOT_FOUND') {
      return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'User not found' });
    }
    logError('[REWARDS] get my rewards failed', error, { userId: req.user?.id });
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch reward wallet' });
  }
};

export const getAdminUserRewards = async (req: AuthRequest, res: Response) => {
  try {
    const result = await RewardsService.getRewardWallet(req.params.id as string);
    return sendSuccess(res, { message: 'Reward wallet fetched', data: result });
  } catch (error: any) {
    if (error.message === 'USER_NOT_FOUND') {
      return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'User not found' });
    }
    logError('[REWARDS] admin user rewards failed', error, { userId: req.params.id });
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch reward wallet' });
  }
};

export const listCampaigns = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await RewardsService.listRewardCampaigns();
    return sendSuccess(res, { message: 'Reward campaigns fetched', data: result });
  } catch (error) {
    logError('[REWARDS] list campaigns failed', error);
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch reward campaigns' });
  }
};

export const upsertCampaign = async (req: AuthRequest, res: Response) => {
  try {
    const result = await RewardsService.upsertRewardCampaign(
      {
        ...req.body,
        id: req.params.id ?? req.body.id,
      },
      req.user?.id ?? null,
    );
    return sendSuccess(res, { status: HttpStatus.CREATED, message: 'Reward campaign saved', data: result });
  } catch (error: any) {
    if (error.message === 'PRISMA') {
      return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'Invalid reward campaign payload' });
    }
    logError('[REWARDS] upsert campaign failed', error);
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to save reward campaign' });
  }
};

export const grantManualReward = async (req: AuthRequest, res: Response) => {
  try {
    const result = await RewardsService.grantManualReward(
      {
        amount: req.body.amount,
        userId: req.params.id as string,
        currency: req.body.currency,
        walletType: req.body.walletType,
        reason: req.body.reason,
        sourceType: req.body.sourceType,
        sourceId: req.body.sourceId,
        metadataJson: req.body.metadataJson,
      },
      req.user?.id ?? null,
    );
    return sendSuccess(res, { message: 'Reward granted', data: result });
  } catch (error: any) {
    if (error.message === 'USER_NOT_FOUND') {
      return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'User not found' });
    }
    logError('[REWARDS] manual grant failed', error, { userId: req.params.id });
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to grant reward' });
  }
};
