-- A vehicle document row can outlive the file it points at: the client takes a presigned URL,
-- the bytes never land (or the promote out of tmp/ half-fails), and the row is created anyway.
-- Nothing re-checked those rows afterwards, so the driver saw a complete vehicle and we held
-- nothing. These columns let a nightly audit record what it found.

-- Null means "believed present" — the last check found the object, or the row was never checked.
ALTER TABLE "VehicleDocument" ADD COLUMN "storageMissingAt" TIMESTAMP(3);
ALTER TABLE "VehicleDocument" ADD COLUMN "storageCheckedAt" TIMESTAMP(3);

-- Guards the "your document never reached us" message to once per breakage. Reset to NULL when
-- the vehicle recovers so a later breakage is announced again.
ALTER TABLE "Vehicle" ADD COLUMN "documentIssueNotifiedAt" TIMESTAMP(3);

-- The audit reads by verdict, and pages oldest-check-first.
CREATE INDEX "VehicleDocument_storageMissingAt_idx" ON "VehicleDocument"("storageMissingAt");
CREATE INDEX "VehicleDocument_storageCheckedAt_idx" ON "VehicleDocument"("storageCheckedAt");
