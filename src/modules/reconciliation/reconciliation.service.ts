import { prisma } from '../../config/index.js';
import { getStripeClient } from '../payments/stripe.service.js';
import { PAYMENT_STATUSES } from '../payments/payment.service.js';
import { logInfo, logError } from '../../utils/logger.js';

// ============================================================
//  CONSTANTS
// ============================================================

export const ISSUE_TYPES = {
    STRIPE_MISMATCH: 'STRIPE_MISMATCH',
    MISSING_WEBHOOK: 'MISSING_WEBHOOK',
    ORPHAN_INTENT: 'ORPHAN_INTENT',
    LEDGER_IMBALANCE: 'LEDGER_IMBALANCE',
    STALE_ESCROW: 'STALE_ESCROW',
    DISPUTE_PAYMENT_MISMATCH: 'DISPUTE_PAYMENT_MISMATCH',
} as const;

export const SEVERITY = {
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
} as const;

// Map Stripe PI status to expected internal states
const STRIPE_TO_INTERNAL_MAP: Record<string, string[]> = {
    requires_payment_method: [PAYMENT_STATUSES.CREATED, PAYMENT_STATUSES.PAYMENT_PENDING],
    requires_confirmation: [PAYMENT_STATUSES.CREATED, PAYMENT_STATUSES.PAYMENT_PENDING],
    requires_action: [PAYMENT_STATUSES.PAYMENT_PENDING],
    processing: [PAYMENT_STATUSES.PAYMENT_PENDING],
    requires_capture: [PAYMENT_STATUSES.PAID, PAYMENT_STATUSES.HELD_IN_ESCROW],
    succeeded: [
        PAYMENT_STATUSES.PAID,
        PAYMENT_STATUSES.HELD_IN_ESCROW,
        PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
        PAYMENT_STATUSES.TRANSFER_CREATED,
        PAYMENT_STATUSES.PAYOUT_COMPLETED,
    ],
    canceled: [PAYMENT_STATUSES.PAYMENT_FAILED, PAYMENT_STATUSES.REFUNDED],
};

// Safe auto-repair: Stripe says succeeded but we're stuck in PAYMENT_PENDING
const SAFE_REPAIRS: Record<string, { stripeStatus: string; internalStatus: string; targetStatus: string }[]> = {
    MISSING_WEBHOOK: [
        { stripeStatus: 'succeeded', internalStatus: PAYMENT_STATUSES.PAYMENT_PENDING, targetStatus: PAYMENT_STATUSES.PAID },
    ],
};

// ============================================================
//  HOURLY RECONCILIATION — Recent payments (last 2 hours)
// ============================================================

export const runHourlyReconciliation = async (): Promise<{ checked: number; issues: number; repaired: number }> => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Get recent payments that have a Stripe PI ID
    const payments = await prisma.payment.findMany({
        where: {
            stripePaymentIntentId: { not: null },
            updatedAt: { gte: twoHoursAgo },
            status: {
                notIn: [PAYMENT_STATUSES.PAYOUT_COMPLETED, PAYMENT_STATUSES.REFUNDED],
            },
        },
        select: {
            id: true,
            bookingId: true,
            stripePaymentIntentId: true,
            status: true,
        },
    });

    let issues = 0;
    let repaired = 0;

    for (const payment of payments) {
        try {
            const result = await reconcilePayment(payment);
            if (result.issue) issues++;
            if (result.repaired) repaired++;
        } catch (err) {
            logError(`Reconciliation error for payment ${payment.id}`, err);
        }
    }

    logInfo('Hourly reconciliation complete', { checked: payments.length, issues, repaired });
    return { checked: payments.length, issues, repaired };
};

// ============================================================
//  DAILY RECONCILIATION — Stale escrow + ledger balance checks
// ============================================================

