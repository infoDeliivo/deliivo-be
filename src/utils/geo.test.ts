const mockPrisma = {
  $queryRaw: jest.fn(),
};

jest.mock('../config/index.js', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

import { Prisma } from '@prisma/client';
import { findRideIdsNearby } from './geo';

describe('findRideIdsNearby', () => {
  const origin = { lat: 51.5074, lng: -0.1278 };
  const destination = { lat: 52.4862, lng: -1.8904 };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'ride-1' }, { id: 'ride-2' }]);
  });

  it('maps rows to a flat array of ride ids', async () => {
    const ids = await findRideIdsNearby({ origin, destination, radiusMeters: 10000 });
    expect(ids).toEqual(['ride-1', 'ride-2']);
  });

  it('returns an empty array when no rides match', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const ids = await findRideIdsNearby({ origin, destination, radiusMeters: 10000 });
    expect(ids).toEqual([]);
  });

  it('builds an origin-AND-destination query with the radius when includeWaypoints is false', async () => {
    await findRideIdsNearby({ origin, destination, radiusMeters: 8000 });

    const sql = mockPrisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('ST_DWithin(r."originGeog"');
    expect(sql.sql).toContain('ST_DWithin(r."destinationGeog"');
    // basic search requires both endpoints → AND, never the waypoint EXISTS branch
    expect(sql.sql).toContain('AND ST_DWithin');
    expect(sql.sql).not.toContain('RideWaypoint');
    // coordinates + radius are parameterised, never interpolated
    expect(sql.values).toEqual(
      expect.arrayContaining([origin.lng, origin.lat, destination.lng, destination.lat, 8000]),
    );
  });

  it('adds the waypoint OR branch when includeWaypoints is true', async () => {
    await findRideIdsNearby({ origin, destination, radiusMeters: 20000, includeWaypoints: true });

    const sql = mockPrisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('RideWaypoint');
    expect(sql.sql).toContain('ST_DWithin(w."geog"');
    expect(sql.sql).toContain('EXISTS');
  });
});
