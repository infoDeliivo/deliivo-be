-- Enable PostGIS and add indexed geography columns for ride proximity search.
-- Replaces the application-side bounding-box pre-filter with GiST-indexed ST_DWithin queries.
--
-- The geography columns are plain (not GENERATED) because Prisma cannot represent generated
-- columns and `prisma db push` (this repo's dev workflow) chokes on them. Instead a BEFORE
-- INSERT/UPDATE trigger keeps them in sync from lat/lng. This file is idempotent so it can be
-- applied via `migrate deploy` (prod) OR re-run with psql after `prisma db push` (dev), where
-- db push already created the columns + GiST indexes from the schema.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Columns (plain geography; kept in sync by triggers below). IF NOT EXISTS so this is a no-op
-- when `prisma db push` already created them from the Unsupported() schema mapping.
ALTER TABLE "Ride"
  ADD COLUMN IF NOT EXISTS "originGeog" geography(Point, 4326),
  ADD COLUMN IF NOT EXISTS "destinationGeog" geography(Point, 4326);
ALTER TABLE "RideWaypoint"
  ADD COLUMN IF NOT EXISTS "geog" geography(Point, 4326);

-- Sync functions.
CREATE OR REPLACE FUNCTION ride_sync_geog() RETURNS trigger AS $$
BEGIN
  NEW."originGeog" := ST_SetSRID(ST_MakePoint(NEW."originLng", NEW."originLat"), 4326)::geography;
  NEW."destinationGeog" := ST_SetSRID(ST_MakePoint(NEW."destinationLng", NEW."destinationLat"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ride_waypoint_sync_geog() RETURNS trigger AS $$
BEGIN
  NEW."geog" := ST_SetSRID(ST_MakePoint(NEW."lng", NEW."lat"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers (drop-then-create for idempotency).
DROP TRIGGER IF EXISTS ride_sync_geog_trg ON "Ride";
CREATE TRIGGER ride_sync_geog_trg
  BEFORE INSERT OR UPDATE ON "Ride"
  FOR EACH ROW EXECUTE FUNCTION ride_sync_geog();

DROP TRIGGER IF EXISTS ride_waypoint_sync_geog_trg ON "RideWaypoint";
CREATE TRIGGER ride_waypoint_sync_geog_trg
  BEFORE INSERT OR UPDATE ON "RideWaypoint"
  FOR EACH ROW EXECUTE FUNCTION ride_waypoint_sync_geog();

-- Backfill existing rows.
UPDATE "Ride" SET
  "originGeog" = ST_SetSRID(ST_MakePoint("originLng", "originLat"), 4326)::geography,
  "destinationGeog" = ST_SetSRID(ST_MakePoint("destinationLng", "destinationLat"), 4326)::geography;
UPDATE "RideWaypoint" SET
  "geog" = ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography;

-- GiST spatial indexes powering ST_DWithin (names match Prisma's @@index convention;
-- IF NOT EXISTS so this is a no-op when db push already created them).
CREATE INDEX IF NOT EXISTS "Ride_originGeog_idx" ON "Ride" USING GIST ("originGeog");
CREATE INDEX IF NOT EXISTS "Ride_destinationGeog_idx" ON "Ride" USING GIST ("destinationGeog");
CREATE INDEX IF NOT EXISTS "RideWaypoint_geog_idx" ON "RideWaypoint" USING GIST ("geog");
