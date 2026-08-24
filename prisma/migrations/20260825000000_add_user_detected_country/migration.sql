-- Country the user appears to connect from, ISO-3166 alpha-2, derived from the request IP on
-- authenticated calls. Nullable on purpose: NULL means "never learned", which is a different fact
-- from any particular country, and existing rows fill in on the user's next request.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "detectedCountry" VARCHAR(2);
