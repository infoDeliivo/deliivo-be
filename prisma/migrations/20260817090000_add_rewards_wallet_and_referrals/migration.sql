-- Referral / rewards support
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredByUserId" TEXT;

CREATE TABLE IF NOT EXISTS "RewardCampaign" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "thresholdCount" INTEGER NOT NULL DEFAULT 1,
    "rewardAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "repeatable" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "terms" TEXT,
    "metadataJson" JSONB,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RewardCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RewardReferral" (
    "id" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "referralCode" TEXT,
    "qualificationType" TEXT,
    "qualificationSourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "firstQualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RewardReferral_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RewardWalletEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletType" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "referralId" TEXT,
    "description" TEXT,
    "metadataJson" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardWalletEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User"
  ADD CONSTRAINT "User_referredByUserId_fkey"
  FOREIGN KEY ("referredByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RewardCampaign"
  ADD CONSTRAINT "RewardCampaign_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RewardCampaign"
  ADD CONSTRAINT "RewardCampaign_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RewardReferral"
  ADD CONSTRAINT "RewardReferral_referrerUserId_fkey"
  FOREIGN KEY ("referrerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardReferral"
  ADD CONSTRAINT "RewardReferral_referredUserId_fkey"
  FOREIGN KEY ("referredUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardWalletEntry"
  ADD CONSTRAINT "RewardWalletEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RewardWalletEntry"
  ADD CONSTRAINT "RewardWalletEntry_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "RewardCampaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RewardWalletEntry"
  ADD CONSTRAINT "RewardWalletEntry_referralId_fkey"
  FOREIGN KEY ("referralId") REFERENCES "RewardReferral"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RewardWalletEntry"
  ADD CONSTRAINT "RewardWalletEntry_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");
CREATE UNIQUE INDEX IF NOT EXISTS "RewardCampaign_code_key" ON "RewardCampaign"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "RewardReferral_referredUserId_key" ON "RewardReferral"("referredUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "RewardWalletEntry_idempotencyKey_key" ON "RewardWalletEntry"("idempotencyKey");
