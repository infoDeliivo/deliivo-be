import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import pg from 'pg';

type CountRow = {
  label: string;
  count: number;
};

const usage = `
Usage:
  npm run db:purge-before-date -- --before=YYYY-MM-DD [--execute] [--include-admins] [--delete-old-users]

Examples:
  npm run db:purge-before-date -- --before=2026-08-04
  npm run db:purge-before-date -- --before=2026-08-04 --delete-old-users
  $env:CONFIRM_PURGE_BEFORE_DATE='2026-08-04'; npm run db:purge-before-date -- --before=2026-08-04 --execute
`;

const args = process.argv.slice(2);
const beforeArg =
  args.find((arg) => arg.startsWith('--before='))?.replace('--before=', '') ??
  args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
const execute = args.includes('--execute');
const includeAdmins = args.includes('--include-admins');
const deleteOldUsers = args.includes('--delete-old-users');

if (!beforeArg || !/^\d{4}-\d{2}-\d{2}$/.test(beforeArg)) {
  console.error(usage.trim());
  process.exit(1);
}

if (execute && process.env.CONFIRM_PURGE_BEFORE_DATE !== beforeArg) {
  console.error(
    `Refusing to delete. Set CONFIRM_PURGE_BEFORE_DATE=${beforeArg} to confirm this purge.`,
  );
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error('DATABASE_URL is missing.');
  process.exit(1);
}

const cutoffDate = beforeArg;
const cutoffTs = `${beforeArg}T00:00:00.000Z`;

const formatDbTarget = (connectionString: string): string => {
  try {
    const parsed = new URL(connectionString);
    const db = parsed.pathname.replace(/^\//, '') || 'unknown';
    const user = parsed.username || 'unknown';
    return `${parsed.hostname}:${parsed.port || '5432'}/${db} as ${user}`;
  } catch {
    return 'unparseable DATABASE_URL';
  }
};

const pool = new pg.Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5000,
});

