-- This migration was a one-time fix to resolve a failed migration record in production.
-- The UPDATE statement has been removed because it references _prisma_migrations,
-- which does not exist in the shadow database used by `prisma migrate dev`.
-- The original fix was already applied to the production database.
SELECT 1;
