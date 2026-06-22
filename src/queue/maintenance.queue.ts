// @ts-ignore - bullmq types not resolved by moduleResolution:"Node"; runtime works fine
import { Queue, Worker } from 'bullmq';
import { BookingStatus, RideStatus } from '@prisma/client';
import { logInfo } from '../utils/logger.js';
import { bullRedis } from './redisConnection.js';
import { prisma } from '../config/index.js';
import { createNotification } from '../modules/notification/notification.service.js';
import { releaseSegmentSeats } from '../modules/ride-booking/segment-capacity.utils.js';

const QUEUE_NAME = 'maintenance';
const OVERDUE_CANCEL_AFTER_MINUTES = Number(process.env.RIDE_OVERDUE_CANCEL_AFTER_MINUTES || '120');
const OVERDUE_END_GRACE_MINUTES = Number(process.env.RIDE_OVERDUE_END_GRACE_MINUTES || '30');

const maintenanceQueue = new Queue(QUEUE_NAME, { connection: bullRedis });

// Schedule the nightly job once - BullMQ deduplicates by jobId
maintenanceQueue.add(
    'nightly-cleanup',
    {},
    {
        repeat: { pattern: '0 2 * * *' }, // 02:00 UTC daily
        jobId: 'nightly-cleanup',
        removeOnComplete: true,
        removeOnFail: 100,
    }
);

// Hourly reconciliation job
maintenanceQueue.add(
    'hourly-reconciliation',
    {},
    {
        repeat: { pattern: '15 * * * *' }, // :15 past every hour
        jobId: 'hourly-reconciliation',
        removeOnComplete: true,
        removeOnFail: 50,
    }
);

// Daily reconciliation job (stale escrow + ledger checks)
maintenanceQueue.add(
    'daily-reconciliation',
    {},
    {
        repeat: { pattern: '0 3 * * *' }, // 03:00 UTC daily
        jobId: 'daily-reconciliation',
        removeOnComplete: true,
        removeOnFail: 50,
    }
);

// Payout eligibility checker (48h dispute window, runs every 4 hours)
maintenanceQueue.add(
    'payout-eligibility',
    {},
    {
        repeat: { pattern: '0 */4 * * *' }, // every 4 hours
        jobId: 'payout-eligibility',
        removeOnComplete: true,
        removeOnFail: 50,
    }
);

// Ride-overdue checker: promotes overdue rides and cleans up rides that never started
maintenanceQueue.add(
    'ride-overdue-check',
    {},
    {
        repeat: { pattern: '*/5 * * * *' }, // every 5 minutes
        jobId: 'ride-overdue-check',
        removeOnComplete: true,
        removeOnFail: 100,
    }
);

maintenanceQueue.add(
    'payment-outbox',
    {},
    {
        repeat: { pattern: '* * * * *' },
        jobId: 'payment-outbox',
        removeOnComplete: true,
        removeOnFail: 100,
    }
);

const combineDepartureDateTimeUtc = (departureDate: Date, departureTime: string): Date => {
    const [hoursRaw, minutesRaw] = departureTime.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);

    if (
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
    ) {
        throw new Error('INVALID_RIDE_DEPARTURE_TIME');
    }

    return new Date(
        Date.UTC(
            departureDate.getUTCFullYear(),
            departureDate.getUTCMonth(),
            departureDate.getUTCDate(),
            hours,
            minutes,
            0,
            0
        )
    );
};

const getExpectedRideEnd = (departureAt: Date, routeDurationSeconds: number | null) => {
    if (!routeDurationSeconds || routeDurationSeconds <= 0) return null;
    return new Date(departureAt.getTime() + routeDurationSeconds * 1000);
};

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.DRIVER_PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.WAITING_FOR_PICKUP,
    BookingStatus.DRIVER_ARRIVED,
    BookingStatus.OTP_PENDING,
    BookingStatus.ONBOARD,
    BookingStatus.DROP_PENDING,
    BookingStatus.IN_PROGRESS,
];

