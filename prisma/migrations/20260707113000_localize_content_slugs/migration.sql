ALTER TABLE "ContentPost" DROP CONSTRAINT IF EXISTS "ContentPost_slug_key";
DROP INDEX IF EXISTS "ContentPost_slug_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ContentPost_slug_locale_key" ON "ContentPost"("slug", "locale");
