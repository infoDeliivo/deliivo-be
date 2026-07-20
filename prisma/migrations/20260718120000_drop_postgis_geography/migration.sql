-- Reverse of 20260717120000_postgis_geography.
--
-- PR #5 (PostGIS ride search) was reverted and PostGIS is dropped permanently; ride search is
-- back on the application-side bounding-box pre-filter. The original migration was already
-- applied to deployed databases, so reverting the code alone leaves the geography columns,
-- sync triggers and GiST indexes physically in place. This migration removes them.
--
-- Every statement is idempotent, so this is a no-op on databases that never received the
-- original migration.

DROP TRIGGER IF EXISTS ride_sync_geog_trg ON "Ride";
DROP TRIGGER IF EXISTS ride_waypoint_sync_geog_trg ON "RideWaypoint";

DROP FUNCTION IF EXISTS ride_sync_geog();
DROP FUNCTION IF EXISTS ride_waypoint_sync_geog();

-- Dropping the columns below also drops their GiST indexes; these are listed explicitly so a
-- partially-applied state (index present, column already gone) still cleans up.
DROP INDEX IF EXISTS "Ride_originGeog_idx";
DROP INDEX IF EXISTS "Ride_destinationGeog_idx";
DROP INDEX IF EXISTS "RideWaypoint_geog_idx";

ALTER TABLE "Ride"
  DROP COLUMN IF EXISTS "originGeog",
  DROP COLUMN IF EXISTS "destinationGeog";
ALTER TABLE "RideWaypoint"
  DROP COLUMN IF EXISTS "geog";

-- The postgis extension is deliberately left installed. Dropping it is riskier than keeping it
-- (it requires elevated privileges to re-create and other objects may come to depend on it),
-- and it is inert once the columns above are gone.

-- The reverted migration's directory no longer exists in the repository, so its history row
-- would leave Prisma reporting an applied migration it cannot find. Clear it to keep
-- `prisma migrate deploy` / `prisma migrate status` consistent.
--
-- Guarded: databases managed with `prisma db push` (the dev workflow here) have no
-- _prisma_migrations table at all, and an unguarded DELETE would abort the migration there.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    DELETE FROM "_prisma_migrations" WHERE migration_name = '20260717120000_postgis_geography';
  END IF;
END $$;
