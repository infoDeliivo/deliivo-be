# Admin test DL verification — design

**Date:** 2026-08-02
**Status:** Approved

## Problem

Driving-licence (DL) verification runs through Veriff: the app creates a Veriff session, the
user completes a document scan, and Veriff posts a decision webhook that
`handleWebhookDecision` turns into a `DlVerification` row plus `user.dlVerified = true`.

That round trip cannot be driven from a test device. QA and developers therefore cannot get a
user past DL verification without editing the database by hand, which blocks every downstream
flow that gates on `user.dlVerified` — publishing a ride
(`src/modules/publish-ride/driver-eligibility.service.ts:158`) and accepting a booking as a
driver (`src/modules/driver-booking/driver-booking.service.ts:110`).

The app will grow a "TEST DL" button. This spec defines the backend it calls.

## Goals

- An admin can mark any user DL-verified, and can undo it.
- The resulting database state is indistinguishable from a real Veriff pass to every existing
  reader, so app screens behave normally.
- Every synthetic record is identifiable as synthetic when inspecting the database.

## Non-goals

- No self-serve endpoint. Users cannot verify themselves.
- No environment kill-switch. The route is admin-authenticated, which is the control.
- No changes to the real Veriff session, webhook, or eligibility code paths.

## Endpoints

```
POST /api/v1/admin/users/:id/dl/verify      → dlVerified = true
POST /api/v1/admin/users/:id/dl/unverify    → dlVerified = false
```

Both are declared in `src/modules/admin/admin.routes.ts`. That router is mounted behind
`protect` in `app.ts` and calls `router.use(authorize('ADMIN'))` at the top, so both routes are
admin-only without any extra middleware. They sit alongside the existing
`POST /admin/users/:id/ban` and follow its shape.

`:id` is validated as a UUID by a Zod params schema in `admin.validator.ts`, matching the
existing `vehicleIdParamSchema` pattern.

Request bodies are empty. Responses return the affected user's `dlVerified` flag and the
synthetic verification row, so the caller sees exactly what was written.

Unknown `:id` → `404 USER_NOT_FOUND`.

## Write logic

A new exported function in `src/modules/dl-verification/dl-verification.service.ts`:

```ts
setDlVerificationForTest(userId: string, verified: boolean, adminId: string)
```

The DL domain owns its own database writes; the admin module only exposes them. The admin
controller/service layer forwards the call and maps `USER_NOT_FOUND` to a 404.

The function runs one `prisma.$transaction` containing two writes.

### 1. Upsert the synthetic `DlVerification` row

Keyed on the unique `veriffSessionId`:

```
veriffSessionId = `admin-test:${userId}`
```

The key is deterministic rather than timestamped. Repeated clicks of the button are therefore
idempotent — they update one row instead of accumulating rows — and unverify can locate the
same row without a search.

Fields written:

| Field | verify | unverify |
|---|---|---|
| `status` | `APPROVED` | `DECLINED` |
| `nameMatch`, `dobMatch`, `genderMatch` | `true` | `false` |
| `verifiedName` | user's `firstName` + `lastName`, joined and trimmed | same |
| `verifiedDob` | user's `dob` | same |
| `verifiedGender` | user's `gender` | same |
| `veriffSessionUrl` | `https://admin-test.local/dl/${userId}` | same |
| `decisionPayload` | `{ source: 'ADMIN_TEST', adminId, at: <iso8601> }` | same, new timestamp |

`veriffSessionUrl` is a required non-null column, hence the placeholder value.

The identity fields are written identically on both operations, so unverify behaves the same
whether or not a synthetic row already exists — calling unverify on a user who was never
verified creates the `DECLINED` row rather than failing.

The identity fields are copied from the user's own profile so that the row satisfies the same
name/DOB/gender match invariant a genuine approved decision does. `decisionPayload.source`
makes every synthetic row greppable:

```sql
SELECT * FROM "DlVerification" WHERE "decisionPayload"->>'source' = 'ADMIN_TEST';
```

### 2. Update the user

`prisma.user.update({ where: { id: userId }, data: { dlVerified: verified } })`

### Interaction with real Veriff records

Genuine `DlVerification` rows are never modified or deleted — only the `admin-test:` row is
touched.

One consequence is intentional and accepted: if a user already holds a genuine `APPROVED`
Veriff row, calling unverify sets `dlVerified = false` while that real row stays `APPROVED`.
`GET /dl-verification/status` then lists an approved record belonging to a user who is not
verified. This is an admin override and the flag is the authority; both downstream consumers
read `user.dlVerified`, not the row status.

## Audit

Every call emits `logWarn('ADMIN_TEST_DL', { adminId, targetUserId, verified })`. Warn level so
the entries survive the production log level (`info`) set in `src/utils/logger.ts`.

## Testing

Both levels are required before this is complete.

### Unit — `src/modules/dl-verification/dl-verification.service.test.ts`

- verify sets `user.dlVerified = true` and writes an `APPROVED` row with all three match flags true
- verify copies `verifiedName` / `verifiedDob` / `verifiedGender` from the user profile
- unverify sets `dlVerified = false` and moves the row to `DECLINED`
- calling verify twice is idempotent — one row, no unique-constraint error
- unknown `userId` throws `USER_NOT_FOUND`
- a pre-existing genuine `DlVerification` row is left untouched
- `decisionPayload.source === 'ADMIN_TEST'`

### E2E — `tests/e2e/specs/`

New spec, following the existing spec numbering:

1. Admin authenticates.
2. Non-admin calling either route gets 403.
3. Admin verifies a test user.
4. As that user, `GET /dl-verification/status` reports an `APPROVED` record.
5. A publish-ride attempt that previously failed DL eligibility now passes that check.
6. Admin unverifies.
7. The publish-ride DL check blocks again.

### OpenAPI

Both paths documented in `docs/api/openapi/openapi.yaml`; `npm run openapi:coverage` enforces
coverage.

## Files touched

| File | Change |
|---|---|
| `src/modules/dl-verification/dl-verification.service.ts` | add `setDlVerificationForTest` |
| `src/modules/dl-verification/dl-verification.service.test.ts` | add unit tests |
| `src/modules/admin/admin.routes.ts` | add the two routes |
| `src/modules/admin/admin.controller.ts` | add the two handlers |
| `src/modules/admin/admin.validator.ts` | add the `:id` UUID params schema |
| `docs/api/openapi/openapi.yaml` | document both paths |
| `tests/e2e/specs/` | new spec |

No Prisma schema change — the existing `DlVerification` model and `User.dlVerified` column
carry everything needed.