export const runDailyReconciliation = async (): Promise<{ staleEscrow: number; ledgerIssues: number }> => {
    let staleEscrow = 0;
    let ledgerIssues = 0;

    // 1. Find payments stuck in HELD_IN_ESCROW for > 72h (should be PAYOUT_ELIGIBLE after 48h)
    const staleThreshold = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const stalePayments = await prisma.payment.findMany({
        where: {
            status: PAYMENT_STATUSES.HELD_IN_ESCROW,
            updatedAt: { lt: staleThreshold },
            booking: {
                disputes: {
                    none: {
                        status: { in: ['OPEN', 'EVIDENCE_COLLECTED', 'NEEDS_MANUAL_REVIEW', 'WAITING_FOR_USER_RESPONSE', 'ESCALATED'] },
                    },
                },
            },
        },
        select: { id: true, bookingId: true, updatedAt: true },
    });

    for (const payment of stalePayments) {
        await prisma.reconciliationIssue.create({
            data: {
                paymentId: payment.id,
                bookingId: payment.bookingId,
                issueType: ISSUE_TYPES.STALE_ESCROW,
                severity: SEVERITY.HIGH,
                description: `Payment stuck in HELD_IN_ESCROW since ${payment.updatedAt.toISOString()}. Should have moved to PAYOUT_ELIGIBLE after 48h.`,
                internalState: PAYMENT_STATUSES.HELD_IN_ESCROW,
            },
        });
        staleEscrow++;
    }

    // 2. Ledger balance sanity check: for each completed payment, debits should equal credits
    const completedPayments = await prisma.payment.findMany({
        where: {
            status: { in: [PAYMENT_STATUSES.PAYOUT_COMPLETED, PAYMENT_STATUSES.REFUNDED] },
            updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // last 24h
        },
        select: { id: true, bookingId: true, amountTotal: true },
    });

    for (const payment of completedPayments) {
        const entries = await prisma.ledgerEntry.findMany({
            where: { paymentId: payment.id },
        });

        const totalDebit = entries
            .filter(e => e.direction === 'DEBIT')
            .reduce((sum, e) => sum + e.amount, 0);
        const totalCredit = entries
            .filter(e => e.direction === 'CREDIT')
            .reduce((sum, e) => sum + e.amount, 0);

        // Allow tiny floating-point tolerance
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
            await prisma.reconciliationIssue.create({
                data: {
                    paymentId: payment.id,
                    bookingId: payment.bookingId,
                    issueType: ISSUE_TYPES.LEDGER_IMBALANCE,
                    severity: SEVERITY.CRITICAL,
                    description: `Ledger imbalance: debits=${totalDebit.toFixed(2)}, credits=${totalCredit.toFixed(2)}, diff=${(totalDebit - totalCredit).toFixed(2)}`,
                    internalState: 'LEDGER',
                    metadataJson: { totalDebit, totalCredit, entries: entries.length },
                },
            });
            ledgerIssues++;
        }
    }

    // 3. Dispute settlement consistency: resolved disputes must match payment state
    const resolvedDisputes = await prisma.dispute.findMany({
        where: {
            status: {
                in: ['RESOLVED_REFUND', 'RESOLVED_PAYOUT', 'RESOLVED_SPLIT', 'AUTO_RESOLVED_RIDER_REFUND', 'AUTO_RESOLVED_DRIVER_PAYOUT'],
            },
            booking: { payment: { isNot: null } },
            resolvedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: {
            id: true,
            bookingId: true,
            status: true,
            resolution: true,
            booking: { select: { payment: { select: { id: true, status: true } } } },
        },
    });

    for (const dispute of resolvedDisputes) {
        const payment = dispute.booking.payment;
        if (!payment) continue;

        const expectsRefund = ['RESOLVED_REFUND', 'AUTO_RESOLVED_RIDER_REFUND'].includes(dispute.status);
        const expectsPayout = ['RESOLVED_PAYOUT', 'AUTO_RESOLVED_DRIVER_PAYOUT'].includes(dispute.status);
        const expectsSplit = dispute.status === 'RESOLVED_SPLIT';
        const payoutStates = [
            PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
            PAYMENT_STATUSES.TRANSFER_CREATED,
            PAYMENT_STATUSES.PAYOUT_COMPLETED,
        ] as string[];
        const splitStates = [...payoutStates, PAYMENT_STATUSES.REFUNDED] as string[];
        const valid = expectsRefund
            ? payment.status === PAYMENT_STATUSES.REFUNDED
            : expectsPayout
                ? payoutStates.includes(payment.status)
                : expectsSplit
                    ? splitStates.includes(payment.status)
                    : true;

        if (!valid) {
            await prisma.reconciliationIssue.create({
                data: {
                    paymentId: payment.id,
                    bookingId: dispute.bookingId,
                    issueType: ISSUE_TYPES.DISPUTE_PAYMENT_MISMATCH,
                    severity: SEVERITY.CRITICAL,
                    description: `Dispute ${dispute.id} is ${dispute.status} but payment is ${payment.status}.`,
                    internalState: payment.status,
                    metadataJson: {
                        disputeId: dispute.id,
                        disputeStatus: dispute.status,
                        resolution: dispute.resolution,
                    },
                },
            });
            ledgerIssues++;
        }
    }

    logInfo('Daily reconciliation complete', { staleEscrow, ledgerIssues });
    return { staleEscrow, ledgerIssues };
};

