# Logging Guide

## Overview

This project uses [Winston](https://github.com/winstonjs/winston) as its structured logging framework, replacing all raw `console.*` calls in application code. The logger is configured in `src/utils/logger.ts` and provides environment-aware, level-based, structured logging with file rotation in production.

---

## Logger Configuration

| Setting | Development | Production |
|---------|-------------|------------|
| **Min level** | `debug` | `info` (override with `LOG_LEVEL` env) |
| **Console output** | Colorized, human-readable | Colorized, human-readable |
| **File output** | None | `logs/error.log` (errors only) + `logs/combined.log` (all `info`+) |
| **File rotation** | N/A | 5 MB per file, max 5 files |
| **Format** | Timestamped text | JSON (files), timestamped text (console) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | — | Set to `production` to enable file transports |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Minimum log level to emit |

---

## Log Levels (severity order)

```
error  → Application failures, unhandled exceptions, external service errors
warn   → Degraded states, fallbacks, circuit breaker events, validation rejects
info   → Lifecycle events, successful operations, state transitions
http   → HTTP request/response logging (Morgan integration)
debug  → Verbose details for development (hidden in production)
```

---

## Usage

### Import

```typescript
import { logInfo, logError, logWarn, logDebug, logHttp } from '../utils/logger.js';
```

### API

```typescript
// Simple message
logInfo('Redis connected');

// Message + structured metadata
logInfo('Booking updated to DRIVER_PENDING', { bookingId });

// Error with exception object
logError('Payment processing failed', error, { bookingId, userId });

// Warning with context
logWarn('Google Routes circuit breaker OPEN');

// Debug (only shown in development)
logDebug('Webhook payload received', { size: rawPayload.length });
```

### Function Signatures

```typescript
logInfo(message: string, meta?: Record<string, unknown>): void
logError(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void
logWarn(message: string, meta?: Record<string, unknown>): void
logDebug(message: string, meta?: Record<string, unknown>): void
logHttp(message: string, meta?: Record<string, unknown>): void
```

---

## What Was Replaced

### Removed (debug garbage)

These `console.log` calls were leftover development artifacts and have been deleted entirely:

| File | Removed Code |
|------|-------------|
| `dl-verification.service.ts` | `console.log("1jhhguffiu")` |
| `dl-verification.service.ts` | `console.log(response,"jhhguffiu")` |
| `dl-verification.service.ts` | `console.log(error,"jhg")` |
| `dl-verification.controller.ts` | `console.log(req.body)` |
| `upload.middleware.ts` | `console.log(file.mimetype)` |
| `vehicle.service.ts` | `console.log(update)` |
| `vehicle.controller.ts` | `console.log(error)` |
| `google.service.ts` | `console.log(response)` (2 occurrences) |
| `publish-ride.controller.ts` | `console.log("error", error)` |

### Replaced by Category

#### Errors (`logError`)

All `console.error(...)` in controllers and services now use `logError` with structured metadata:

- **Controllers**: `user`, `auth`, `vehicle`, `dl-verification`, `search-ride`, `publish-ride`, `ratings`
- **Services**: `user`, `auth`, `cache`, `s3`, `fuel-price`, `booking-deadline-checker`
- **Queues**: `deadline`, `route`
- **Workers**: `mail`
- **Middlewares**: `errorHandler`

#### Warnings (`logWarn`)

- Circuit breaker state changes (half-open, open)
- Redis connection closed / reconnecting
- Webhook signature validation failures
- Fuel price fallback usage
- Cache invalidation failures

#### Info (`logInfo`)

- Redis connected / ready
- Worker boot / ready events
- Cron job schedules
- Booking state transitions (deadline expired, auto-cancelled)
- Webhook signature verified
- Fuel price refreshed
- Notifications sent successfully

#### Debug (`logDebug`)

- Webhook payload size and signature presence
- Booking details during processing
- Mail job received
- Fuel price refresh start
- Notification sending (before confirmation)

---

## Files NOT Changed

| File/Directory | Reason |
|----------------|--------|
| `src/scripts/*` | CLI utilities — `console.log` is appropriate for interactive scripts |
| `tests/**` | Test helpers use `console.warn` for skip messages — expected behavior |

---

## Production Log Output

### Console (stdout)

```
2026-06-03 14:22:01 [info]: Redis connected
2026-06-03 14:22:01 [info]: Mail worker ready
2026-06-03 14:22:05 [info]: Webhook signature verified {"eventType":"payment_intent.succeeded"}
2026-06-03 14:22:05 [info]: Booking updated to DRIVER_PENDING {"bookingId":"abc-123"}
2026-06-03 14:23:00 [warn]: Google Routes circuit breaker OPEN
2026-06-03 14:23:05 [error]: Payment processing failed {"error":"timeout","bookingId":"xyz-456"}
```

### File: `logs/error.log` (JSON)

```json
{"level":"error","message":"S3 upload error","error":"AccessDenied","stack":"...","timestamp":"2026-06-03 14:22:05"}
{"level":"error","message":"Route queue job failed","error":"timeout","jobId":"job-789","timestamp":"2026-06-03 14:23:00"}
```

### File: `logs/combined.log` (JSON)

Contains all `info`, `warn`, and `error` level logs in JSON format for log aggregation tools (ELK, CloudWatch, Datadog).

---

## Best Practices

1. **Never use `console.*` in application code** — always use the logger utilities
2. **Use structured metadata** — pass context as objects, not string interpolation:
   ```typescript
   // Good
   logError('Booking cancel failed', error, { bookingId, userId });

   // Bad
   logError(`Booking ${bookingId} cancel failed for user ${userId}: ${error.message}`);
   ```
3. **Choose the right level**:
   - If it needs immediate attention → `error`
   - If it's degraded but recoverable → `warn`
   - If it's a normal lifecycle event → `info`
   - If it's only useful during debugging → `debug`
4. **Don't log sensitive data** — never log passwords, tokens, full card numbers, or PII
5. **Keep messages concise** — the metadata object carries the details
6. **Scripts are exempt** — `src/scripts/*` can use `console.log` since they're interactive CLI tools

---

## Adding the Logger to a New File

```typescript
// 1. Import only what you need
import { logInfo, logError } from '../utils/logger.js';

// 2. Use in try/catch blocks
try {
  const result = await someOperation();
  logInfo('Operation succeeded', { resultId: result.id });
} catch (error) {
  logError('Operation failed', error, { context: 'relevant-data' });
}
```

---

## Docker / Railway Deployment

In containerized environments:
- Logs go to stdout/stderr (console transport) — captured by the container runtime
- File transports are optional (set `NODE_ENV=production` to enable)
- For cloud log aggregation, parse the JSON from `logs/combined.log` or use a Winston transport for your provider (e.g., `winston-cloudwatch`)

To suppress debug logs in staging:
```env
LOG_LEVEL=info
```

To get maximum verbosity for troubleshooting:
```env
LOG_LEVEL=debug
```
