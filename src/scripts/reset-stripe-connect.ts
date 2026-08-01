/**
 * Detach users from their Stripe connected account so the next onboarding call creates a fresh one.
 *
 * Accounts created before the embedded-onboarding switch are Express accounts with no business_type
 * and no business_profile, so Stripe asks the driver for a business type and an industry before it
 * will take a bank account. Those accounts are not convertible. Clearing stripeAccountId makes the
 * next POST /payments/connect/account-session create a controller-based account with both already
 * filled in by the platform, leaving the driver with identity details and a payout account only.
 *
 * The Stripe account itself is left in place — this only drops our reference to it.
 *
 * Run:  node --loader ts-node/esm src/scripts/reset-stripe-connect.ts
 *       node --loader ts-node/esm src/scripts/reset-stripe-connect.ts --dry-run
 *       node --loader ts-node/esm src/scripts/reset-stripe-connect.ts --email-like='%@example.com'
 *
 * Defaults to the E2E users (%@test.local). Refuses to run against a live Stripe key unless
 * --force is passed, because detaching a real driver mid-onboarding loses their progress.
 */
import { prisma } from '../config/index.js';
import { logError } from '../utils/logger.js';

const DEFAULT_EMAIL_LIKE = '%@test.local';

const readEmailLike = (): string => {
    const arg = process.argv.find((value) => value.startsWith('--email-like='));
    return arg ? arg.slice('--email-like='.length) : DEFAULT_EMAIL_LIKE;
};

const main = async () => {
    const dryRun = process.argv.includes('--dry-run');
    const force = process.argv.includes('--force');
    const emailLike = readEmailLike();

    if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && !force) {
        console.error(
            '[reset-stripe-connect] refusing to run with a live Stripe key — pass --force if this is intended'
        );
        await prisma.$disconnect();
        process.exit(1);
    }

    console.log(`[reset-stripe-connect] start${dryRun ? ' (dry-run)' : ''} — email like ${emailLike}`);

    const users = await prisma.user.findMany({
        where: {
            email: { contains: emailLike.replace(/%/g, ''), mode: 'insensitive' },
            stripeAccountId: { not: null },
        },
        select: { id: true, email: true, stripeAccountId: true },
    });

    console.log(`[reset-stripe-connect] ${users.length} user(s) to detach`);

    for (const user of users) {
        if (dryRun) {
            console.log(`[dry-run] detach ${user.email} from ${user.stripeAccountId}`);
            continue;
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                stripeAccountId: null,
                stripeOnboardingComplete: false,
                stripeAccountName: null,
            },
        });
        console.log(`[ok] detached ${user.email} from ${user.stripeAccountId}`);
    }

    console.log('[reset-stripe-connect] done');
    await prisma.$disconnect();
};

main().catch(async (error) => {
    logError('[reset-stripe-connect] fatal', error);
    await prisma.$disconnect();
    process.exit(1);
});
