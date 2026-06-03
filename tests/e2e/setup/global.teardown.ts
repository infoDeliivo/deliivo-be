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
