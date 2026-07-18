import { Prisma } from '@prisma/client';
import { prisma } from '../config/index.js';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface FindRideIdsNearbyParams {
  origin: GeoPoint;
  destination: GeoPoint;
  /** Search radius in metres. */
  radiusMeters: number;
  /**
   * When true, a ride also matches if any of its waypoints falls within the radius of either
   * the rider's origin or destination, and origin/destination are matched independently (OR).
   * Used by the advanced search pre-filter. When false, a ride matches only when its origin AND
   * destination both fall within the radius (basic search).
   */
  includeWaypoints?: boolean;
}

const geogPoint = (point: GeoPoint): Prisma.Sql =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;

/**
 * Spatial pre-filter for ride search, backed by the PostGIS GiST indexes on the geography
 * columns. Returns the ids of rides whose stored points fall within `radiusMeters` of the
 * rider's origin/destination. `use_spheroid => false` keeps ST_DWithin on a sphere, matching
 * the legacy Haversine (R=6371km) behaviour the application-side refinement still relies on.
 */
export const findRideIdsNearby = async ({
  origin,
  destination,
  radiusMeters,
  includeWaypoints = false,
}: FindRideIdsNearbyParams): Promise<string[]> => {
  const originGeog = geogPoint(origin);
  const destGeog = geogPoint(destination);

  const query = includeWaypoints
    ? Prisma.sql`
        SELECT r.id FROM "Ride" r
        WHERE ST_DWithin(r."originGeog", ${originGeog}, ${radiusMeters}, false)
           OR ST_DWithin(r."destinationGeog", ${destGeog}, ${radiusMeters}, false)
           OR EXISTS (
             SELECT 1 FROM "RideWaypoint" w
             WHERE w."rideId" = r.id
               AND (
                 ST_DWithin(w."geog", ${originGeog}, ${radiusMeters}, false)
                 OR ST_DWithin(w."geog", ${destGeog}, ${radiusMeters}, false)
               )
           )`
    : Prisma.sql`
        SELECT r.id FROM "Ride" r
        WHERE ST_DWithin(r."originGeog", ${originGeog}, ${radiusMeters}, false)
          AND ST_DWithin(r."destinationGeog", ${destGeog}, ${radiusMeters}, false)`;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(query);
  return rows.map((row) => row.id);
};
