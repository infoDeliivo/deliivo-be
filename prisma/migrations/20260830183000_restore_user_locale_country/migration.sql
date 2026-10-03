-- Restore locale and country columns expected by the auth, admin, and profile services.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "preferredLocale" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "detectedCountry" VARCHAR(2);
