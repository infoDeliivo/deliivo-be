-- Phase C: Stripe Connect, Admin role, User reporting/blocking

-- UserRole enum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- User: role, isBanned, Stripe Connect fields
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "role"                    "UserRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "isBanned"                BOOLEAN    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "stripeAccountId"         TEXT,
  ADD COLUMN IF NOT EXISTS "stripeOnboardingComplete" BOOLEAN   NOT NULL DEFAULT false;

-- UserReport model
CREATE TABLE IF NOT EXISTS "UserReport" (
  "id"         TEXT         NOT NULL,
  "reporterId" TEXT         NOT NULL,
  "reportedId" TEXT         NOT NULL,
  "reason"     TEXT         NOT NULL,
  "details"    TEXT,
  "resolved"   BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserReport_reporterId_reportedId_key" UNIQUE ("reporterId", "reportedId"),
  CONSTRAINT "UserReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserReport_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "UserReport_reportedId_idx"       ON "UserReport"("reportedId");
CREATE INDEX IF NOT EXISTS "UserReport_resolved_createdAt_idx" ON "UserReport"("resolved", "createdAt");

-- UserBlock model
CREATE TABLE IF NOT EXISTS "UserBlock" (
  "id"        TEXT         NOT NULL,
  "blockerId" TEXT         NOT NULL,
  "blockedId" TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserBlock_blockerId_blockedId_key" UNIQUE ("blockerId", "blockedId"),
  CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "UserBlock_blockerId_idx" ON "UserBlock"("blockerId");
CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");
