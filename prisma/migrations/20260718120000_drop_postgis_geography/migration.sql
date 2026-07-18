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

-- Note: 20260717120000_postgis_geography is deliberately kept in the repository even though the
-- feature is gone. It is already applied to deployed databases, and Prisma's guidance is not to
-- edit or delete an applied migration — doing so produces the "applied to the database but not
-- found in prisma/migrations" history conflict. This migration reverses its effects instead.
