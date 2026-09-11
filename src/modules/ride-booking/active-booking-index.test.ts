import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACTIVE_BOOKING_STATUSES } from './ride-booking.service.js';

/**
 * The partial unique index is hand-written SQL — Prisma cannot express it — so nothing but this
 * test stops the two lists from drifting. If they drift, either concurrent requests create two
 * active bookings for one rider (status missing from the index) or a legitimate re-book fails with
 * an unexplained P2002 (status present in the index but not treated as active).
 */
describe('RideBooking_active_rider_ride_key', () => {
    const migrationSql = readFileSync(
        join(
            process.cwd(),
            'prisma/migrations/20260910120000_ride_booking_active_unique/migration.sql'
        ),
        'utf8'
    );

    it('indexes exactly the statuses the service treats as active', () => {
        const clause = migrationSql
            .split('\n')
            .filter(line => !line.trim().startsWith('--'))
            .join('\n')
            .match(/WHERE\s+"status"\s+IN\s*\(([^)]*)\)/i);

        expect(clause).not.toBeNull();

        const indexed = Array.from(clause![1].matchAll(/'([A-Z_]+)'/g)).map(match => match[1]);

        expect(indexed.sort()).toEqual([...ACTIVE_BOOKING_STATUSES].sort());
    });
});
