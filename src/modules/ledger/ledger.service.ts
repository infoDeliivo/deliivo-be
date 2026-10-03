import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/index.js';

// ============================================================
//  ENTRY TYPES
// ============================================================

export const ENTRY_TYPES = {
    RIDER_PAYMENT_RECEIVED: 'RIDER_PAYMENT_RECEIVED',
    DRIVER_EARNING_LIABILITY: 'DRIVER_EARNING_LIABILITY',
    PLATFORM_FEE_REVENUE: 'PLATFORM_FEE_REVENUE',
    STRIPE_FEE_EXPENSE: 'STRIPE_FEE_EXPENSE',
    REFUND_TO_RIDER: 'REFUND_TO_RIDER',
    DRIVER_TRANSFER_CREATED: 'DRIVER_TRANSFER_CREATED',
    PAYOUT_FAILURE_REVERSAL: 'PAYOUT_FAILURE_REVERSAL',
    PLATFORM_FEE_REVERSAL: 'PLATFORM_FEE_REVERSAL',
} as const;

export const ACCOUNT_TYPES = {
    RIDER: 'RIDER',
    DRIVER: 'DRIVER',
    PLATFORM: 'PLATFORM',
    PROVIDER: 'PROVIDER',
} as const;

export const DIRECTION = {
    DEBIT: 'DEBIT',
    CREDIT: 'CREDIT',
} as const;

// ============================================================
//  RECORD PAYMENT RECEIVED
// ============================================================

/**
 * Records a payment received from a rider.
 * Creates 3 entries in one group:
 *   1. RIDER_PAYMENT_RECEIVED (platform debit — money in)
 *   2. DRIVER_EARNING_LIABILITY (platform credit — owed to driver)
 *   3. PLATFORM_FEE_REVENUE (platform credit — fee earned)
 */
export const recordPaymentReceived = async (params: {
    paymentId: string;
    bookingId: string;
    riderId: string;
    driverId: string;
    totalAmount: number;
    fareAmount: number;
    platformFee: number;
    currency: string;
}) => {
    const groupId = randomUUID();

    await prisma.ledgerEntry.createMany({
        data: [
            {
                entryGroupId: groupId,
                paymentId: params.paymentId,
                bookingId: params.bookingId,
                userId: params.riderId,
                accountType: ACCOUNT_TYPES.RIDER,
                entryType: ENTRY_TYPES.RIDER_PAYMENT_RECEIVED,
                direction: DIRECTION.DEBIT,
                amount: params.totalAmount,
                currency: params.currency,
            },
            {
                entryGroupId: groupId,
                paymentId: params.paymentId,
                bookingId: params.bookingId,
                userId: params.driverId,
                accountType: ACCOUNT_TYPES.DRIVER,
                entryType: ENTRY_TYPES.DRIVER_EARNING_LIABILITY,
                direction: DIRECTION.CREDIT,
                amount: params.fareAmount,
                currency: params.currency,
            },
            ...(params.platformFee > 0
                ? [{
                    entryGroupId: groupId,
                    paymentId: params.paymentId,
                    bookingId: params.bookingId,
                    userId: null,
                    accountType: ACCOUNT_TYPES.PLATFORM,
                    entryType: ENTRY_TYPES.PLATFORM_FEE_REVENUE,
                    direction: DIRECTION.CREDIT,
                    amount: params.platformFee,
                    currency: params.currency,
                }]
                : []),
        ],
    });

    return { entryGroupId: groupId };
};

// ============================================================
//  RECORD REFUND
// ============================================================

/**
 * Records a refund as three entries: the rider is credited the whole refund, and it is funded by the
 * driver and the platform in proportion to how the original payment was split.
 *
 * The platform entry matters under the fee-on-top model. Debiting the driver for the entire gross
 * refund — as this did before — made the driver fund the platform's share: on a 10.20 payment
 * (10.00 fare + 0.20 fee) refunded 50%, the driver lost 5.10 of a 10.00 fare while the platform kept
 * its fee in full.
 *
 * `fareRefundAmount + feeRefundAmount` must equal `refundAmount` exactly, or reconciliation's
 * debit/credit check will flag the payment. `resolveRefundSplit` guarantees that.
 */
