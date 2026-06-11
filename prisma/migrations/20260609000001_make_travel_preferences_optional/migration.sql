-- AlterTable: Make chattiness and pets optional
ALTER TABLE "TravelPreference" ALTER COLUMN "chattiness" DROP NOT NULL;
ALTER TABLE "TravelPreference" ALTER COLUMN "pets" DROP NOT NULL;
