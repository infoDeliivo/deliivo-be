# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Carpooling platform backend — Node.js 20+ / TypeScript 5 (ESM, `"type": "module"`), Express 5, Prisma 7 on PostgreSQL, Redis, Socket.IO, BullMQ. Full ride lifecycle: publish, search, book, OTP-verified pickup/drop, payments, ratings, push, real-time chat.

## Commands

```bash
npm run dev              # API + mail-worker + sms-worker together (nodemon, ts-node/esm)
npm run dev:server       # API only
npm run build            # prisma generate + tsc → dist/
npm start                # openapi:bundle + NODE_ENV=production node dist/server.js

npx jest                 # all unit tests (*.test.ts co-located in src/)
npx jest path/to/file.test.ts   # single file
npx jest -t "name"       # single test by name

npm run test:e2e         # E2E against a LIVE server (see below)
npm run test:e2e -- --testPathPattern=06-booking   # single E2E spec

npx eslint src           # lint (eslint 9, prettier)
npm run openapi:check     # lint + bundle + coverage of OpenAPI spec

npm run prisma:migrate:dev      # apply migrations (dev)
npm run prisma:generate         # regenerate client after schema.prisma change
npm run prisma:studio           # DB GUI
npm run db:seed                 # seed data
```

E2E requires a running server started with `EXPOSE_OTP_IN_RESPONSE=true`, `BOOKING_PAYMENT_MODE=bypass`, `SMS_MOCK_MODE=true`, then `E2E_BASE_URL=http://localhost:3000/api/v1 npm run test:e2e`. globalSetup creates `*@test.local` users; globalTeardown deletes them. See `tests/e2e/README.md`.

## Architecture

**Three processes** (`ecosystem.config.cjs` for PM2): `api-server` (`dist/server.js`, HTTP + WebSocket), `mail-worker` (`dist/modules/mail/mail.worker.js`), `sms-worker` (`dist/modules/sms/sms.worker.js`). Mail/SMS run in dedicated BullMQ workers so failures never block HTTP responses; scale independently.

**Request flow:** `src/server.ts` bootstraps HTTP + Socket.IO → `src/app.ts` wires middleware and mounts routers. All routers exported from `src/modules/index.ts`, all mounted under `/api/v1/*` behind `protect` (JWT) except public auth/health/docs.

**Middleware order matters** (`src/app.ts`): cors → helmet → requestContext → rateLimiter → **`/api/v1/payments` raw-body Stripe webhook router mounted BEFORE `express.json()`** (Stripe signature needs the raw body) → then `express.json()` for everything else. Do not move the payments webhook mount below the JSON parser.

**WebSocket:** Socket.IO 4 with Redis adapter, JWT passed as `auth.token`. Handler in `src/socket/`. Events: `join_booking_chat`, `send_message`, `new_message`, `user_typing`, `chat_joined`.

**Background jobs:** BullMQ queues started by side-effect imports in `app.ts` (`src/queue/deadline.queue.js`, `maintenance.queue.js`). A booking-deadline checker auto-expires unanswered booking requests. Note: single-instance assumption — a multi-instance deploy needs a distributed lock.

## Module convention

Each feature under `src/modules/<name>/` follows: `<name>.routes.ts` → `<name>.controller.ts` → `<name>.service.ts`, with `<name>.validator.ts` (Zod), `<name>.constants.ts`, `<name>.types.ts` as needed. Unit tests (`*.test.ts`) live beside the source. Business logic goes in `.service.ts`; controllers stay thin. Add a new module by creating the folder and exporting its router from `src/modules/index.ts`, then mounting it in `src/app.ts`.

Shared code: `src/config/` (prisma client, mailer, S3), `src/cache/redis.js`, `src/middlewares/` (auth `protect`, errorHandler, rate limiters, requestContext), `src/utils/` (`apiResponse`, `asyncHandler`, `httpStatus`, `logger`).

## External services

Stripe (PaymentIntents + webhooks), Firebase Admin (FCM/APNs push), Twilio (OTP SMS), AWS S3 (docs/avatars), Veriff (driving-licence KYC), Google Maps Directions (route computation). Config via `.env` — copy `.env.example`. Test/bypass flags: `BOOKING_PAYMENT_MODE=bypass` skips Stripe, `SMS_MOCK_MODE=true` logs instead of sending, `EXPOSE_OTP_IN_RESPONSE=true` returns OTP in response (testing only — never in production).

## Feature workflow

Every new feature is not done until it is verified correct **and** tested at two levels:

1. **Unit tests** — co-located `*.test.ts` covering the service/business logic. Run `npx jest`.
2. **Integration / E2E** — a spec under `tests/e2e/specs/` exercising the feature through the live API. Run `npm run test:e2e`.

Confirm both pass (paste output) before claiming the feature complete. A feature with only unit tests, or only E2E, is incomplete.

## Code standards

- Write senior-level, production-grade TypeScript: proper typing, clear separation of concerns, keep business logic in `.service.ts` and controllers thin.
- **Never use the `any` type.** No explicit `any`, no implicit `any`. Use precise types, generics, `unknown` with narrowing, or Zod-inferred types. (`@typescript-eslint/no-explicit-any` is on — do not introduce violations.)

## Notes

- Prisma 7 config lives in `prisma.config.ts` (schema `prisma/schema.prisma`), not in package.json.
- ESM: imports use `.js` extensions on TS source paths; jest `moduleNameMapper` rewrites `.js` → source.
- API docs: Swagger UI at `/docs`, raw spec at `/openapi.json`. Source is `docs/api/openapi/openapi.yaml`; keep routes documented (`npm run openapi:coverage` enforces).