export const recordRefund = async (params: {
    paymentId: string;
    bookingId: string;
    riderId: string;
    driverId: string;
    refundAmount: number;
    fareRefundAmount: number;
    feeRefundAmount: number;
    currency: string;
}) => {
    const groupId = randomUUID();

    const entries: Prisma.LedgerEntryCreateManyInput[] = [
        {
            entryGroupId: groupId,
            paymentId: params.paymentId,
            bookingId: params.bookingId,
            userId: params.riderId,
            accountType: ACCOUNT_TYPES.RIDER,
            entryType: ENTRY_TYPES.REFUND_TO_RIDER,
            direction: DIRECTION.CREDIT,
            amount: params.refundAmount,
            currency: params.currency,
        },
        {
            entryGroupId: groupId,
            paymentId: params.paymentId,
            bookingId: params.bookingId,
            userId: params.driverId,
            accountType: ACCOUNT_TYPES.DRIVER,
            entryType: ENTRY_TYPES.DRIVER_EARNING_LIABILITY,
            direction: DIRECTION.DEBIT,
            amount: params.fareRefundAmount,
            currency: params.currency,
        },
    ];

    // Mirrors the `platformFee > 0` guard on the payment side: no zero-amount entries.
    if (params.feeRefundAmount > 0) {
        entries.push({
            entryGroupId: groupId,
            paymentId: params.paymentId,
            bookingId: params.bookingId,
            userId: null,
            accountType: ACCOUNT_TYPES.PLATFORM,
            entryType: ENTRY_TYPES.PLATFORM_FEE_REVERSAL,
            direction: DIRECTION.DEBIT,
            amount: params.feeRefundAmount,
            currency: params.currency,
        });
    }

    await prisma.ledgerEntry.createMany({ data: entries });

    return { entryGroupId: groupId };
};

// ============================================================
//  RECORD TRANSFER TO DRIVER
// ============================================================

export const recordTransfer = async (params: {
    paymentId: string;
    bookingId: string;
    driverId: string;
    transferAmount: number;
    currency: string;
}) => {
    const groupId = randomUUID();

    await prisma.ledgerEntry.createMany({
        data: [
            {
                entryGroupId: groupId,
                paymentId: params.paymentId,
                bookingId: params.bookingId,
                userId: params.driverId,
                accountType: ACCOUNT_TYPES.DRIVER,
                entryType: ENTRY_TYPES.DRIVER_TRANSFER_CREATED,
                direction: DIRECTION.DEBIT,
                amount: params.transferAmount,
                currency: params.currency,
            },
        ],
    });

    return { entryGroupId: groupId };
};

/**
 * Reopens the driver's liability after a transfer fails.
 *
 * `recordTransfer` debits the liability as soon as the transfer is created, so without this reversal
 * a failed transfer leaves the money permanently discharged from the ledger and the driver's derived
 * balance understated — they appear to have been paid.
 *
 * Specified in the payment design as PAYOUT_FAILURE_REVERSAL ("reopen liability if transfer fails").
 */
export const recordPayoutFailureReversal = async (params: {
    paymentId: string;
    bookingId: string;
    driverId: string;
    reversedAmount: number;
    currency: string;
    reason?: string;
}) => {
    const groupId = randomUUID();

    await prisma.ledgerEntry.create({
        data: {
            entryGroupId: groupId,
            paymentId: params.paymentId,
            bookingId: params.bookingId,
            userId: params.driverId,
            accountType: ACCOUNT_TYPES.DRIVER,
            entryType: ENTRY_TYPES.PAYOUT_FAILURE_REVERSAL,
            direction: DIRECTION.CREDIT,
            amount: params.reversedAmount,
            currency: params.currency,
            ...(params.reason ? { metadataJson: { reason: params.reason } } : {}),
        },
    });

    return { entryGroupId: groupId };
};

/**
 * Records what the payment provider charged us for processing a payment.
 *
 * Specified as STRIPE_FEE_EXPENSE ("stored when available from provider balance transaction"). It was
 * never written, so the platform's real margin was absent from the ledger and from reporting — which
 * matters because the platform is merchant of record and absorbs this cost. At a low take rate the
 * fee can exceed the service fee, and nothing surfaced that.
 *
 * Written as a balanced pair: the provider is credited what it earned, and the platform is debited
 * for paying it. A single-sided entry would break the per-payment debit/credit equality that
 * reconciliation checks and raise LEDGER_IMBALANCE on every payment.
 */
