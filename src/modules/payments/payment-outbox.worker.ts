import { prisma } from '../../config/index.js';
import { markHeldInEscrow, markPayoutEligible } from './payment.service.js';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 60_000; // 1 minute base, exponential backoff

// ============================================================
//  OUTBOX EVENT HANDLERS
// ============================================================

type EventHandler = (payload: any) => Promise<void>;

const handlers: Record<string, EventHandler> = {
    'payment.paid': async (payload) => {
        // After payment is confirmed, move to escrow
        await markHeldInEscrow(payload.paymentId);
    },
    'booking.completed': async (payload) => {
        // After booking completed and dispute window passes, mark eligible
        // This is triggered by the eligibility checker, not directly
        if (payload.paymentId) {
            await markPayoutEligible(payload.paymentId);
        }
    },
};

// ============================================================
//  PROCESS PENDING EVENTS
// ============================================================

export const processOutboxEvents = async (batchSize = 10) => {
    const events = await prisma.paymentEventOutbox.findMany({
        where: {
            status: 'PENDING',
            OR: [
                { nextRetryAt: null },
                { nextRetryAt: { lte: new Date() } },
            ],
        },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
    });

    let processed = 0;
    let failed = 0;

    for (const event of events) {
        // Mark as processing
        await prisma.paymentEventOutbox.update({
            where: { id: event.id },
            data: { status: 'PROCESSING' },
        });

        const handler = handlers[event.eventType];
        if (!handler) {
            await prisma.paymentEventOutbox.update({
                where: { id: event.id },
                data: { status: 'FAILED', processedAt: new Date() },
            });
            failed++;
            continue;
        }

        try {
            await handler(event.payloadJson);
            await prisma.paymentEventOutbox.update({
                where: { id: event.id },
                data: { status: 'PROCESSED', processedAt: new Date() },
            });
            processed++;
        } catch (err: any) {
            const newRetryCount = event.retryCount + 1;
            if (newRetryCount >= MAX_RETRIES) {
                await prisma.paymentEventOutbox.update({
                    where: { id: event.id },
                    data: { status: 'FAILED', retryCount: newRetryCount, processedAt: new Date() },
                });
                failed++;
            } else {
                const nextRetry = new Date(Date.now() + RETRY_DELAY_MS * Math.pow(2, newRetryCount));
                await prisma.paymentEventOutbox.update({
                    where: { id: event.id },
                    data: { status: 'PENDING', retryCount: newRetryCount, nextRetryAt: nextRetry },
                });
            }
        }
    }

    return { processed, failed, total: events.length };
};

// ============================================================
//  WRITE OUTBOX EVENT (used in transactions)
// ============================================================

export const writeOutboxEvent = async (params: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, any>;
}) => {
    return prisma.paymentEventOutbox.create({
        data: {
            eventType: params.eventType,
            aggregateType: params.aggregateType,
            aggregateId: params.aggregateId,
            payloadJson: params.payload,
        },
    });
};
