-- Replace the free-form `nickName` handle with a real `lastName`.
-- Licence verification (Veriff) requires the given and family name as separate
-- values, so the surname gets its own column instead of being parsed out of `name`.
ALTER TABLE "User" ADD COLUMN "lastName" VARCHAR(255);

-- `name` used to hold the full name. Move everything after the first space into
-- `lastName` and keep the first token in `name`. Single-token names keep a NULL
-- `lastName` — those users are prompted for it before licence verification.
UPDATE "User"
SET
  "lastName" = NULLIF(TRIM(SUBSTRING(TRIM("name") FROM POSITION(' ' IN TRIM("name")) + 1)), ''),
  "name" = SUBSTRING(TRIM("name") FROM 1 FOR POSITION(' ' IN TRIM("name")) - 1)
WHERE "name" IS NOT NULL
  AND POSITION(' ' IN TRIM("name")) > 0;

-- DESTRUCTIVE: drops every stored nickname. The handle feature is being removed.
ALTER TABLE "User" DROP COLUMN "nickName";
