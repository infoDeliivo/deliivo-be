import { prisma } from '../../config/index.js';

describe('ratings prisma delegates', () => {
  it('exposes rideRating and userRatingStats delegates on prisma client', () => {
    expect(prisma.rideRating).toBeDefined();
    expect(prisma.userRatingStats).toBeDefined();
  });
});