const createCleanupSets = async (client: pg.PoolClient): Promise<void> => {
  if (deleteOldUsers) {
    await client.query(
      `
      CREATE TEMP TABLE cleanup_users ON COMMIT DROP AS
      SELECT u.id
      FROM "User" u
      WHERE u."createdAt" < $1::timestamptz
        AND ($2::boolean OR u.role <> 'ADMIN')
    `,
      [cutoffTs, includeAdmins],
    );
  }

  await client.query(
    deleteOldUsers
      ? `
    CREATE TEMP TABLE cleanup_rides ON COMMIT DROP AS
    SELECT ride.id
    FROM "Ride" ride
    WHERE ride."createdAt" < $1::timestamptz
       OR ride."departureDate" < $2::date
       OR ride."driverId" IN (SELECT id FROM cleanup_users)
       OR ride."vehicleId" IN (
         SELECT vehicle.id
         FROM "Vehicle" vehicle
         WHERE vehicle."userId" IN (SELECT id FROM cleanup_users)
       )
  `
      : `
    CREATE TEMP TABLE cleanup_rides ON COMMIT DROP AS
    SELECT id
    FROM "Ride"
    WHERE "createdAt" < $1::timestamptz
       OR "departureDate" < $2::date
  `,
    [cutoffTs, cutoffDate],
  );

  await client.query(
    deleteOldUsers
      ? `
    CREATE TEMP TABLE cleanup_bookings ON COMMIT DROP AS
    SELECT booking.id
    FROM "RideBooking" booking
    WHERE booking."createdAt" < $1::timestamptz
       OR booking."rideId" IN (SELECT id FROM cleanup_rides)
       OR booking."passengerId" IN (SELECT id FROM cleanup_users)
  `
      : `
    CREATE TEMP TABLE cleanup_bookings ON COMMIT DROP AS
    SELECT id
    FROM "RideBooking"
    WHERE "createdAt" < $1::timestamptz
       OR "rideId" IN (SELECT id FROM cleanup_rides)
  `,
    [cutoffTs],
  );

  await client.query(
    deleteOldUsers
      ? `
    CREATE TEMP TABLE cleanup_payments ON COMMIT DROP AS
    SELECT payment.id
    FROM "Payment" payment
    WHERE payment."createdAt" < $1::timestamptz
       OR payment."bookingId" IN (SELECT id FROM cleanup_bookings)
       OR payment."rideId" IN (SELECT id FROM cleanup_rides)
       OR payment."riderId" IN (SELECT id FROM cleanup_users)
  `
      : `
    CREATE TEMP TABLE cleanup_payments ON COMMIT DROP AS
    SELECT id
    FROM "Payment"
    WHERE "createdAt" < $1::timestamptz
       OR "bookingId" IN (SELECT id FROM cleanup_bookings)
       OR "rideId" IN (SELECT id FROM cleanup_rides)
  `,
    [cutoffTs],
  );

  await client.query(
    `
    CREATE TEMP TABLE cleanup_payout_items ON COMMIT DROP AS
    SELECT id, "payoutBatchId"
    FROM "PayoutItem"
    WHERE "createdAt" < $1::timestamptz
       OR "bookingId" IN (SELECT id FROM cleanup_bookings)
       OR "paymentId" IN (SELECT id FROM cleanup_payments)
  `,
    [cutoffTs],
  );

  await client.query(
    `
    CREATE TEMP TABLE cleanup_payout_batches ON COMMIT DROP AS
    SELECT batch.id
    FROM "PayoutBatch" batch
    WHERE batch."createdAt" < $1::timestamptz
       OR (
         EXISTS (
           SELECT 1
           FROM cleanup_payout_items item
           WHERE item."payoutBatchId" = batch.id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM "PayoutItem" item
           WHERE item."payoutBatchId" = batch.id
             AND item.id NOT IN (SELECT id FROM cleanup_payout_items)
         )
       )
  `,
    [cutoffTs],
  );

  if (!deleteOldUsers) {
    await client.query(
      `
    CREATE TEMP TABLE cleanup_users ON COMMIT DROP AS
    SELECT u.id
    FROM "User" u
    WHERE u."createdAt" < $1::timestamptz
      AND u."updatedAt" < $1::timestamptz
      AND ($2::boolean OR u.role <> 'ADMIN')
      AND NOT EXISTS (
        SELECT 1 FROM "Ride" ride
        WHERE ride."driverId" = u.id
          AND ride.id NOT IN (SELECT id FROM cleanup_rides)
      )
      AND NOT EXISTS (
        SELECT 1 FROM "RideBooking" booking
        WHERE booking."passengerId" = u.id
          AND booking.id NOT IN (SELECT id FROM cleanup_bookings)
      )
      AND NOT EXISTS (
        SELECT 1 FROM "PaymentMethod" method
        WHERE method."userId" = u.id
          AND method."createdAt" >= $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Vehicle" vehicle
        WHERE vehicle."userId" = u.id
          AND (
            vehicle."createdAt" >= $1::timestamptz
            OR EXISTS (
              SELECT 1 FROM "Ride" retained_ride
              WHERE retained_ride."vehicleId" = vehicle.id
                AND retained_ride.id NOT IN (SELECT id FROM cleanup_rides)
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Conversation" conversation
        WHERE (conversation."userAId" = u.id OR conversation."userBId" = u.id)
          AND (
            conversation."createdAt" >= $1::timestamptz
            OR conversation."updatedAt" >= $1::timestamptz
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Message" message
        WHERE (message."senderId" = u.id OR message."receiverId" = u.id)
          AND message."createdAt" >= $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1 FROM "DeviceToken" token
        WHERE token."userId" = u.id
          AND (
            token."createdAt" >= $1::timestamptz
            OR token."lastSeenAt" >= $1::timestamptz
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Notification" notification
        WHERE notification."userId" = u.id
          AND notification."createdAt" >= $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1 FROM "EmergencyAlert" alert
        WHERE alert."userId" = u.id
          AND alert."createdAt" >= $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1 FROM "UserReport" report
        WHERE (report."reporterId" = u.id OR report."reportedId" = u.id)
          AND report."createdAt" >= $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1 FROM "UserBlock" block
        WHERE (block."blockerId" = u.id OR block."blockedId" = u.id)
          AND block."createdAt" >= $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1 FROM "DlVerification" dl
        WHERE dl."userId" = u.id
          AND (
            dl."createdAt" >= $1::timestamptz
            OR dl."updatedAt" >= $1::timestamptz
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "TravelPreference" preference
        WHERE preference."userId" = u.id
          AND preference."updatedAt" >= $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1 FROM "RefreshToken" token
        WHERE token."userId" = u.id
          AND token."updatedAt" >= $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1 FROM "UserRatingStats" stats
        WHERE stats."userId" = u.id
          AND stats."updatedAt" >= $1::timestamptz
      )
  `,
      [cutoffTs, includeAdmins],
    );
  }
};

