-- These models existed on develop without matching migrations. Keep schema and
-- generated client consistent even when rewards are disabled. No data is removed.
CREATE TABLE IF NOT EXISTS "RewardSettlementBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchKey" TEXT NOT NULL,
    "walletType" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "sourceDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "topupId" TEXT,
    "topupStatus" TEXT,
    "topupAmount" DOUBLE PRECISION,
    "notes" TEXT,
    "createdById" TEXT,
    "fundingRequestedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RewardSettlementBatch_createdById_fkey" FOREIGN KEY ("createdById")
      REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RewardSettlementItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementBatchId" TEXT NOT NULL,
    "rewardWalletEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metadataJson" JSONB,
    "settledAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardSettlementItem_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId")
      REFERENCES "RewardSettlementBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RewardSettlementItem_rewardWalletEntryId_fkey" FOREIGN KEY ("rewardWalletEntryId")
      REFERENCES "RewardWalletEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "RewardSettlementBatch_batchKey_key" ON "RewardSettlementBatch"("batchKey");
CREATE INDEX IF NOT EXISTS "RewardSettlementBatch_walletType_currency_status_idx" ON "RewardSettlementBatch"("walletType", "currency", "status");
CREATE INDEX IF NOT EXISTS "RewardSettlementBatch_sourceDate_idx" ON "RewardSettlementBatch"("sourceDate");
CREATE INDEX IF NOT EXISTS "RewardSettlementBatch_topupId_idx" ON "RewardSettlementBatch"("topupId");
CREATE UNIQUE INDEX IF NOT EXISTS "RewardSettlementItem_rewardWalletEntryId_key" ON "RewardSettlementItem"("rewardWalletEntryId");
CREATE INDEX IF NOT EXISTS "RewardSettlementItem_settlementBatchId_status_idx" ON "RewardSettlementItem"("settlementBatchId", "status");
CREATE INDEX IF NOT EXISTS "RewardSettlementItem_userId_createdAt_idx" ON "RewardSettlementItem"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RewardSettlementItem_walletType_createdAt_idx" ON "RewardSettlementItem"("walletType", "createdAt");

-- Also complete the indexes declared by the original wallet migration's schema.
CREATE INDEX IF NOT EXISTS "RewardCampaign_audience_triggerType_active_idx" ON "RewardCampaign"("audience", "triggerType", "active");
CREATE INDEX IF NOT EXISTS "RewardReferral_referrerUserId_status_idx" ON "RewardReferral"("referrerUserId", "status");
CREATE INDEX IF NOT EXISTS "RewardWalletEntry_userId_createdAt_idx" ON "RewardWalletEntry"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RewardWalletEntry_walletType_createdAt_idx" ON "RewardWalletEntry"("walletType", "createdAt");
CREATE INDEX IF NOT EXISTS "RewardWalletEntry_campaignId_idx" ON "RewardWalletEntry"("campaignId");
CREATE INDEX IF NOT EXISTS "RewardWalletEntry_referralId_idx" ON "RewardWalletEntry"("referralId");
