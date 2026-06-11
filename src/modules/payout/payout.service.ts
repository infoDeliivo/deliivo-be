import { prisma } from '../../config/index.js';
import { getStripeClient } from '../payments/stripe.service.js';
import { recordTransfer } from '../ledger/ledger.service.js';
import { PAYMENT_STATUSES, markTransferCreated, markPayoutCompleted } from '../payments/payment.service.js';

const DISPUTE_WINDOW_HOURS = 48;

// ============================================================
//  ELIGIBILITY
// ============================================================

export const checkAndMarkEligible = async () => {
    const cutoff = new Date(Date.now() - DISPUTE_WINDOW_HOURS * 60 * 60 * 1000);

    // Find payments that are HELD_IN_ESCROW and older than dispute window
    const eligible = await prisma.payment.findMany({
        where: {
            status: PAYMENT_STATUSES.HELD_IN_ESCROW,
            updatedAt: { lt: cutoff },
        },
    });

    let updated = 0;
    for (const payment of eligible) {
        await prisma.payment.update({
            where: { id: payment.id },
            data: { status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE, payoutEligibleAt: new Date() },
        });
        updated++;
    }

    return { checked: eligible.length, markedEligible: updated };
};

// ============================================================
//  PROCESS PAYOUT BATCH FOR A DRIVER
// ============================================================

export const processDriverPayout = async (driverId: string) => {
    const payments = await prisma.payment.findMany({
        where: {
            status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
            booking: { ride: { driverId } },
        },
        include: { booking: { select: { id: true, rideId: true, ride: { select: { driverId: true } } } } },
    });

    if (payments.length === 0) {
        return { driverId, status: 'NO_ELIGIBLE_PAYMENTS', batchId: null };
    }

    const currency = payments[0].currency;
    const totalAmount = payments.reduce((sum, p) => sum + p.fareAmount, 0);

    // Create batch
    const batch = await prisma.payoutBatch.create({
        data: {
            driverId,
            currency,
            amountTotal: totalAmount,
            status: 'PROCESSING',
            items: {
                create: payments.map(p => ({
                    bookingId: p.bookingId,
                    paymentId: p.id,
                    driverAmount: p.fareAmount,
                    platformFee: p.platformFeeAmount,
                    status: 'PENDING',
                })),
            },
        },
    });

    // Get driver's Stripe account
    const driver = await prisma.user.findUnique({ where: { id: driverId }, select: { stripeAccountId: true } });
    if (!driver?.stripeAccountId) {
        await prisma.payoutBatch.update({ where: { id: batch.id }, data: { status: 'FAILED', failureReason: 'NO_STRIPE_ACCOUNT' } });
        return { driverId, status: 'FAILED', batchId: batch.id, reason: 'NO_STRIPE_ACCOUNT' };
    }

    try {
        const stripe = getStripeClient();
        const transfer = await stripe.transfers.create({
            amount: Math.round(totalAmount * 100), // minor units
            currency: currency.toLowerCase(),
            destination: driver.stripeAccountId,
            metadata: { payoutBatchId: batch.id, driverId },
        });

        // Mark payments as TRANSFER_CREATED
        for (const payment of payments) {
            await markTransferCreated(payment.id);
        }

        // Record ledger entries for each payment
        for (const payment of payments) {
            await recordTransfer({
                paymentId: payment.id,
                bookingId: payment.bookingId,
                driverId,
                transferAmount: payment.fareAmount,
                currency: payment.currency,
            });
        }

        // Update batch
        await prisma.payoutBatch.update({
            where: { id: batch.id },
            data: { status: 'COMPLETED', stripeTransferId: transfer.id },
        });

        // Mark all payments as PAYOUT_COMPLETED
        for (const payment of payments) {
            await markPayoutCompleted(payment.id);
        }

        // Update payout items
        await prisma.payoutItem.updateMany({
            where: { payoutBatchId: batch.id },
            data: { status: 'COMPLETED' },
        });

        return { driverId, status: 'COMPLETED', batchId: batch.id, stripeTransferId: transfer.id, amount: totalAmount };
    } catch (err: any) {
        await prisma.payoutBatch.update({
            where: { id: batch.id },
            data: { status: 'FAILED', failureReason: err.message },
        });
        await prisma.payoutItem.updateMany({
            where: { payoutBatchId: batch.id },
            data: { status: 'FAILED' },
        });
        return { driverId, status: 'FAILED', batchId: batch.id, reason: err.message };
    }
};

// ============================================================
//  DRIVER PAYOUT HISTORY
// ============================================================

export const getDriverPayoutHistory = async (driverId: string) => {
    return prisma.payoutBatch.findMany({
        where: { driverId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
    });
};