const collectCounts = async (client: pg.PoolClient): Promise<CountRow[]> => {
  const { rows } = await client.query<CountRow>(
    `
    SELECT 'rides' AS label, count(*)::int AS count FROM cleanup_rides
    UNION ALL SELECT 'bookings', count(*)::int FROM cleanup_bookings
    UNION ALL SELECT 'payments', count(*)::int FROM cleanup_payments
    UNION ALL SELECT 'payout_items', count(*)::int FROM cleanup_payout_items
    UNION ALL SELECT 'payout_batches', count(*)::int FROM cleanup_payout_batches
    UNION ALL SELECT 'users_to_delete', count(*)::int FROM cleanup_users
    UNION ALL SELECT 'stripe_webhook_events', count(*)::int FROM "StripeWebhookEvent" WHERE "processedAt" < $1::timestamptz
    UNION ALL SELECT 'ledger_entries', count(*)::int FROM "LedgerEntry" WHERE "createdAt" < $1::timestamptz OR "bookingId" IN (SELECT id FROM cleanup_bookings) OR "paymentId" IN (SELECT id FROM cleanup_payments) OR "userId" IN (SELECT id FROM cleanup_users)
    UNION ALL SELECT 'payment_event_outbox', count(*)::int FROM "PaymentEventOutbox" WHERE "createdAt" < $1::timestamptz OR "aggregateId" IN (SELECT id FROM cleanup_payments) OR "aggregateId" IN (SELECT id FROM cleanup_bookings) OR "aggregateId" IN (SELECT id FROM cleanup_payout_batches)
    UNION ALL SELECT 'reconciliation_issues', count(*)::int FROM "ReconciliationIssue" WHERE "detectedAt" < $1::timestamptz OR "bookingId" IN (SELECT id FROM cleanup_bookings) OR "paymentId" IN (SELECT id FROM cleanup_payments)
  `,
    [cutoffTs],
  );

  return rows;
};

