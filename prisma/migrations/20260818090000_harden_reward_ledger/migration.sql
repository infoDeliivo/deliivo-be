-- Harden reward wallet ledger with tamper-evidence and reversal tracking.
ALTER TABLE "RewardWalletEntry"
  ADD COLUMN IF NOT EXISTS "previousHash" TEXT,
  ADD COLUMN IF NOT EXISTS "entryHash" TEXT,
  ADD COLUMN IF NOT EXISTS "reversalOfEntryId" TEXT;

ALTER TABLE "RewardWalletEntry"
  ADD CONSTRAINT "RewardWalletEntry_reversalOfEntryId_fkey"
  FOREIGN KEY ("reversalOfEntryId") REFERENCES "RewardWalletEntry"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "RewardWalletEntry_reversalOfEntryId_idx"
  ON "RewardWalletEntry"("reversalOfEntryId");
