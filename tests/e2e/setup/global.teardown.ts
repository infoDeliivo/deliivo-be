import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readState, deleteStateFile } from '../helpers/state';

export default async function globalTeardown(): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? '';
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    let state;
    try {
      state = readState();
    } catch {
      console.log('[e2e teardown] No state file found, skipping DB cleanup.');
      return;
    }

    console.log(`[e2e teardown] Cleaning up test data for run ${state.runId}...`);

    // Payment, Dispute, TrackingLink and RidePricingSnapshot have no cascade on
    // their ride/booking relations, so they have to go first or deleting the
    // users fails on a foreign key and every test row is left behind.
    const testUser = { email: { endsWith: '@test.local' } };
    const testBooking = {
      OR: [{ passenger: testUser }, { ride: { driver: testUser } }],
    };

    await prisma.payoutItem.deleteMany({ where: { payment: { booking: testBooking } } });
    await prisma.payment.deleteMany({ where: { booking: testBooking } });
    await prisma.trackingLink.deleteMany({ where: { booking: testBooking } });
    await prisma.dispute.deleteMany({ where: { booking: testBooking } });
    await prisma.ridePricingSnapshot.deleteMany({
      where: { ride: { driver: testUser } },
    });

    // Delete all users whose emails match the test domain for this run.
    // Cascade deletes handle: rides, bookings, ratings, notifications, tokens, etc.
    const deleted = await prisma.user.deleteMany({
      where: {
        email: { endsWith: '@test.local' },
      },
    });

    console.log(`[e2e teardown] Deleted ${deleted.count} test user(s) and all related data.`);

    // Clean up orphaned StripeWebhookEvent rows created during tests
    await prisma.stripeWebhookEvent.deleteMany({
      where: {
        eventType: { startsWith: 'payment_intent' },
        processedAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }, // last 2h
      },
    });

  } catch (err: any) {
    console.error(`[e2e teardown] Error during cleanup: ${err.message}`);
  } finally {
    await prisma.$disconnect();
    deleteStateFile();
    console.log('[e2e teardown] Done.');
  }
}
