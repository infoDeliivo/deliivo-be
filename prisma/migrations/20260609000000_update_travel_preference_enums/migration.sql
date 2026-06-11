-- AlterEnum: Update Chattiness enum values
ALTER TYPE "Chattiness" RENAME TO "Chattiness_old";
CREATE TYPE "Chattiness" AS ENUM ('chatterbox', 'chatty_when_comfortable', 'quiet');
ALTER TABLE "TravelPreference" ALTER COLUMN "chattiness" TYPE "Chattiness" USING (
  CASE 
    WHEN "chattiness"::text = 'LOW' THEN 'quiet'::"Chattiness"
    WHEN "chattiness"::text = 'MEDIUM' THEN 'chatty_when_comfortable'::"Chattiness"
    WHEN "chattiness"::text = 'HIGH' THEN 'chatterbox'::"Chattiness"
    ELSE "chattiness"::text::"Chattiness"
  END
);
DROP TYPE "Chattiness_old";

-- AlterEnum: Update PetsPreference enum values
ALTER TYPE "PetsPreference" RENAME TO "PetsPreference_old";
CREATE TYPE "PetsPreference" AS ENUM ('love_pets', 'depends_on_animal', 'no_pets');
ALTER TABLE "TravelPreference" ALTER COLUMN "pets" TYPE "PetsPreference" USING (
  CASE 
    WHEN "pets"::text = 'YES' THEN 'love_pets'::"PetsPreference"
    WHEN "pets"::text = 'NO' THEN 'no_pets'::"PetsPreference"
    WHEN "pets"::text = 'SOMETIMES' THEN 'depends_on_animal'::"PetsPreference"
    ELSE "pets"::text::"PetsPreference"
  END
);
DROP TYPE "PetsPreference_old";
