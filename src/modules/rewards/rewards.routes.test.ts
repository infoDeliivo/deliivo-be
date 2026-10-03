import express from 'express';
import request from 'supertest';

const mockHandler = jest.fn((_req, res) => res.status(204).end());
jest.mock('./rewards.controller.js', () => ({
  getMyRewards: mockHandler,
  getAdminUserRewards: mockHandler,
  listCampaigns: mockHandler,
  upsertCampaign: mockHandler,
  grantManualReward: mockHandler,
  reverseRewardEntry: mockHandler,
}));
jest.mock('../../middlewares/index.js', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middlewares/auth.js', () => ({
  authorize: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import rewardsRouter from './rewards.routes.js';

const app = express();
app.use(express.json());
app.get('/api/v1/users/me', (_req, res) => res.json({ id: 'user' }));
app.use('/api/v1/users', rewardsRouter);
app.use('/api/v1/admin/rewards', rewardsRouter);
const original = process.env.REWARDS_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.REWARDS_ENABLED;
  else process.env.REWARDS_ENABLED = original;
});

it.each([
  ['get', '/api/v1/users/me/rewards'],
  ['get', '/api/v1/admin/rewards/campaigns'],
  ['post', '/api/v1/admin/rewards/campaigns'],
  ['put', '/api/v1/admin/rewards/campaigns/campaign'],
  ['get', '/api/v1/admin/rewards/users/user/rewards'],
  ['post', '/api/v1/admin/rewards/users/user/rewards/manual-grant'],
  ['post', '/api/v1/admin/rewards/users/user/rewards/reverse/entry'],
])('guards %s %s before any controller runs', async (method, path) => {
  delete process.env.REWARDS_ENABLED;
  const client = request(app);
  const send = () => client[method as 'get' | 'post' | 'put'](path);
  const blocked = await send();
  expect(blocked.status).toBe(404);
  expect(blocked.body.code).toBe('FEATURE_DISABLED');
  expect(mockHandler).not.toHaveBeenCalled();
  process.env.REWARDS_ENABLED = 'true';
  expect((await send()).status).toBe(204);
  expect(mockHandler).toHaveBeenCalledTimes(1);
});

it('does not disable the normal users API', async () => {
  process.env.REWARDS_ENABLED = 'false';
  expect((await request(app).get('/api/v1/users/me')).body).toEqual({ id: 'user' });
});
