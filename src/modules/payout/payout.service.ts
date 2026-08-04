import { prisma } from '../../config/index.js';
import { BookingStatus } from '@prisma/client';
import { getStripeClient } from '../payments/stripe.service.js';
import { recordTransfer } from '../ledger/ledger.service.js';
import { PAYMENT_STATUSES, markTransferCreated, markPayoutCompleted } from '../payments/payment.service.js';
import { processOutboxEvents } from '../payments/payment-outbox.worker.js';
import { openDisputeWhereForPaymentEligibility } from '../dispute/dispute-settlement.service.js';
import { OPEN_DISPUTE_STATUSES } from '../dispute/dispute.constants.js';

const PAYOUT_ELIGIBILITY_DELAY_MINUTES = Number(process.env.PAYOUT_ELIGIBILITY_DELAY_MINUTES || '30');

// ============================================================
//  ELIGIBILITY
// ============================================================

export const checkAndMarkEligible = async () => {
    const outboxResult = await processOutboxEvents(50);
    const cutoff = new Date(Date.now() - PAYOUT_ELIGIBILITY_DELAY_MINUTES * 60 * 1000);

    // Find completed payments held in reserve past the payout eligibility delay.
    const eligible = await prisma.payment.findMany({
        where: {
            status: PAYMENT_STATUSES.HELD_IN_ESCROW,
            booking: {
                ...openDisputeWhereForPaymentEligibility,
                status: BookingStatus.COMPLETED,
                completedAt: { lt: cutoff },
            },
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

    return {
        checked: eligible.length,
        markedEligible: updated,
        outboxProcessed: outboxResult.processed,
        outboxFailed: outboxResult.failed,
        outboxTotal: outboxResult.total,
        eligibilityDelayMinutes: PAYOUT_ELIGIBILITY_DELAY_MINUTES,
    };
};

// ============================================================
//  PROCESS PAYOUT BATCH FOR A DRIVER
// ============================================================

export const processDriverPayout = async (driverId: string) => {
    const payments = await prisma.payment.findMany({
        where: {
            status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
            booking: {
                ride: { driverId },
                disputes: {
                    none: {
                        status: { in: OPEN_DISPUTE_STATUSES },
                    },
                },
            },
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

    if (process.env.STRIPE_CONNECT_MOCK_MODE === 'true') {
        for (const payment of payments) {
            await markTransferCreated(payment.id);
        }

        for (const payment of payments) {
            await recordTransfer({
                paymentId: payment.id,
                bookingId: payment.bookingId,
                driverId,
                transferAmount: payment.fareAmount,
                currency: payment.currency,
            });
        }

        await prisma.payoutBatch.update({
            where: { id: batch.id },
            data: { status: 'COMPLETED', stripeTransferId: `tr_mock_${batch.id}` },
        });

        for (const payment of payments) {
            await markPayoutCompleted(payment.id);
        }

        await prisma.payoutItem.updateMany({
            where: { payoutBatchId: batch.id },
            data: { status: 'COMPLETED' },
        });

        return { driverId, status: 'COMPLETED', batchId: batch.id, stripeTransferId: `tr_mock_${batch.id}`, amount: totalAmount };
    }

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

export const getEligiblePayoutCandidates = async () => {
    const payments = await prisma.payment.findMany({
        where: {
            status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
            booking: {
                disputes: {
                    none: {
                        status: { in: OPEN_DISPUTE_STATUSES },
                    },
                },
            },
        },
        include: {
            booking: {
                select: {
                    id: true,
                    status: true,
                    passenger: { select: { id: true, firstName: true } },
                    ride: {
                        select: {
                            id: true,
                            originAddress: true,
                            destinationAddress: true,
                            departureDate: true,
                            departureTime: true,
                            driver: {
                                select: {
                                    id: true,
                                    firstName: true,
                                    stripeAccountId: true,
                                    stripeOnboardingComplete: true,
                                },
                            },
                        },
                    },
                },
            },
        },
        orderBy: { payoutEligibleAt: 'asc' },
    });

    type PaymentWithBooking = (typeof payments)[number];
    const byDriver = new Map<string, {
        driverId: string;
        driverName: string | null;
        stripeAccountId: string | null;
        stripeOnboardingComplete: boolean;
        currency: string;
        amountTotal: number;
        paymentsCount: number;
        payments: PaymentWithBooking[];
    }>();

    for (const payment of payments) {
        const driver = payment.booking.ride.driver;
        const existing = byDriver.get(driver.id);
        if (existing) {
            existing.amountTotal += payment.fareAmount;
            existing.paymentsCount += 1;
            existing.payments.push(payment);
            continue;
        }

        byDriver.set(driver.id, {
            driverId: driver.id,
            driverName: driver.firstName,
            stripeAccountId: driver.stripeAccountId,
            stripeOnboardingComplete: driver.stripeOnboardingComplete,
            currency: payment.currency,
            amountTotal: payment.fareAmount,
            paymentsCount: 1,
            payments: [payment],
        });
    }

    return Array.from(byDriver.values()).map(candidate => ({
        ...candidate,
        amountTotal: Math.round(candidate.amountTotal * 100) / 100,
    }));
};

// ============================================================
//  AUTO-PROCESS READY DRIVER PAYOUTS
// ============================================================

export const processEligibleDriverPayouts = async () => {
    const candidates = await getEligiblePayoutCandidates();
    const readyCandidates = candidates.filter(
        candidate => candidate.stripeAccountId && candidate.stripeOnboardingComplete
    );

    const results = [];
    for (const candidate of readyCandidates) {
        results.push(await processDriverPayout(candidate.driverId));
    }

    return {
        checkedDrivers: candidates.length,
        skippedDrivers: candidates.length - readyCandidates.length,
        processedDrivers: results.filter(result => result.status === 'COMPLETED').length,
        failedDrivers: results.filter(result => result.status === 'FAILED').length,
        results,
    };
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
