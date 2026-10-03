-- Allow tracker tickets to store a free-text assignee label in addition to the optional user relation.

ALTER TABLE "TrackerTicket"
  ADD COLUMN IF NOT EXISTS "assigneeName" TEXT;