const notifyRideStakeholders = async (params: {
    rideId: string;
    driverId: string;
    bookings: Array<{ id: string; passengerId: string }>;
    type: string;
    title: string;
    body: string;
    deepLink: string;
    extraData?: Record<string, string>;
}) => {
    const commonData = {
        rideId: params.rideId,
        deepLink: params.deepLink,
        ...(params.extraData ?? {}),
    };

    await createNotification({
        userId: params.driverId,
        type: params.type,
        title: params.title,
        body: params.body,
        data: commonData,
    });

    await Promise.all(
        params.bookings.map((booking) =>
            createNotification({
                userId: booking.passengerId,
                type: params.type,
                title: params.title,
                body: params.body,
                data: {
                    ...commonData,
                    bookingId: booking.id,
                },
            })
        )
    );
};

const hasOpenRideIssue = async (issueType: string, rideId: string) =>
    prisma.reconciliationIssue.findFirst({
        where: {
            issueType,
            resolvedAt: null,
            metadataJson: {
                path: ['rideId'],
                equals: rideId,
            } as any,
        },
    });

const autoCancelOverdueRide = async (
    ride: {
        id: string;
        driverId: string;
        departureDate: Date;
        departureTime: string;
        totalSeats: number;
        bookings: Array<{
            id: string;
            passengerId: string;
            status: BookingStatus;
            totalPrice: number;
            paymentAmount: number | null;
            paymentCapturedAt: Date | null;
            stripePaymentIntentId: string | null;
            pickupPosition: number | null;
            dropoffPosition: number | null;
            seatsBooked: number;
        }>;
    },
    departureAt: Date
) => {
    const activeBookings = ride.bookings.filter((booking) => ACTIVE_BOOKING_STATUSES.includes(booking.status));
    if (activeBookings.length === 0) return { cancelled: false, bookingsCancelled: 0 };

    const cancelledAt = new Date();
    let rideCancelled = false;

    await prisma.$transaction(async (tx) => {
        const rideUpdate = await tx.ride.updateMany({
            where: {
                id: ride.id,
                status: { in: [RideStatus.PUBLISHED, RideStatus.SCHEDULED, RideStatus.READY_TO_START] },
                actualStartTime: null,
            },
            data: { status: RideStatus.CANCELLED },
        });

        if (rideUpdate.count === 0) {
            return;
        }

        rideCancelled = true;

        await tx.rideBooking.updateMany({
            where: {
                id: { in: activeBookings.map((booking) => booking.id) },
            },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt,
                cancelledByRole: 'SYSTEM',
                cancellationReason: 'RIDE_NOT_STARTED_IN_TIME',
                refundPercent: 100,
            },
        });

        for (const booking of activeBookings) {
            await tx.rideBooking.update({
                where: { id: booking.id },
                data: {
                    refundAmount: booking.paymentAmount ?? booking.totalPrice,
                },
            });

            await releaseSegmentSeats(tx as any, {
                rideId: ride.id,
                seatsBooked: booking.seatsBooked,
                pickupPosition: booking.pickupPosition,
                dropoffPosition: booking.dropoffPosition,
                totalSeats: ride.totalSeats,
            });
        }
    });

    if (!rideCancelled) return { cancelled: false, bookingsCancelled: 0 };

    await notifyRideStakeholders({
        rideId: ride.id,
        driverId: ride.driverId,
        bookings: activeBookings,
        type: 'ride.overdue.auto_cancelled',
        title: 'Ride auto-cancelled',
        body: 'This ride did not start on time and was automatically cancelled. Any financial resolution must be handled through dispute or admin review.',
        deepLink: `app://rides/${ride.id}`,
        extraData: {
            departureAt: departureAt.toISOString(),
            cancellationReason: 'RIDE_NOT_STARTED_IN_TIME',
        },
    });

    await prisma.reconciliationIssue.create({
        data: {
            issueType: 'OVERDUE_RIDE_AUTO_CANCELLED',
            severity: 'HIGH',
            description: `Ride ${ride.id} never started by ${departureAt.toISOString()} and was automatically cancelled.`,
            internalState: 'RIDE_CANCELLED',
            metadataJson: {
                rideId: ride.id,
                departureAt: departureAt.toISOString(),
                activeBookings: activeBookings.length,
                refundsTriggered: 0,
            },
        },
    });

    return { cancelled: true, bookingsCancelled: activeBookings.length };
};