// ============================================================
//  SINGLE PAYMENT RECONCILIATION
// ============================================================

async function reconcilePayment(payment: {
    id: string;
    bookingId: string;
    stripePaymentIntentId: string | null;
    status: string;
}): Promise<{ issue: boolean; repaired: boolean }> {
    if (!payment.stripePaymentIntentId) return { issue: false, repaired: false };

    const stripe = getStripeClient();
    const pi = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);

    const expectedInternalStates = STRIPE_TO_INTERNAL_MAP[pi.status] ?? [];

    if (expectedInternalStates.includes(payment.status)) {
        return { issue: false, repaired: false };
    }

    // Mismatch detected — attempt safe auto-repair
    const repairs = SAFE_REPAIRS.MISSING_WEBHOOK ?? [];
    const repair = repairs.find(
        r => r.stripeStatus === pi.status && r.internalStatus === payment.status
    );

    if (repair) {
        await prisma.payment.update({
            where: { id: payment.id },
            data: { status: repair.targetStatus },
        });

        await prisma.reconciliationIssue.create({
            data: {
                paymentId: payment.id,
                bookingId: payment.bookingId,
                issueType: ISSUE_TYPES.MISSING_WEBHOOK,
                severity: SEVERITY.MEDIUM,
                description: `Auto-repaired: Stripe=${pi.status}, internal was ${payment.status}, moved to ${repair.targetStatus}`,
                stripeState: pi.status,
                internalState: payment.status,
                autoRepaired: true,
                repairedAt: new Date(),
            },
        });

        logInfo(`Auto-repaired payment ${payment.id}: ${payment.status} -> ${repair.targetStatus}`);
        return { issue: true, repaired: true };
    }

    // Not safe to auto-repair — log issue for manual review
    await prisma.reconciliationIssue.create({
        data: {
            paymentId: payment.id,
            bookingId: payment.bookingId,
            issueType: ISSUE_TYPES.STRIPE_MISMATCH,
            severity: SEVERITY.HIGH,
            description: `State mismatch: Stripe=${pi.status}, internal=${payment.status}`,
            stripeState: pi.status,
            internalState: payment.status,
        },
    });

    return { issue: true, repaired: false };
}

// ============================================================
//  ADMIN QUERIES
// ============================================================

export const listIssues = async (params: {
    status?: 'open' | 'resolved';
    issueType?: string;
    severity?: string;
    page?: number;
    limit?: number;
}) => {
    const { status, issueType, severity, page = 1, limit = 20 } = params;

    const where: any = {};
    if (status === 'open') where.resolvedAt = null;
    if (status === 'resolved') where.resolvedAt = { not: null };
    if (issueType) where.issueType = issueType;
    if (severity) where.severity = severity;

    const [issues, total] = await Promise.all([
        prisma.reconciliationIssue.findMany({
            where,
            orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.reconciliationIssue.count({ where }),
    ]);

    return {
        issues,
        total,
        page,
        limit,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

export const resolveIssue = async (issueId: string, adminId: string, resolution: string) => {
    const issue = await prisma.reconciliationIssue.findUnique({ where: { id: issueId } });
    if (!issue) throw new Error('ISSUE_NOT_FOUND');
    if (issue.resolvedAt) throw new Error('ISSUE_ALREADY_RESOLVED');

    return prisma.reconciliationIssue.update({
        where: { id: issueId },
        data: {
            resolvedBy: adminId,
            resolvedAt: new Date(),
            resolution,
        },
    });
};

export const getIssueSummary = async () => {
    const [open, autoRepaired, total] = await Promise.all([
        prisma.reconciliationIssue.count({ where: { resolvedAt: null } }),
        prisma.reconciliationIssue.count({ where: { autoRepaired: true } }),
        prisma.reconciliationIssue.count(),
    ]);

    // Count by severity (open only)
    const bySeverity = await prisma.reconciliationIssue.groupBy({
        by: ['severity'],
        where: { resolvedAt: null },
        _count: true,
    });

    return {
        open,
        autoRepaired,
        total,
        bySeverity: Object.fromEntries(bySeverity.map((s: any) => [s.severity, s._count])),
    };
};
