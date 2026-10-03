import type { RequestHandler } from 'express';
import { rewardsEnabled } from '../../config/features.js';

export const requireRewards: RequestHandler = (_req, res, next) => {
  if (!rewardsEnabled()) {
    res
      .status(404)
      .json({ success: false, message: 'Rewards are unavailable', code: 'FEATURE_DISABLED' });
    return;
  }
  next();
};