const deleteRows = async (
  client: pg.PoolClient,
): Promise<Array<{ tableName: string; count: number }>> => {
  const deletes: Array<[string, string]> = [
    [
      'StripeWebhookEvent',
      `DELETE FROM "StripeWebhookEvent" WHERE "processedAt" < $1::timestamptz`,
    ],
    [
      'PaymentEventOutbox',
      `DELETE FROM "PaymentEventOutbox"
       WHERE "createdAt" < $1::timestamptz
          OR "aggregateId" IN (SELECT id FROM cleanup_payments)
          OR "aggregateId" IN (SELECT id FROM cleanup_bookings)
          OR "aggregateId" IN (SELECT id FROM cleanup_payout_batches)`,
    ],
    [
      'ReconciliationIssue',
      `DELETE FROM "ReconciliationIssue"
       WHERE "detectedAt" < $1::timestamptz
          OR "bookingId" IN (SELECT id FROM cleanup_bookings)
          OR "paymentId" IN (SELECT id FROM cleanup_payments)`,
    ],
    [
      'LedgerEntry',
      `DELETE FROM "LedgerEntry"
       WHERE "createdAt" < $1::timestamptz
          OR "bookingId" IN (SELECT id FROM cleanup_bookings)
          OR "paymentId" IN (SELECT id FROM cleanup_payments)
          OR "userId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'DriverPenaltyEvent',
      `DELETE FROM "DriverPenaltyEvent"
       WHERE "createdAt" < $1::timestamptz
          OR "bookingId" IN (SELECT id FROM cleanup_bookings)
          OR "driverId" IN (SELECT id FROM cleanup_users)`,
    ],
    ['PayoutItem', `DELETE FROM "PayoutItem" WHERE id IN (SELECT id FROM cleanup_payout_items)`],
    ['PayoutBatch', `DELETE FROM "PayoutBatch" WHERE id IN (SELECT id FROM cleanup_payout_batches)`],
    [
      'TrackingLink',
      `DELETE FROM "TrackingLink"
       WHERE "createdAt" < $1::timestamptz
          OR "bookingId" IN (SELECT id FROM cleanup_bookings)`,
    ],
    [
      'Dispute',
      `DELETE FROM "Dispute"
       WHERE "createdAt" < $1::timestamptz
          OR "bookingId" IN (SELECT id FROM cleanup_bookings)
          OR "rideId" IN (SELECT id FROM cleanup_rides)`,
    ],
    [
      'EmergencyAlert',
      `DELETE FROM "EmergencyAlert"
       WHERE "createdAt" < $1::timestamptz
          OR "userId" IN (SELECT id FROM cleanup_users)
          OR "bookingId" IN (SELECT id FROM cleanup_bookings)
          OR "rideId" IN (SELECT id FROM cleanup_rides)`,
    ],
    [
      'Notification',
      `DELETE FROM "Notification"
       WHERE "createdAt" < $1::timestamptz
          OR "userId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'Message',
      `DELETE FROM "Message"
       WHERE "createdAt" < $1::timestamptz
          OR "senderId" IN (SELECT id FROM cleanup_users)
          OR "receiverId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'Conversation',
      `DELETE FROM "Conversation" conversation
       WHERE (
           conversation."createdAt" < $1::timestamptz
           OR conversation."userAId" IN (SELECT id FROM cleanup_users)
           OR conversation."userBId" IN (SELECT id FROM cleanup_users)
         )
         AND NOT EXISTS (
           SELECT 1 FROM "Message" message
           WHERE message."conversationId" = conversation.id
         )`,
    ],
    [
      'RideRating',
      `DELETE FROM "RideRating"
       WHERE "createdAt" < $1::timestamptz
          OR "bookingId" IN (SELECT id FROM cleanup_bookings)
          OR "rideId" IN (SELECT id FROM cleanup_rides)
          OR "raterId" IN (SELECT id FROM cleanup_users)
          OR "rateeId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'RidePricingSnapshot',
      `DELETE FROM "RidePricingSnapshot"
       WHERE "createdAt" < $1::timestamptz
          OR "rideId" IN (SELECT id FROM cleanup_rides)`,
    ],
    [
      'LocationUpdate',
      `DELETE FROM "LocationUpdate"
       WHERE "createdAt" < $1::timestamptz
          OR "rideId" IN (SELECT id FROM cleanup_rides)
          OR "driverId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'RideEvent',
      `DELETE FROM "RideEvent"
       WHERE "serverTimestamp" < $1::timestamptz
          OR "clientTimestamp" < $1::timestamptz
          OR "rideId" IN (SELECT id FROM cleanup_rides)
          OR "bookingId" IN (SELECT id FROM cleanup_bookings)
          OR "actorId" IN (SELECT id FROM cleanup_users)`,
    ],
    ['Payment', `DELETE FROM "Payment" WHERE id IN (SELECT id FROM cleanup_payments)`],
    ['RideBooking', `DELETE FROM "RideBooking" WHERE id IN (SELECT id FROM cleanup_bookings)`],
    ['RideSegmentCapacity', `DELETE FROM "RideSegmentCapacity" WHERE "rideId" IN (SELECT id FROM cleanup_rides)`],
    ['RideWaypoint', `DELETE FROM "RideWaypoint" WHERE "rideId" IN (SELECT id FROM cleanup_rides)`],
    ['Ride', `DELETE FROM "Ride" WHERE id IN (SELECT id FROM cleanup_rides)`],
    [
      'PaymentMethod',
      `DELETE FROM "PaymentMethod"
       WHERE "userId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'DlVerification',
      `DELETE FROM "DlVerification"
       WHERE "userId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'RefreshToken',
      `DELETE FROM "RefreshToken"
       WHERE "userId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'TravelPreference',
      `DELETE FROM "TravelPreference"
       WHERE "userId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'UserRatingStats',
      `DELETE FROM "UserRatingStats"
       WHERE "userId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'UserReport',
      `DELETE FROM "UserReport"
       WHERE "reporterId" IN (SELECT id FROM cleanup_users)
          OR "reportedId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'UserBlock',
      `DELETE FROM "UserBlock"
       WHERE "blockerId" IN (SELECT id FROM cleanup_users)
          OR "blockedId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'DeviceToken',
      `DELETE FROM "DeviceToken"
       WHERE "userId" IN (SELECT id FROM cleanup_users)`,
    ],
    [
      'VehicleDocument',
      `DELETE FROM "VehicleDocument"
       WHERE "vehicleId" IN (
         SELECT id FROM "Vehicle"
         WHERE "userId" IN (SELECT id FROM cleanup_users)
       )`,
    ],
    [
      'Vehicle',
      `DELETE FROM "Vehicle"
       WHERE "userId" IN (SELECT id FROM cleanup_users)`,
    ],
    ['User', `DELETE FROM "User" WHERE id IN (SELECT id FROM cleanup_users)`],
  ];

  const results: Array<{ tableName: string; count: number }> = [];

  for (const [tableName, sql] of deletes) {
    const result = sql.includes('$1')
      ? await client.query(sql, [cutoffTs])
      : await client.query(sql);
    results.push({ tableName, count: result.rowCount ?? 0 });
  }

  return results;
};

const client = await pool.connect();

try {
  console.log(`Database: ${formatDbTarget(databaseUrl)}`);
  console.log(`Cutoff: deleting data before ${cutoffDate} (UTC midnight), keeping ${cutoffDate} and newer.`);
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Admins: ${includeAdmins ? 'included' : 'preserved'}`);

  await client.query('BEGIN');
  await createCleanupSets(client);

  const counts = await collectCounts(client);
  console.table(counts);

  if (execute) {
    const results = await deleteRows(client);
    console.table(results.filter((row) => row.count > 0));
    await client.query('COMMIT');
    console.log('Purge committed.');
  } else {
    await client.query('ROLLBACK');
    console.log('Dry run only. No rows were deleted.');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
