/**
 * Integration Test: Reconciliation & Offline Sync (Phase 5)
 *
 * Tests:
 * - Reconciliation issue creation and resolution
 * - Hourly reconciliation (Stripe vs internal state comparison)
 * - Daily reconciliation (stale escrow + ledger balance)
 * - Admin issue listing and summary
 * - Offline action sync (idempotent batch processing)
 */

import { randomUUID } from 'crypto';

// ============================================================
//  IN-MEMORY STATE
// ============================================================

type MockPayment = {
    id: string;
    bookingId: string;
    rideId: string;
    riderId: string;
    stripePaymentIntentId: string | null;
    amountTotal: number;
    currency: string;
    fareAmount: number;
    platformFeeAmount: number;
    status: string;
    failureReason: string | null;
    payoutEligibleAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

type MockReconciliationIssue = {
    id: string;
    paymentId: string | null;
    bookingId: string | null;
    issueType: string;
    severity: string;
    description: string;
    stripeState: string | null;
    internalState: string | null;
    detectedAt: Date;
    autoRepaired: boolean;
    repairedAt: Date | null;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    resolution: string | null;
    metadataJson: any;
};

type MockLedgerEntry = {
    id: string;
    entryGroupId: string;
    paymentId: string | null;
    bookingId: string | null;
    userId: string | null;
    accountType: string;
    entryType: string;
    direction: string;
    amount: number;
    currency: string;
    metadataJson: any;
    createdAt: Date;
};

type MockRideEvent = {
    id: string;
    rideId: string;
    bookingId: string | null;
    actionId: string;
    eventType: string;
    actorType: string;
    actorId: string;
    lat: number | null;
    lng: number | null;
    clientTimestamp: Date;
    serverTimestamp: Date;
    validationStatus: string;
    metadataJson: any;
};

const payments: MockPayment[] = [];
const reconciliationIssues: MockReconciliationIssue[] = [];
const ledgerEntries: MockLedgerEntry[] = [];
const rideEvents: MockRideEvent[] = [];

const DRIVER_ID = 'driver-r1';
const RIDER_ID = 'rider-r1';
const RIDE_ID = 'ride-r1';
const BOOKING_ID = 'booking-r1';
const PAYMENT_ID = 'payment-r1';
const STRIPE_PI_ID = 'pi_test_reconcile_1';

// ============================================================
//  MOCK DEPENDENCIES (must come before imports)
// ============================================================

jest.mock('../notification/notification.service.js', () => ({
    createNotification: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/push.service.ts', () => ({
    sendPushNotification: jest.fn(),
}));

// ============================================================
//  MOCK STRIPE
// ============================================================

const mockStripePaymentIntents: Record<string, { id: string; status: string }> = {
    [STRIPE_PI_ID]: { id: STRIPE_PI_ID, status: 'succeeded' },
    'pi_test_mismatch': { id: 'pi_test_mismatch', status: 'succeeded' },
};

jest.mock('../payments/stripe.service.js', () => ({
    getStripeClient: () => ({
        paymentIntents: {
            retrieve: jest.fn((piId: string) => {
                const pi = mockStripePaymentIntents[piId];
                if (!pi) return Promise.reject(new Error('not found'));
                return Promise.resolve(pi);
            }),
        },
    }),
}));

// ============================================================
//  MOCK PRISMA
// ============================================================

jest.mock('../../config/index.js', () => ({
    prisma: {
        payment: {
            findMany: jest.fn(({ where }: any) => {
                let result = [...payments];
                if (where?.stripePaymentIntentId?.not === null) {
                    result = result.filter(p => p.stripePaymentIntentId != null);
                }
                if (where?.updatedAt?.gte) {
                    result = result.filter(p => p.updatedAt >= where.updatedAt.gte);
                }
                if (where?.updatedAt?.lt) {
                    result = result.filter(p => p.updatedAt < where.updatedAt.lt);
                }
                if (where?.status?.notIn) {
                    result = result.filter(p => !where.status.notIn.includes(p.status));
                }
                if (where?.status?.in) {
                    result = result.filter(p => where.status.in.includes(p.status));
                }
                if (where?.status && typeof where.status === 'string') {
                    result = result.filter(p => p.status === where.status);
                }
                return Promise.resolve(result);
            }),
            update: jest.fn(({ where, data }: any) => {
                const p = payments.find(x => x.id === where.id);
                if (!p) return Promise.reject(new Error('Not found'));
                Object.assign(p, data, { updatedAt: new Date() });
                return Promise.resolve(p);
            }),
        },
        reconciliationIssue: {
            create: jest.fn(({ data }: any) => {
                const issue: MockReconciliationIssue = {
                    id: randomUUID(),
                    paymentId: data.paymentId ?? null,
                    bookingId: data.bookingId ?? null,
                    issueType: data.issueType,
                    severity: data.severity ?? 'MEDIUM',
                    description: data.description,
                    stripeState: data.stripeState ?? null,
                    internalState: data.internalState ?? null,
                    detectedAt: new Date(),
                    autoRepaired: data.autoRepaired ?? false,
                    repairedAt: data.repairedAt ?? null,
                    resolvedBy: data.resolvedBy ?? null,
                    resolvedAt: data.resolvedAt ?? null,
                    resolution: data.resolution ?? null,
                    metadataJson: data.metadataJson ?? null,
                };
                reconciliationIssues.push(issue);
                return Promise.resolve(issue);
            }),
            findUnique: jest.fn(({ where }: any) => {
                const issue = reconciliationIssues.find(i => i.id === where.id);
                return Promise.resolve(issue ?? null);
            }),
            findMany: jest.fn(({ where, orderBy, skip, take }: any) => {
                let result = [...reconciliationIssues];
                if (where?.resolvedAt === null) result = result.filter(i => i.resolvedAt === null);
                if (where?.resolvedAt?.not === null) result = result.filter(i => i.resolvedAt !== null);
                if (where?.issueType) result = result.filter(i => i.issueType === where.issueType);
                if (where?.severity) result = result.filter(i => i.severity === where.severity);
                if (skip) result = result.slice(skip);
                if (take) result = result.slice(0, take);
                return Promise.resolve(result);
            }),
            count: jest.fn(({ where }: any = {}) => {
                let result = [...reconciliationIssues];
                if (where?.resolvedAt === null) result = result.filter(i => i.resolvedAt === null);
                if (where?.autoRepaired === true) result = result.filter(i => i.autoRepaired === true);
                return Promise.resolve(result.length);
            }),
            update: jest.fn(({ where, data }: any) => {
                const issue = reconciliationIssues.find(i => i.id === where.id);
                if (!issue) return Promise.reject(new Error('Not found'));
                Object.assign(issue, data);
                return Promise.resolve(issue);
            }),
            groupBy: jest.fn(({ by, where, _count }: any) => {
                let result = [...reconciliationIssues];
                if (where?.resolvedAt === null) result = result.filter(i => i.resolvedAt === null);
                const groups: Record<string, number> = {};
                for (const item of result) {
                    const key = (item as any)[by[0]];
                    groups[key] = (groups[key] || 0) + 1;
                }
                return Promise.resolve(
                    Object.entries(groups).map(([severity, count]) => ({ severity, _count: count }))
                );
            }),
        },
        ledgerEntry: {
            findMany: jest.fn(({ where }: any) => {
                let result = [...ledgerEntries];
                if (where?.paymentId) result = result.filter(e => e.paymentId === where.paymentId);
                return Promise.resolve(result);
            }),
        },
        rideEvent: {
            findUnique: jest.fn(({ where }: any) => {
                const event = rideEvents.find(e => e.actionId === where.actionId);
                return Promise.resolve(event ?? null);
            }),
            create: jest.fn(({ data }: any) => {
                const event: MockRideEvent = {
                    id: randomUUID(),
                    rideId: data.rideId,
                    bookingId: data.bookingId ?? null,
                    actionId: data.actionId,
                    eventType: data.eventType,
                    actorType: data.actorType,
                    actorId: data.actorId,
                    lat: data.lat ?? null,
                    lng: data.lng ?? null,
                    clientTimestamp: new Date(data.clientTimestamp),
                    serverTimestamp: new Date(),
                    validationStatus: 'VALID',
                    metadataJson: null,
                };
                rideEvents.push(event);
                return Promise.resolve(event);
            }),
        },
    },
}));

// ============================================================
//  MOCK LOGGER
// ============================================================

jest.mock('../../utils/logger.js', () => ({
    logInfo: jest.fn(),
    logError: jest.fn(),
}));

// ============================================================
//  IMPORTS (after mocks)
// ============================================================

import {
    runHourlyReconciliation,
    runDailyReconciliation,
    listIssues,
    resolveIssue,
    getIssueSummary,
    ISSUE_TYPES,
} from '../reconciliation/reconciliation.service.js';
import { syncOfflineActions } from '../ride-operations/ride-operations.service.js';

// ============================================================
//  RECONCILIATION TESTS
// ============================================================

describe('Reconciliation Service', () => {
    beforeEach(() => {
        payments.length = 0;
        reconciliationIssues.length = 0;
        ledgerEntries.length = 0;
    });

    test('hourly reconciliation detects no issues when states match', async () => {
        payments.push({
            id: PAYMENT_ID,
            bookingId: BOOKING_ID,
            rideId: RIDE_ID,
            riderId: RIDER_ID,
            stripePaymentIntentId: STRIPE_PI_ID,
            amountTotal: 15,
            currency: 'EUR',
            fareAmount: 14,
            platformFeeAmount: 1,
            status: 'PAID', // Stripe says 'succeeded', PAID is valid
            failureReason: null,
            payoutEligibleAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const result = await runHourlyReconciliation();
        expect(result.checked).toBe(1);
        expect(result.issues).toBe(0);
        expect(result.repaired).toBe(0);
    });

    test('hourly reconciliation auto-repairs missed webhook (PAYMENT_PENDING + succeeded)', async () => {
        payments.push({
            id: 'payment-miss',
            bookingId: BOOKING_ID,
            rideId: RIDE_ID,
            riderId: RIDER_ID,
            stripePaymentIntentId: 'pi_test_mismatch', // Stripe says succeeded
            amountTotal: 20,
            currency: 'EUR',
            fareAmount: 19,
            platformFeeAmount: 1,
            status: 'PAYMENT_PENDING', // Stuck — missed webhook
            failureReason: null,
            payoutEligibleAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const result = await runHourlyReconciliation();
        expect(result.issues).toBe(1);
        expect(result.repaired).toBe(1);

        // Payment should be moved to PAID
        expect(payments[0].status).toBe('PAID');

        // Issue recorded as auto-repaired
        expect(reconciliationIssues.length).toBe(1);
        expect(reconciliationIssues[0].autoRepaired).toBe(true);
        expect(reconciliationIssues[0].issueType).toBe(ISSUE_TYPES.MISSING_WEBHOOK);
    });

    test('hourly reconciliation logs mismatch when not safe to auto-repair', async () => {
        payments.push({
            id: 'payment-bad',
            bookingId: BOOKING_ID,
            rideId: RIDE_ID,
            riderId: RIDER_ID,
            stripePaymentIntentId: STRIPE_PI_ID, // Stripe says succeeded
            amountTotal: 10,
            currency: 'EUR',
            fareAmount: 9,
            platformFeeAmount: 1,
            status: 'CREATED', // Not a safe repair case
            failureReason: null,
            payoutEligibleAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const result = await runHourlyReconciliation();
        expect(result.issues).toBe(1);
        expect(result.repaired).toBe(0);
        expect(reconciliationIssues[0].issueType).toBe(ISSUE_TYPES.STRIPE_MISMATCH);
        expect(reconciliationIssues[0].severity).toBe('HIGH');
    });

    test('daily reconciliation detects stale escrow', async () => {
        payments.push({
            id: 'payment-stale',
            bookingId: BOOKING_ID,
            rideId: RIDE_ID,
            riderId: RIDER_ID,
            stripePaymentIntentId: STRIPE_PI_ID,
            amountTotal: 25,
            currency: 'EUR',
            fareAmount: 24,
            platformFeeAmount: 1,
            status: 'HELD_IN_ESCROW',
            failureReason: null,
            payoutEligibleAt: null,
            createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago > 72h
        });

        const result = await runDailyReconciliation();
        expect(result.staleEscrow).toBe(1);
        expect(reconciliationIssues[0].issueType).toBe(ISSUE_TYPES.STALE_ESCROW);
    });

    test('daily reconciliation detects ledger imbalance', async () => {
        payments.push({
            id: 'payment-imbalance',
            bookingId: BOOKING_ID,
            rideId: RIDE_ID,
            riderId: RIDER_ID,
            stripePaymentIntentId: STRIPE_PI_ID,
            amountTotal: 10,
            currency: 'EUR',
            fareAmount: 9,
            platformFeeAmount: 1,
            status: 'PAYOUT_COMPLETED',
            failureReason: null,
            payoutEligibleAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Imbalanced ledger: 10 debit but only 8 credit
        ledgerEntries.push(
            { id: randomUUID(), entryGroupId: 'g1', paymentId: 'payment-imbalance', bookingId: BOOKING_ID, userId: RIDER_ID, accountType: 'RIDER', entryType: 'RIDER_PAYMENT_RECEIVED', direction: 'DEBIT', amount: 10, currency: 'EUR', metadataJson: null, createdAt: new Date() },
            { id: randomUUID(), entryGroupId: 'g1', paymentId: 'payment-imbalance', bookingId: BOOKING_ID, userId: DRIVER_ID, accountType: 'DRIVER', entryType: 'DRIVER_EARNING_LIABILITY', direction: 'CREDIT', amount: 8, currency: 'EUR', metadataJson: null, createdAt: new Date() },
        );

        const result = await runDailyReconciliation();
        expect(result.ledgerIssues).toBe(1);
        expect(reconciliationIssues[0].issueType).toBe(ISSUE_TYPES.LEDGER_IMBALANCE);
        expect(reconciliationIssues[0].severity).toBe('CRITICAL');
    });
});

// ============================================================
//  ADMIN ISSUE MANAGEMENT TESTS
// ============================================================

describe('Reconciliation Admin', () => {
    beforeEach(() => {
        reconciliationIssues.length = 0;
    });

    test('lists open issues', async () => {
        reconciliationIssues.push({
            id: 'issue-1',
            paymentId: PAYMENT_ID,
            bookingId: BOOKING_ID,
            issueType: ISSUE_TYPES.STRIPE_MISMATCH,
            severity: 'HIGH',
            description: 'test',
            stripeState: 'succeeded',
            internalState: 'CREATED',
            detectedAt: new Date(),
            autoRepaired: false,
            repairedAt: null,
            resolvedBy: null,
            resolvedAt: null,
            resolution: null,
            metadataJson: null,
        });

        const result = await listIssues({ status: 'open' });
        expect(result.issues.length).toBe(1);
        expect(result.total).toBe(1);
    });

    test('resolves an issue', async () => {
        reconciliationIssues.push({
            id: 'issue-2',
            paymentId: PAYMENT_ID,
            bookingId: BOOKING_ID,
            issueType: ISSUE_TYPES.STALE_ESCROW,
            severity: 'HIGH',
            description: 'stale',
            stripeState: null,
            internalState: 'HELD_IN_ESCROW',
            detectedAt: new Date(),
            autoRepaired: false,
            repairedAt: null,
            resolvedBy: null,
            resolvedAt: null,
            resolution: null,
            metadataJson: null,
        });

        const resolved = await resolveIssue('issue-2', 'admin-001', 'Manually moved to payout eligible');
        expect(resolved.resolvedBy).toBe('admin-001');
        expect(resolved.resolvedAt).toBeDefined();
        expect(resolved.resolution).toBe('Manually moved to payout eligible');
    });

    test('rejects resolving already-resolved issue', async () => {
        reconciliationIssues.push({
            id: 'issue-3',
            paymentId: PAYMENT_ID,
            bookingId: BOOKING_ID,
            issueType: ISSUE_TYPES.MISSING_WEBHOOK,
            severity: 'MEDIUM',
            description: 'already resolved',
            stripeState: null,
            internalState: null,
            detectedAt: new Date(),
            autoRepaired: true,
            repairedAt: new Date(),
            resolvedBy: 'system',
            resolvedAt: new Date(),
            resolution: 'auto',
            metadataJson: null,
        });

        await expect(resolveIssue('issue-3', 'admin-001', 'try again'))
            .rejects.toThrow('ISSUE_ALREADY_RESOLVED');
    });

    test('returns issue summary', async () => {
        reconciliationIssues.push(
            { id: 'is-a', paymentId: null, bookingId: null, issueType: ISSUE_TYPES.STRIPE_MISMATCH, severity: 'HIGH', description: 'a', stripeState: null, internalState: null, detectedAt: new Date(), autoRepaired: false, repairedAt: null, resolvedBy: null, resolvedAt: null, resolution: null, metadataJson: null },
            { id: 'is-b', paymentId: null, bookingId: null, issueType: ISSUE_TYPES.MISSING_WEBHOOK, severity: 'MEDIUM', description: 'b', stripeState: null, internalState: null, detectedAt: new Date(), autoRepaired: true, repairedAt: new Date(), resolvedBy: null, resolvedAt: null, resolution: null, metadataJson: null },
        );

        const summary = await getIssueSummary();
        expect(summary.total).toBe(2);
        expect(summary.autoRepaired).toBe(1);
        expect(summary.open).toBe(2);
    });
});

// ============================================================
//  OFFLINE SYNC TESTS
// ============================================================

describe('Offline Action Sync', () => {
    beforeEach(() => {
        rideEvents.length = 0;
    });

    test('processes batch of offline actions', async () => {
        const actions = [
            { actionId: randomUUID(), eventType: 'LOCATION_UPDATE', rideId: RIDE_ID, clientTimestamp: new Date().toISOString() },
            { actionId: randomUUID(), eventType: 'DRIVER_ARRIVED', rideId: RIDE_ID, bookingId: BOOKING_ID, lat: 56.9, lng: 24.1, clientTimestamp: new Date().toISOString() },
        ];

        const result = await syncOfflineActions(DRIVER_ID, actions);
        expect(result.processed).toBe(2);
        expect(result.duplicates).toBe(0);
        expect(rideEvents.length).toBe(2);
    });

    test('detects duplicate actionIds', async () => {
        const actionId = randomUUID();
        const actions = [
            { actionId, eventType: 'LOCATION_UPDATE', rideId: RIDE_ID, clientTimestamp: new Date().toISOString() },
        ];

        // First call — processed
        await syncOfflineActions(DRIVER_ID, actions);
        expect(rideEvents.length).toBe(1);

        // Second call — duplicate
        const result = await syncOfflineActions(DRIVER_ID, actions);
        expect(result.duplicates).toBe(1);
        expect(result.processed).toBe(0);
        expect(rideEvents.length).toBe(1); // no new event created
    });

    test('handles mixed success and duplicates', async () => {
        const existingId = randomUUID();
        rideEvents.push({
            id: randomUUID(),
            rideId: RIDE_ID,
            bookingId: null,
            actionId: existingId,
            eventType: 'OLD_EVENT',
            actorType: 'DRIVER',
            actorId: DRIVER_ID,
            lat: null,
            lng: null,
            clientTimestamp: new Date(),
            serverTimestamp: new Date(),
            validationStatus: 'VALID',
            metadataJson: null,
        });

        const actions = [
            { actionId: existingId, eventType: 'DUPLICATE', rideId: RIDE_ID, clientTimestamp: new Date().toISOString() },
            { actionId: randomUUID(), eventType: 'NEW_EVENT', rideId: RIDE_ID, clientTimestamp: new Date().toISOString() },
        ];

        const result = await syncOfflineActions(DRIVER_ID, actions);
        expect(result.processed).toBe(1);
        expect(result.duplicates).toBe(1);
        expect(result.results.length).toBe(2);
    });
});
