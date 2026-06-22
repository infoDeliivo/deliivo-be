# Phase 5: Reconciliation & Polish

## Overview
Phase 5 implements the payment reconciliation system that detects and auto-repairs state mismatches between Stripe and the internal payment state machine, plus exposes the offline action sync endpoint for drivers with intermittent connectivity.

## Modules Created

### 1. Reconciliation Module (`src/modules/reconciliation/`)

**Service** (`reconciliation.service.ts`):
- `runHourlyReconciliation` — compares recent payments (last 2h) against Stripe payment intent status. Detects mismatches and auto-repairs safe cases (e.g., missed webhook where Stripe says `succeeded` but internal state is `PAYMENT_PENDING`)
- `runDailyReconciliation` — detects stale escrow (>72h in HELD_IN_ESCROW), validates ledger balance integrity (debits must equal credits per payment)
- `listIssues` — paginated issue listing with filters (status, type, severity)
- `resolveIssue` — admin marks issue as resolved with resolution description
- `getIssueSummary` — dashboard summary (open count, by severity, auto-repaired count)

**Auto-repair rules:**
| Stripe Status | Internal Status | Action |
|---|---|---|
| `succeeded` | `PAYMENT_PENDING` | Move to `PAID` (missed webhook) |
| All other mismatches | — | Log as `STRIPE_MISMATCH` for manual review |

**Routes** (`reconciliation.routes.ts`) — mounted at `/api/v1/admin/reconciliation`:
- `POST /run/hourly` — manually trigger hourly reconciliation
- `POST /run/daily` — manually trigger daily reconciliation
- `GET /summary` — issue dashboard summary
- `GET /issues` — list issues (query: `status`, `issueType`, `severity`, `page`, `limit`)
- `POST /issues/:id/resolve` — resolve issue

### 2. Offline Sync Endpoint

**Route** added to `rideOperationsRouter`:
- `POST /api/v1/rides/offline-sync` — batch process queued offline actions

**Validator** (`offlineSyncSchema`):
- Accepts array of 1-50 actions, each with: `actionId` (UUID), `eventType`, `rideId`, optional `bookingId`, `lat`, `lng`, `clientTimestamp`

**Service** (already existed in `ride-operations.service.ts`):
- `syncOfflineActions` — idempotent processing using `actionId` as deduplication key on `RideEvent` model

## Schema Changes (Prisma)

```prisma
model ReconciliationIssue {
  id              String    @id @default(uuid())
  paymentId       String?
  bookingId       String?
  issueType       String    // STRIPE_MISMATCH, MISSING_WEBHOOK, ORPHAN_INTENT, LEDGER_IMBALANCE, STALE_ESCROW
  severity        String    @default("MEDIUM") // LOW, MEDIUM, HIGH, CRITICAL
  description     String
  stripeState     String?
  internalState   String?
  detectedAt      DateTime  @default(now())
  autoRepaired    Boolean   @default(false)
  repairedAt      DateTime?
  resolvedBy      String?
  resolvedAt      DateTime?
  resolution      String?
  metadataJson    Json?

  @@index([issueType, detectedAt])
  @@index([severity, resolvedAt])
  @@index([paymentId])
}
```

## Scheduled Jobs

Added to `src/queue/maintenance.queue.ts`:
- **Hourly reconciliation** — runs at `:15` past every hour
- **Daily reconciliation** — runs at `03:00 UTC`

Both are also triggerable manually via admin API for on-demand checks.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/v1/admin/reconciliation/run/hourly | Admin | Trigger hourly reconciliation |
| POST | /api/v1/admin/reconciliation/run/daily | Admin | Trigger daily reconciliation |
| GET | /api/v1/admin/reconciliation/summary | Admin | Issue dashboard summary |
| GET | /api/v1/admin/reconciliation/issues | Admin | List issues (paginated, filtered) |
| POST | /api/v1/admin/reconciliation/issues/:id/resolve | Admin | Resolve an issue |
| POST | /api/v1/rides/offline-sync | Driver | Batch sync offline actions |

## Issue Types

| Type | Severity | Description |
|------|----------|-------------|
| `STRIPE_MISMATCH` | HIGH | Stripe PI status doesn't match expected internal state |
| `MISSING_WEBHOOK` | MEDIUM | Payment succeeded on Stripe but webhook never arrived (auto-repairable) |
| `STALE_ESCROW` | HIGH | Payment stuck in escrow >72h |
| `LEDGER_IMBALANCE` | CRITICAL | Double-entry ledger debits != credits |
| `ORPHAN_INTENT` | LOW | Stripe PI exists but no matching payment record (future) |

## Tests

Integration test: `src/modules/integration/reconciliation-sync.integration.test.ts` — 12 tests:
- Hourly reconciliation (no issues, auto-repair, unsafe mismatch)
- Daily reconciliation (stale escrow detection, ledger imbalance)
- Admin issue management (list, resolve, reject double-resolve, summary)
- Offline sync (batch processing, duplicate detection, mixed results)
