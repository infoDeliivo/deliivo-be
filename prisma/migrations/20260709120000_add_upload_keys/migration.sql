-- Add object-key columns for presigned-URL uploads, and relax VehicleDocument.imageUrl
-- to nullable (documents are private — no public URL is stored, reads are signed).

ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "imageKey" TEXT;

ALTER TABLE "VehicleDocument" ADD COLUMN IF NOT EXISTS "imageKey" TEXT;
ALTER TABLE "VehicleDocument" ALTER COLUMN "imageUrl" DROP NOT NULL;
