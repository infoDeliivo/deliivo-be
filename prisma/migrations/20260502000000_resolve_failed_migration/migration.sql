-- This migration resolves the failed migration record `20260429185653_init`
-- that was left in the _prisma_migrations table with a failed_at timestamp,
-- blocking all subsequent Prisma migrations with error P3009.
--
-- Prisma's P3009 error occurs when a migration row exists in _prisma_migrations
-- with a non-null `rolled_back_at` or `finished_at = NULL` and `logs` set,
-- indicating a failed apply. The standard fix is to mark it as rolled back
-- so Prisma no longer considers it a blocking failed migration.
--
-- See: https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing

UPDATE "_prisma_migrations"
SET
  "rolled_back_at" = NOW()
WHERE
  "migration_name" = '20260429185653_init'
  AND "finished_at" IS NULL
  AND "rolled_back_at" IS NULL;