export const recordProviderFeeExpense = async (params: {
    paymentId: string;
    bookingId: string;
    feeAmount: number;
    currency: string;
}) => {
    if (!(params.feeAmount > 0)) {
        return { entryGroupId: null };
    }

    const groupId = randomUUID();

    await prisma.ledgerEntry.createMany({
        data: [
            {
                entryGroupId: groupId,
                paymentId: params.paymentId,
                bookingId: params.bookingId,
                userId: null,
                accountType: ACCOUNT_TYPES.PROVIDER,
                entryType: ENTRY_TYPES.STRIPE_FEE_EXPENSE,
                direction: DIRECTION.CREDIT,
                amount: params.feeAmount,
                currency: params.currency,
            },
            {
                entryGroupId: groupId,
                paymentId: params.paymentId,
                bookingId: params.bookingId,
                userId: null,
                accountType: ACCOUNT_TYPES.PLATFORM,
                entryType: ENTRY_TYPES.STRIPE_FEE_EXPENSE,
                direction: DIRECTION.DEBIT,
                amount: params.feeAmount,
                currency: params.currency,
            },
        ],
    });

    return { entryGroupId: groupId };
};

// ============================================================
//  DERIVE BALANCES
// ============================================================

/**
 * Calculates the net balance for a driver from ledger entries.
 * Positive = owed to driver. Negative = overpaid.
 */
export const getDriverBalance = async (driverId: string, currency?: string) => {
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            userId: driverId,
            accountType: ACCOUNT_TYPES.DRIVER,
            ...(currency ? { currency } : {}),
        },
    });

    let balance = 0;
    for (const entry of entries) {
        if (entry.direction === DIRECTION.CREDIT) {
            balance += entry.amount;
        } else {
            balance -= entry.amount;
        }
    }

    return { driverId, balance, currency: currency ?? 'ALL', entriesCount: entries.length };
};

/**
 * Get driver earnings summary grouped by status.
 */
export const getDriverEarnings = async (driverId: string) => {
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            userId: driverId,
            accountType: ACCOUNT_TYPES.DRIVER,
        },
        orderBy: { createdAt: 'desc' },
    });

    let totalEarned = 0;
    let totalPaidOut = 0;
    let totalRefunded = 0;

    for (const entry of entries) {
        if (entry.entryType === ENTRY_TYPES.DRIVER_EARNING_LIABILITY && entry.direction === DIRECTION.CREDIT) {
            totalEarned += entry.amount;
        }
        if (entry.entryType === ENTRY_TYPES.DRIVER_TRANSFER_CREATED) {
            totalPaidOut += entry.amount;
        }
        if (entry.entryType === ENTRY_TYPES.DRIVER_EARNING_LIABILITY && entry.direction === DIRECTION.DEBIT) {
            totalRefunded += entry.amount;
        }
    }

    return {
        driverId,
        totalEarned,
        totalPaidOut,
        totalRefunded,
        pendingBalance: totalEarned - totalPaidOut - totalRefunded,
        entriesCount: entries.length,
    };
};

export const getDriverEarningItems = async (driverId: string) => {
    return prisma.payment.findMany({
        where: {
            booking: {
                ride: { driverId },
            },
        },
        orderBy: { createdAt: 'desc' },
        include: {
            booking: {
                select: {
                    id: true,
                    status: true,
                    passenger: { select: { id: true, firstName: true } },
                    pickupAddress: true,
                    dropoffAddress: true,
                    completedAt: true,
                    refundAmount: true,
                    refundedAt: true,
                    disputes: {
                        select: { id: true, status: true, reason: true },
                        orderBy: { createdAt: 'desc' },
                    },
                    ride: {
                        select: {
                            id: true,
                            originAddress: true,
                            destinationAddress: true,
                            departureDate: true,
                            departureTime: true,
                        },
                    },
                },
            },
            payoutItems: {
                include: {
                    batch: {
                        select: {
                            id: true,
                            status: true,
                            stripeTransferId: true,
                            createdAt: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            },
        },
    });
};
