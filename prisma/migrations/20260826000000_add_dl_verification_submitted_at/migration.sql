-- Stamped by Veriff's events webhook (action = "submitted") when the driver actually uploads
-- their documents. The row itself is created the moment a session opens, so status = PENDING
-- alone cannot separate a driver who submitted and is waiting on a decision from one who
-- opened the flow and walked away — and the publish checklist has to say opposite things to
-- those two. Nullable on purpose: NULL means "no submission recorded", which is also the
-- correct reading for every row that predates this column.
ALTER TABLE "DlVerification" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
