-- `name` held the full name before the surname was split out into `lastName`;
-- it now holds only the given name, so the column is renamed to match.
ALTER TABLE "User" RENAME COLUMN "name" TO "firstName";
