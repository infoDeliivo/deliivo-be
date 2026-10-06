-- Admin archive: a reversible account removal that keeps the row and its PII so the
-- account can be restored. No existing data changes; all new columns are nullable.
ALTER TABLE "User" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "User" ADD COLUMN "archiveReason" VARCHAR(500);

ALTER TABLE "User" ADD CONSTRAINT "User_archivedById_fkey" FOREIGN KEY ("archivedById")
    REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_archivedAt_idx" ON "User"("archivedAt");

CREATE TYPE "AdminUserAuditAction" AS ENUM ('ARCHIVE', 'RESTORE', 'PURGE');

-- targetUserId and actorId deliberately carry no foreign key: the row must survive a
-- purge of the target, when it becomes the only record that the account existed.
CREATE TABLE "AdminUserAuditLog" (
    "id" TEXT NOT NULL,
    "action" "AdminUserAuditAction" NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "targetSnapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUserAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminUserAuditLog_targetUserId_idx" ON "AdminUserAuditLog"("targetUserId");
CREATE INDEX "AdminUserAuditLog_createdAt_idx" ON "AdminUserAuditLog"("createdAt");
