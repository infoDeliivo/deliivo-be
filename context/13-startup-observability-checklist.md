# Startup Observability Checklist

This checklist is scoped for a startup-stage Deliivo deployment. It separates what is already present in the codebase from what still needs to be added before observability is good enough for steady operation.

## What Is Already In Place

- Structured backend logging via Winston.
- Request correlation with `x-request-id`.
- HTTP completion logs with method, path, status, duration, and user ID when available.
- `/health` and `/health/ready` readiness endpoints.
- Queue workers for maintenance, booking deadlines, notifications, mail, and SMS.
- Admin monitoring workbench with KPIs, SLA targets, and a 7-day trend view.
- Admin reconciliation and ops views for payments, payouts, disputes, and ride history.

## What Is Still Missing

### 1. Centralized error tracking

- No dedicated error tracker is wired in for backend exceptions.
- No dedicated error tracker is wired in for frontend runtime exceptions.
- Current failure handling is visible in logs and UI feedback, but not centrally aggregated.

### 2. Exported metrics

- No Prometheus/OpenTelemetry-style metrics export.
- No time-series counters for:
  - request latency
  - queue depth
  - queue failures
  - webhook latency
  - booking funnel conversion
  - ride start and completion latency
  - notification delivery latency

### 3. Alerting

- No automated alerts for:
  - payment webhook failures
  - queue worker failures
  - reconciliation backlog
  - overdue-ride scheduler failures
  - elevated API error rates
  - Redis/database downtime

### 4. Log aggregation

- Logs are written locally and to console.
- There is no shipped log sink such as Loki, ELK, CloudWatch, or similar.
- This means cross-host debugging is still manual.

### 5. Distributed tracing

- `requestId` gives correlation, but there are no end-to-end spans across:
  - web request
  - payment confirmation
  - webhook handling
  - queue jobs
  - notifications
  - ride lifecycle actions

### 6. Client-side telemetry

- No web-vitals reporting.
- No browser error aggregation.
- No session-level performance telemetry for slow or failing flows.

## Startup-Minimum Recommendation

The minimum useful stack for Deliivo at this stage is:

1. Structured logs with `requestId`, `userId`, `rideId`, `bookingId`, `paymentId`, and `disputeId`.
2. Centralized error tracking for backend and web.
3. One metrics dashboard for core business and operational counters.
4. Alerts for payment, queue, database, Redis, and reconciliation failures.
5. A searchable log sink for production incidents.

## What Can Wait

- Full distributed tracing.
- Burn-rate SLO alerting.
- Deep performance analytics.
- Very granular dashboard segmentation.

## Practical Priority Order

1. Add error tracking.
2. Add log shipping.
3. Add basic metrics export.
4. Add alerts for critical flows.
5. Add tracing after the system is stable enough to justify it.

## Current Codebase Fit

This codebase is already strong on:

- request correlation
- structured logging
- health checks
- admin operational visibility

It is still weak on:

- centralized incident detection
- time-series metrics
- trace propagation beyond request IDs
- frontend runtime telemetry

