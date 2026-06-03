-- B4: femaleOnly flag on rides
ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "femaleOnly" BOOLEAN NOT NULL DEFAULT false;

-- B6: Terms of Service and Privacy acceptance tracking on users
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tosAcceptedAt"     TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tosVersion"        TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyVersion"    TEXT;
