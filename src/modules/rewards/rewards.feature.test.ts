const mockPrisma = {
  $transaction: jest.fn(),
  user: { findUnique: jest.fn() },
  ride: { findUnique: jest.fn() },
  rideBooking: { findUnique: jest.fn() },
  rewardCampaign: { findMany: jest.fn().mockResolvedValue([]) },
  rewardWalletEntry: { findUnique: jest.fn() },
};
jest.mock('../../config/index.js', () => ({ prisma: mockPrisma }));
jest.mock('../notification/notification.service.js', () => ({ createNotification: jest.fn() }));
jest.mock('../mail/mail.service.js', () => ({ sendMail: jest.fn() }));

import { rewardsEnabled } from '../../config/features.js';
import { requireRewards } from './rewards.feature.js';
import * as rewards from './rewards.service.js';
import { createNotification } from '../notification/notification.service.js';
import { sendMail } from '../mail/mail.service.js';
import type { Request, Response } from 'express';

const original = process.env.REWARDS_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.REWARDS_ENABLED;
  else process.env.REWARDS_ENABLED = original;
});

describe('rewards release flag', () => {
  it.each([undefined, '', 'false', 'TRUE', '1'])('fails closed for %s', async (flag) => {
    if (flag === undefined) delete process.env.REWARDS_ENABLED;
    else process.env.REWARDS_ENABLED = flag;
    expect(rewardsEnabled()).toBe(false);
    await expect(rewards.ensureUserReferralCode('user')).resolves.toBeNull();
    await expect(rewards.attachReferralCodeToUser('user', 'CODE')).resolves.toEqual({
      attached: false,
      reason: 'REWARDS_DISABLED',
    });
    await expect(rewards.awardBookingCompletionRewards('booking')).resolves.toEqual([]);
    await expect(rewards.awardRideCompletionRewards('ride')).resolves.toEqual([]);
    await expect(rewards.getRewardWallet('user')).rejects.toThrow('REWARDS_DISABLED');
    await expect(rewards.listRewardCampaigns()).rejects.toThrow('REWARDS_DISABLED');
    await expect(
      rewards.upsertRewardCampaign(
        { code: 'TEST', name: 'Test', audience: 'RIDER', triggerType: 'MANUAL', rewardAmount: 1 },
        'admin',
      ),
    ).rejects.toThrow('REWARDS_DISABLED');
    await expect(
      rewards.grantManualReward({ userId: 'user', amount: 1, reason: 'Test' }, 'admin'),
    ).rejects.toThrow('REWARDS_DISABLED');
    await expect(
      rewards.reverseRewardEntry({ entryId: 'entry', reason: 'Test' }, 'admin'),
    ).rejects.toThrow('REWARDS_DISABLED');
    for (const model of Object.values(mockPrisma)) {
      for (const method of typeof model === 'function' ? [model] : Object.values(model))
        expect(method).not.toHaveBeenCalled();
    }
    expect(createNotification).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireRewards({} as Request, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('enables explicitly and can be disabled again without mutating campaigns', async () => {
    process.env.REWARDS_ENABLED = 'true';
    const next = jest.fn();
    requireRewards({} as Request, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    await expect(rewards.listRewardCampaigns()).resolves.toEqual([]);
    expect(mockPrisma.rewardCampaign.findMany).toHaveBeenCalledTimes(1);
    process.env.REWARDS_ENABLED = 'false';
    await expect(rewards.listRewardCampaigns()).rejects.toThrow('REWARDS_DISABLED');
    expect(mockPrisma.rewardCampaign.findMany).toHaveBeenCalledTimes(1);
  });
});
