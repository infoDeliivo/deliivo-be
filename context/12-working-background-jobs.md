# Working Background Jobs

This document records the background jobs, queue workers, and scheduled processes that are currently active in the codebase after duplicate cleanup.

## Active At Runtime

These are the jobs that are started from the main backend boot path or from separate worker processes:

- `startBookingTimeoutCron()` is no longer active after cleanup.
- `startFuelPriceCron()` is no longer active after cleanup.
- `deadlineWorker` in `src/queue/deadline.queue.ts`
- `maintenanceWorker` in `src/queue/maintenance.queue.ts`
- `pushWorker` in `src/jobs/index.ts`
- Mail worker process in `src/modules/mail/mail.worker.ts`
- SMS worker process in `src/modules/sms/sms.worker.ts`

## Queue And Job Purpose

### 1. Booking deadline queue

File: `src/queue/deadline.queue.ts`

Purpose:

- `initial`
  - Sends the first deadline notice to the rider when the driver has not responded in time.
- `reminder`
  - Sends the pre-expiry reminder to the driver so they can accept or reject the request before the deadline.
- `extended`
  - Performs the final auto-cancel path after the grace period expires, releases seats, and triggers refund handling when applicable.

### 2. Maintenance queue

File: `src/queue/maintenance.queue.ts`

Purpose:

- `nightly-cleanup`
  - Deletes read notifications older than 30 days.
  - Deletes all notifications older than 90 days.
  - Nullifies old processed Stripe webhook payloads after 30 days while preserving idempotency metadata.
- `hourly-reconciliation`
  - Checks recent payments against Stripe state and auto-repairs only safe webhook mismatches.
- `daily-reconciliation`
  - Detects stale escrow payments, ledger imbalance, and dispute/payment mismatches.
- `payout-eligibility`
  - Marks payments eligible for payout once the dispute window has passed.
- `ride-overdue-check`
  - Promotes rides that have passed departure time from `PUBLISHED` or `SCHEDULED` to `READY_TO_START`.
  - Sends ride-day notifications to the driver and active passengers.
  - Auto-cancels rides that never start after the configured grace window and releases seats.
  - Does not issue refunds by default; financial resolution is handled through dispute or admin review paths.
  - Raises an admin-visible reconciliation issue when a ride stays `IN_PROGRESS` beyond the expected end window.
- `payment-outbox`
  - Processes pending payment outbox events and advances payment state transitions.

### 3. Push notification worker

File: `src/jobs/index.ts`

Purpose:

- `push-notifications`
  - Sends queued push notifications to users through the push delivery service.

### 4. Mail worker

File: `src/modules/mail/mail.worker.ts`

Purpose:

- Sends queued email messages from the mail queue.
- Used for booking, payment, ride-day, and support-related email delivery.

### 5. SMS worker

File: `src/modules/sms/sms.worker.ts`

Purpose:

- Sends queued SMS messages from the SMS queue.
- Used for booking and ride-day operational messaging.

## Removed Duplicate Jobs

These files were removed because they duplicated other active paths or were no longer needed:

- `src/jobs/fuel-price.cron.ts`
  - Removed because the fuel price cron was not required.
- `src/jobs/booking-timeout.cron.ts`
  - Removed because the booking-deadline queue now owns deadline expiry and auto-cancel handling.
- `src/jobs/booking-deadline-checker.job.ts`
  - Removed because the deadline queue already owns the same responsibility.

## Present But Not Started By Runtime

The codebase still contains some queue/job definitions that are not started by the main backend process:

- `src/queue/route.queue.ts`
  - Route optimization worker definition exists, but it is not started from `src/server.ts`.
- `src/jobs/booking-deadline-checker.job.ts`
  - Removed from the repository during cleanup.

## Important Operational Note

Ride lifecycle is intentionally conservative:

- The scheduler now advances overdue rides from `PUBLISHED` or `SCHEDULED` to `READY_TO_START` once the scheduled departure time passes.
- If the driver still has not started the ride after the configured grace window, the system auto-cancels the ride, releases seats, and refunds captured payments where possible.
- If the driver still has not started the ride after the configured grace window, the system auto-cancels the ride and releases seats only. Refunds are intentionally not automatic and should be handled through dispute or admin review.
- If a ride is already `IN_PROGRESS` but exceeds the expected end window, the system records an admin-visible issue and sends notifications instead of auto-completing it.

This keeps booking and payout data auditable while still cleaning up orphaned seats from rides that never got started.