const runRideOverdueCheck = async () => {
    const now = new Date();
    const rides = await prisma.ride.findMany({
        where: {
            status: { in: [RideStatus.PUBLISHED, RideStatus.SCHEDULED, RideStatus.READY_TO_START, RideStatus.IN_PROGRESS] },
            departureDate: { lte: now },
        },
        select: {
            id: true,
            driverId: true,
            status: true,
            departureDate: true,
            departureTime: true,
            routeDurationSeconds: true,
            actualStartTime: true,
            actualEndTime: true,
            totalSeats: true,
            bookings: {
                select: {
                    id: true,
                    passengerId: true,
                    status: true,
                    totalPrice: true,
                    paymentAmount: true,
                    paymentCapturedAt: true,
                    stripePaymentIntentId: true,
                    pickupPosition: true,
                    dropoffPosition: true,
                    seatsBooked: true,
                },
            },
        },
    });

    let promoted = 0;
    let autoCancelled = 0;
    let completionAlerts = 0;

    for (const ride of rides) {
        let departureAt: Date;
        try {
            departureAt = combineDepartureDateTimeUtc(ride.departureDate, ride.departureTime);
        } catch {
            logInfo('Skipping overdue ride check for invalid departure time', {
                rideId: ride.id,
                departureTime: ride.departureTime,
            });
            continue;
        }

        const expectedEndAt = getExpectedRideEnd(departureAt, ride.routeDurationSeconds);
        const autoCancelAt = new Date(departureAt.getTime() + OVERDUE_CANCEL_AFTER_MINUTES * 60 * 1000);
        const overdueCompletionAt = expectedEndAt
            ? new Date(expectedEndAt.getTime() + OVERDUE_END_GRACE_MINUTES * 60 * 1000)
            : null;

        if (
            (ride.status === RideStatus.PUBLISHED || ride.status === RideStatus.SCHEDULED) &&
            now >= departureAt
        ) {
            await prisma.ride.updateMany({
                where: {
                    id: ride.id,
                    status: { in: [RideStatus.PUBLISHED, RideStatus.SCHEDULED] },
                    actualStartTime: null,
                },
                data: { status: RideStatus.READY_TO_START },
            });

            const activeBookings = ride.bookings.filter((booking) => ACTIVE_BOOKING_STATUSES.includes(booking.status));
            await notifyRideStakeholders({
                rideId: ride.id,
                driverId: ride.driverId,
                bookings: activeBookings,
                type: 'ride.overdue.ready_to_start',
                title: 'Ride is ready to start',
                body: 'Your scheduled departure time has passed. Start the ride when you are ready.',
                deepLink: `app://rides/${ride.id}`,
                extraData: {
                    departureAt: departureAt.toISOString(),
                    state: 'READY_TO_START',
                },
            });

            const existingIssue = await hasOpenRideIssue('OVERDUE_RIDE_START', ride.id);
            if (!existingIssue) {
                await prisma.reconciliationIssue.create({
                    data: {
                        issueType: 'OVERDUE_RIDE_START',
                        severity: 'MEDIUM',
                        description: `Ride ${ride.id} passed scheduled departure and is waiting for manual start.`,
                        internalState: ride.status,
                        metadataJson: {
                            rideId: ride.id,
                            departureAt: departureAt.toISOString(),
                            routeDurationSeconds: String(ride.routeDurationSeconds ?? ''),
                        },
                    },
                });
            }

            promoted++;
        }

        if (
            (ride.status === RideStatus.PUBLISHED ||
                ride.status === RideStatus.SCHEDULED ||
                ride.status === RideStatus.READY_TO_START) &&
            now >= autoCancelAt &&
            ride.actualStartTime == null
        ) {
            const result = await autoCancelOverdueRide(ride as any, departureAt);
            if (result.cancelled) {
                autoCancelled++;
            }
            continue;
        }

        if (
            ride.status === RideStatus.IN_PROGRESS &&
            expectedEndAt &&
            overdueCompletionAt &&
            now >= overdueCompletionAt &&
            ride.actualEndTime == null
        ) {
            const existingIssue = await hasOpenRideIssue('OVERDUE_RIDE_COMPLETION', ride.id);
            if (!existingIssue) {
                await prisma.reconciliationIssue.create({
                    data: {
                        issueType: 'OVERDUE_RIDE_COMPLETION',
                        severity: 'MEDIUM',
                        description: `Ride ${ride.id} is still IN_PROGRESS past the expected end time.`,
                        internalState: 'RIDE_IN_PROGRESS_OVERDUE',
                        metadataJson: {
                            rideId: ride.id,
                            departureAt: departureAt.toISOString(),
                            expectedEndAt: expectedEndAt.toISOString(),
                            routeDurationSeconds: String(ride.routeDurationSeconds ?? ''),
                        },
                    },
                });

                const activeBookings = ride.bookings.filter((booking) => ACTIVE_BOOKING_STATUSES.includes(booking.status));
                await notifyRideStakeholders({
                    rideId: ride.id,
                    driverId: ride.driverId,
                    bookings: activeBookings,
                    type: 'ride.overdue.in_progress',
                    title: 'Ride is taking longer than expected',
                    body: 'The ride has passed its expected end time. Please review the ride status and complete it when appropriate.',
                    deepLink: `app://rides/${ride.id}`,
                    extraData: {
                        departureAt: departureAt.toISOString(),
                        expectedEndAt: expectedEndAt.toISOString(),
                    },
                });
                completionAlerts++;
            }
        }
    }

    logInfo('Ride overdue check complete', {
        scanned: rides.length,
        promoted,
        autoCancelled,
        completionAlerts,
    });
};

