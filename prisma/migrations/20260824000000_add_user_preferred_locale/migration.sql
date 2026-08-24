-- Language the user is browsing the site in, captured at signup and kept in step on each
-- authenticated request. Nullable on purpose: NULL means "never learned", which is a different
-- fact from "chose English", and existing rows fill in on the user's next request.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preferredLocale" VARCHAR(10);
