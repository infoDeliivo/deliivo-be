-- Tracker board and ticket detail tables.

DO $$
BEGIN
    CREATE TYPE "TrackerProductArea" AS ENUM ('WEBAPP', 'MOBILE_APP');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "TrackerTicketType" AS ENUM ('BUG', 'STORY', 'TASK', 'CHORE', 'IMPROVEMENT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "TrackerTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "TrackerTicketStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'IN_TESTING', 'DONE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TrackerTicket" (
    "id" TEXT NOT NULL,
    "productArea" "TrackerProductArea" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "ticketType" "TrackerTicketType" NOT NULL,
    "priority" "TrackerTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TrackerTicketStatus" NOT NULL DEFAULT 'TODO',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "notes" TEXT,
    "blockerReason" TEXT,
    "releaseTarget" TEXT,
    "externalLinksJson" JSONB,
    "metadataJson" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackerTicket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrackerTicket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrackerTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrackerTicket_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TrackerComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackerComment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrackerComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "TrackerTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackerComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TrackerAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackerAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrackerAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "TrackerTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackerAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TrackerChecklistItem" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT FALSE,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackerChecklistItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrackerChecklistItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "TrackerTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TrackerTicket_productArea_status_priority_dueDate_idx"
    ON "TrackerTicket"("productArea", "status", "priority", "dueDate");

CREATE INDEX IF NOT EXISTS "TrackerTicket_assigneeId_status_idx"
    ON "TrackerTicket"("assigneeId", "status");

CREATE INDEX IF NOT EXISTS "TrackerTicket_createdAt_idx"
    ON "TrackerTicket"("createdAt");

CREATE INDEX IF NOT EXISTS "TrackerComment_ticketId_createdAt_idx"
    ON "TrackerComment"("ticketId", "createdAt");

CREATE INDEX IF NOT EXISTS "TrackerAttachment_ticketId_createdAt_idx"
    ON "TrackerAttachment"("ticketId", "createdAt");

CREATE INDEX IF NOT EXISTS "TrackerChecklistItem_ticketId_sortOrder_idx"
    ON "TrackerChecklistItem"("ticketId", "sortOrder");
