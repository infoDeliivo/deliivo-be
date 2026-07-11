-- Rename VehicleDocument.imageUrl -> image (data preserved).
-- Public docs store the URL here; private docs store nothing here (served via imageKey).

ALTER TABLE "VehicleDocument" RENAME COLUMN "imageUrl" TO "image";
