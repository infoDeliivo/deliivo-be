CREATE TABLE IF NOT EXISTS "ContentPost" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "readTime" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentPost_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ContentPost" ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT;

CREATE INDEX IF NOT EXISTS "ContentPost_status_locale_publishedAt_idx" ON "ContentPost"("status", "locale", "publishedAt");
CREATE INDEX IF NOT EXISTS "ContentPost_updatedAt_idx" ON "ContentPost"("updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ContentPost_slug_locale_key" ON "ContentPost"("slug", "locale");

CREATE TABLE IF NOT EXISTS "ContentPostAudit" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentPostAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContentPostAudit_postId_createdAt_idx" ON "ContentPostAudit"("postId", "createdAt");
CREATE INDEX IF NOT EXISTS "ContentPostAudit_action_createdAt_idx" ON "ContentPostAudit"("action", "createdAt");