export const maintenanceWorker = new Worker(
    QUEUE_NAME,
    async (job: any) => {
        if (job.name === 'ride-overdue-check') {
            await runRideOverdueCheck();
            return;
        }

        if (job.name === 'hourly-reconciliation') {
            const { runHourlyReconciliation } = await import('../modules/reconciliation/reconciliation.service.js');
            await runHourlyReconciliation();
            return;
        }

        if (job.name === 'daily-reconciliation') {
            const { runDailyReconciliation } = await import('../modules/reconciliation/reconciliation.service.js');
            await runDailyReconciliation();
            return;
        }

        if (job.name === 'payout-eligibility') {
            const { checkAndMarkEligible } = await import('../modules/payout/payout.service.js');
            await checkAndMarkEligible();
            return;
        }

        if (job.name === 'payment-outbox') {
            const { processOutboxEvents } = await import('../modules/payments/payment-outbox.worker.js');
            await processOutboxEvents(25);
            return;
        }

        // nightly-cleanup (original job)
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        // D3: Delete read notifications older than 30 days
        const deletedRead = await prisma.notification.deleteMany({
            where: {
                isRead: true,
                createdAt: { lt: thirtyDaysAgo },
            },
        });

        // D3: Delete all notifications older than 90 days
        const deletedOld = await prisma.notification.deleteMany({
            where: {
                createdAt: { lt: ninetyDaysAgo },
            },
        });

        // D5: Nullify StripeWebhookEvent payload after 30 days (keep id + eventType for idempotency)
        const nullifiedWebhooks = await prisma.stripeWebhookEvent.updateMany({
            where: {
                processedAt: { lt: thirtyDaysAgo },
                payload: { not: null as any },
            },
            data: { payload: null as any },
        });

        logInfo('Maintenance nightly cleanup complete', {
            notificationsDeletedRead30d: deletedRead.count,
            notificationsDeletedAll90d: deletedOld.count,
            webhookPayloadsNullified: nullifiedWebhooks.count,
        });
    },
    { connection: bullRedis, concurrency: 1 }
);
