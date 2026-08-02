# Admin Test DL Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins two routes that mark any user's driving licence verified (or unverified) without a real Veriff round trip, so the app's "TEST DL" button can unblock every flow gated on `user.dlVerified`.

**Architecture:** The write lives in the DL domain (`dl-verification.service.ts`) as `setDlVerificationForTest`; the admin module only exposes it over HTTP. The function upserts one synthetic `DlVerification` row keyed on the deterministic unique `veriffSessionId = "admin-test:<userId>"` and flips `user.dlVerified` in the same `$transaction`. Genuine Veriff rows are never touched.

**Tech Stack:** TypeScript 5 ESM, Express 5, Prisma 7 / PostgreSQL, Zod, Jest (unit) + Jest E2E against a live server, OpenAPI 3 (redocly).

**Spec:** `docs/superpowers/specs/2026-08-02-admin-test-dl-verification-design.md`

## Global Constraints

- **Never use the `any` type.** `@typescript-eslint/no-explicit-any` is on. Use `unknown` with narrowing. (Pre-existing `any` in files you touch may stay; do not add new ones.)
- ESM: every relative import inside `src/` ends in `.js`, even when the source is `.ts`.
- Business logic lives in `.service.ts`; controllers stay thin.
- Unit tests are co-located `*.test.ts` next to the source. E2E specs live in `tests/e2e/specs/`.
- Synthetic session id format is exactly `admin-test:${userId}`.
- `decisionPayload.source` is exactly the string `ADMIN_TEST`.
- Routes are exactly `POST /api/v1/admin/users/:id/dl/verify` and `POST /api/v1/admin/users/:id/dl/unverify`.
- Run `npx eslint src` before each commit; it must be clean for the files you touched.

---

### Task 1: `setDlVerificationForTest` service function

**Files:**
- Modify: `src/modules/dl-verification/dl-verification.service.ts` (append a new exported function at the end of the file)
- Test: `src/modules/dl-verification/dl-verification.service.test.ts` (extend the existing prisma mock, append a new `describe`)

**Interfaces:**
- Consumes: `prisma` from `../../config/index.js`, `logWarn` from `../../utils/logger.js`, `DlVerificationStatus` and `Prisma` from `@prisma/client` — all four are already imported at the top of `dl-verification.service.ts`. Verify with `head -20` before adding imports; only add what is genuinely missing.
- Produces:
  ```ts
  export const setDlVerificationForTest: (
    userId: string,
    verified: boolean,
    adminId: string | null,
  ) => Promise<{ record: DlVerification; dlVerified: boolean }>
  ```
  Throws `new Error('USER_NOT_FOUND')` when the user does not exist. Task 2 consumes this.

**Background — why an upsert on a deterministic key:** the button can be pressed repeatedly. A timestamped id would pile up rows; a fixed id means press-twice is a no-op update, and unverify can find the same row without searching.

- [ ] **Step 1: Extend the prisma mock in the existing test file**

The mock at the top of `src/modules/dl-verification/dl-verification.service.test.ts` has no `upsert` and no `$transaction`. Add them. The whole `mockPrisma` object becomes:

```ts
const mockPrisma = {
    dlVerification: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        upsert: jest.fn(),
    },
    user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
};
```

`$transaction` is mocked as `Promise.all` because the implementation uses the **array** form (`prisma.$transaction([opA, opB])`), not the callback form. With the array form the mocked `upsert`/`update` return already-resolved promises, so `Promise.all` reproduces the real return value — an array of results in order.

Then change the import line at the top of the same file from:

```ts
import { handleWebhookDecision, registerVeriffSession } from './dl-verification.service';
```

to:

```ts
import {
    handleWebhookDecision,
    registerVeriffSession,
    setDlVerificationForTest,
} from './dl-verification.service';
```

- [ ] **Step 2: Write the failing tests**

Append this `describe` block to the end of `src/modules/dl-verification/dl-verification.service.test.ts`:

```ts
describe('setDlVerificationForTest — admin test override', () => {
    const testProfile = {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dob: new Date('1988-12-10T00:00:00Z'),
        gender: 'FEMALE',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.user.findUnique.mockResolvedValue(testProfile);
        mockPrisma.dlVerification.upsert.mockResolvedValue({ id: 'rec-test-1' });
        mockPrisma.user.update.mockResolvedValue({ id: 'user-9', dlVerified: true });
        mockPrisma.$transaction.mockImplementation((operations: unknown[]) => Promise.all(operations));
    });

    it('marks the user DL-verified and writes an APPROVED row with every match flag true', async () => {
        const result = await setDlVerificationForTest('user-9', true, 'admin-1');

        expect(result.dlVerified).toBe(true);
        expect(result.record).toEqual({ id: 'rec-test-1' });

        expect(mockPrisma.dlVerification.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { veriffSessionId: 'admin-test:user-9' },
                create: expect.objectContaining({
                    userId: 'user-9',
                    veriffSessionId: 'admin-test:user-9',
                    veriffSessionUrl: 'https://admin-test.local/dl/user-9',
                    status: 'APPROVED',
                    nameMatch: true,
                    dobMatch: true,
                    genderMatch: true,
                }),
                update: expect.objectContaining({
                    status: 'APPROVED',
                    nameMatch: true,
                    dobMatch: true,
                    genderMatch: true,
                }),
            }),
        );

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-9' },
            data: { dlVerified: true },
        });
    });

    it('copies the identity fields from the user profile so the row self-matches', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');

        const args = mockPrisma.dlVerification.upsert.mock.calls[0][0];
        expect(args.create).toMatchObject({
            verifiedName: 'Ada Lovelace',
            verifiedDob: '1988-12-10',
            verifiedGender: 'FEMALE',
        });
    });

    it('tags the row as synthetic so it is greppable in the database', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');

        const args = mockPrisma.dlVerification.upsert.mock.calls[0][0];
        expect(args.create.decisionPayload).toMatchObject({
            source: 'ADMIN_TEST',
            adminId: 'admin-1',
        });
        expect(typeof args.create.decisionPayload.at).toBe('string');
    });

    it('unverifies: DECLINED row, all match flags false, flag cleared', async () => {
        mockPrisma.user.update.mockResolvedValue({ id: 'user-9', dlVerified: false });

        const result = await setDlVerificationForTest('user-9', false, 'admin-1');

        expect(result.dlVerified).toBe(false);
        expect(mockPrisma.dlVerification.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({
                    status: 'DECLINED',
                    nameMatch: false,
                    dobMatch: false,
                    genderMatch: false,
                }),
            }),
        );
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-9' },
            data: { dlVerified: false },
        });
    });

    it('is idempotent — a second verify upserts the same key instead of creating a row', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');
        await setDlVerificationForTest('user-9', true, 'admin-1');

        expect(mockPrisma.dlVerification.create).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.upsert).toHaveBeenCalledTimes(2);
        const [first, second] = mockPrisma.dlVerification.upsert.mock.calls;
        expect(first[0].where).toEqual(second[0].where);
    });

    it('never touches a real Veriff row', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');

        expect(mockPrisma.dlVerification.update).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.create).not.toHaveBeenCalled();
    });

    it('does both writes in one transaction', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');

        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('throws USER_NOT_FOUND for an unknown user and writes nothing', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(setDlVerificationForTest('nope', true, 'admin-1')).rejects.toThrow(
            'USER_NOT_FOUND',
        );
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.upsert).not.toHaveBeenCalled();
    });

    it('handles a profile with no name, DOB or gender', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            firstName: null,
            lastName: null,
            dob: null,
            gender: null,
        });

        await setDlVerificationForTest('user-9', true, 'admin-1');

        const args = mockPrisma.dlVerification.upsert.mock.calls[0][0];
        expect(args.create).toMatchObject({
            verifiedName: null,
            verifiedDob: null,
            verifiedGender: null,
        });
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx jest src/modules/dl-verification/dl-verification.service.test.ts -t "admin test override"
```

Expected: FAIL. The import of `setDlVerificationForTest` is undefined, so every test errors with something like `TypeError: (0 , _dlverificationservice.setDlVerificationForTest) is not a function`.

- [ ] **Step 4: Write the implementation**

Append to the end of `src/modules/dl-verification/dl-verification.service.ts`:

```ts
// ─── Admin test override ───────────────────────────────────────────
// Marks a user DL-verified (or clears it) without a Veriff round trip, so the
// flows gated on `user.dlVerified` can be exercised on a test device. Admin-only
// at the route layer. The synthetic row is keyed on a deterministic session id so
// repeated calls update one row instead of piling up, and every synthetic row is
// findable by `decisionPayload->>'source' = 'ADMIN_TEST'`.
export const setDlVerificationForTest = async (
  userId: string,
  verified: boolean,
  adminId: string | null,
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, dob: true, gender: true },
  });

  if (!user) throw new Error('USER_NOT_FOUND');

  // Copied from the profile so the row satisfies the same identity-match invariant
  // a genuine approved decision does.
  const verifiedName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null;
  const verifiedDob = user.dob ? user.dob.toISOString().slice(0, 10) : null;
  const verifiedGender = user.gender ?? null;

  const veriffSessionId = `admin-test:${userId}`;
  const status: DlVerificationStatus = verified ? 'APPROVED' : 'DECLINED';

  const fields = {
    status,
    decisionCode: null,
    reasonCode: null,
    decisionPayload: {
      source: 'ADMIN_TEST',
      adminId,
      at: new Date().toISOString(),
    } as Prisma.InputJsonValue,
    verifiedName,
    verifiedDob,
    verifiedGender,
    nameMatch: verified,
    dobMatch: verified,
    genderMatch: verified,
  };

  const [record] = await prisma.$transaction([
    prisma.dlVerification.upsert({
      where: { veriffSessionId },
      create: {
        userId,
        veriffSessionId,
        veriffSessionUrl: `https://admin-test.local/dl/${userId}`,
        ...fields,
      },
      update: fields,
    }),
    prisma.user.update({
      where: { id: userId },
      data: { dlVerified: verified },
    }),
  ]);

  logWarn('ADMIN_TEST_DL', { adminId, targetUserId: userId, verified });

  return { record, dlVerified: verified };
};
```

Before running, confirm the file's existing imports cover `prisma`, `logWarn`, `DlVerificationStatus` and `Prisma`:

```bash
head -20 src/modules/dl-verification/dl-verification.service.ts
```

Add only what is missing. `logWarn` comes from `../../utils/logger.js`; `DlVerificationStatus` and `Prisma` come from `@prisma/client`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx jest src/modules/dl-verification/dl-verification.service.test.ts
```

Expected: PASS — the new `describe` and every pre-existing test in the file. The mock changes must not break the webhook tests.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit && npx eslint src/modules/dl-verification
```

Expected: no output from either.

- [ ] **Step 7: Commit**

```bash
git add src/modules/dl-verification/dl-verification.service.ts src/modules/dl-verification/dl-verification.service.test.ts
git commit -m "feat(dl-verification): add admin test override for DL verification"
```

---

### Task 2: Admin routes, controller and validator

**Files:**
- Modify: `src/modules/admin/admin.validator.ts` (add `userIdParamSchema`)
- Modify: `src/modules/admin/admin.controller.ts` (add two handlers)
- Modify: `src/modules/admin/admin.routes.ts` (add two routes)

**Interfaces:**
- Consumes: `setDlVerificationForTest(userId, verified, adminId)` from Task 1.
- Produces: `POST /api/v1/admin/users/:id/dl/verify` and `POST /api/v1/admin/users/:id/dl/unverify`. Success envelope carries `data: { record, dlVerified }`. Task 4's E2E spec calls these.

**Background:** `admin.routes.ts` already runs `router.use(authorize('ADMIN'))` at the top and the whole router is mounted behind `protect` in `app.ts`. No extra auth middleware is needed — a non-admin gets 403 from the existing guard.

There is no HTTP-level unit test harness for the admin module (`admin.service.test.ts` tests services directly, not routes). This layer is a thin pass-through with no branching logic beyond the error mapping, and it is covered end-to-end by Task 4. Do not invent a route-level unit test harness for it.

- [ ] **Step 1: Add the params schema**

Append to `src/modules/admin/admin.validator.ts`:

```ts
export const userIdParamSchema = z.object({
    id: z.string().uuid('A valid user id is required'),
});
```

- [ ] **Step 2: Add the controller handlers**

Add to `src/modules/admin/admin.controller.ts`. Place them after `unbanUser` (around line 50) so the user-management handlers stay together.

First add the import near the other module imports at the top of the file:

```ts
import { setDlVerificationForTest } from '../dl-verification/dl-verification.service.js';
```

Then the handlers:

```ts
/* ================= TEST DL VERIFICATION ================= */
// Marks a user's driving licence verified without a Veriff round trip. Admin-only —
// the router applies authorize('ADMIN') to every route in this module.
const applyTestDlVerification = async (req: AuthRequest, res: Response, verified: boolean) => {
    try {
        const result = await setDlVerificationForTest(
            req.params.id as string,
            verified,
            req.user?.id ?? null,
        );
        return sendSuccess(res, {
            message: verified ? 'DL marked verified' : 'DL verification cleared',
            data: result,
        });
    } catch (error: unknown) {
        if (error instanceof Error && error.message === 'USER_NOT_FOUND')
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'User not found' });
        logError('Admin test DL verification failed', error);
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to update DL verification',
        });
    }
};

export const verifyDlForTest = (req: AuthRequest, res: Response) =>
    applyTestDlVerification(req, res, true);

export const unverifyDlForTest = (req: AuthRequest, res: Response) =>
    applyTestDlVerification(req, res, false);
```

`logError`, `sendSuccess`, `sendError`, `HttpStatus` and `AuthRequest` are already imported at the top of this file — check with `head -10` and do not duplicate the imports.

- [ ] **Step 3: Add the routes**

In `src/modules/admin/admin.routes.ts`, extend the existing validator import:

```ts
import { rejectVehicleSchema, userIdParamSchema, vehicleIdParamSchema } from './admin.validator.js';
```

Then add the two routes immediately after the existing `unban` line:

```ts
// Test-only DL override: marks a user DL-verified without a Veriff round trip so the
// gated flows (publish ride, accept booking) can be reached on a test device.
router.post(
    '/users/:id/dl/verify',
    validate({ params: userIdParamSchema }),
    asyncHandler<AuthRequest>(adminController.verifyDlForTest),
);
router.post(
    '/users/:id/dl/unverify',
    validate({ params: userIdParamSchema }),
    asyncHandler<AuthRequest>(adminController.unverifyDlForTest),
);
```

`validate`, `asyncHandler` and `AuthRequest` are already imported in this file.

- [ ] **Step 4: Typecheck, lint and run the full unit suite**

```bash
npx tsc --noEmit && npx eslint src && npx jest
```

Expected: no type errors, no lint errors, all unit tests pass.

- [ ] **Step 5: Smoke-test the routes against a live server**

Start the server in one shell:

```bash
EXPOSE_OTP_IN_RESPONSE=true BOOKING_PAYMENT_MODE=bypass SMS_MOCK_MODE=true npm run dev:server
```

In another shell, call the route with a **non-admin** token to confirm the guard:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer <NON_ADMIN_ACCESS_TOKEN>" \
  http://localhost:3000/api/v1/admin/users/<SOME_UUID>/dl/verify
```

Expected: `403`.

Then with a non-UUID id and an admin token, expect `400` from the Zod params schema; with a well-formed but unknown UUID, expect `404`.

If you do not have an admin token to hand, promote a test user with `npx prisma studio` (set `role` to `ADMIN`) and re-issue the access token via `POST /api/v1/auth/access-token` — the role travels in the JWT, so a token minted before the promotion still says `USER`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/admin/admin.validator.ts src/modules/admin/admin.controller.ts src/modules/admin/admin.routes.ts
git commit -m "feat(admin): expose test DL verify/unverify routes"
```

---

### Task 3: OpenAPI documentation

**Files:**
- Modify: `docs/api/openapi/paths/admin.yaml`
- Modify: `docs/api/openapi/openapi.yaml`

**Interfaces:**
- Consumes: the two route paths from Task 2.
- Produces: nothing consumed by later tasks. `npm run openapi:coverage` enforces that every mounted route is documented, so this task exists to keep that gate green.

**Background:** despite the `.yaml` extension both files are JSON. `paths/admin.yaml` is a single object `{ "paths": { "<path>": { ...operations } } }`. `openapi.yaml` holds a `$ref` per path into that file, with `/` escaped as `~1` in the JSON pointer.

- [ ] **Step 1: Add both operations to `paths/admin.yaml`**

Insert these two entries inside the top-level `"paths"` object (mind the commas — they go before the closing brace of `"paths"`):

```json
"/api/v1/admin/users/{id}/dl/verify": {
  "post": {
    "operationId": "adminVerifyDlForTest",
    "summary": "POST admin/users/{id}/dl/verify",
    "description": "Test-only override: marks a user's driving licence verified without a Veriff round trip. Upserts a synthetic APPROVED `DlVerification` row (identifiable by `decisionPayload.source = \"ADMIN_TEST\"`) and sets `user.dlVerified` to true. Genuine Veriff records are never modified.",
    "tags": ["Admin"],
    "security": [{ "BearerAuth": [] }],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": { "type": "string", "format": "uuid" }
      }
    ],
    "responses": {
      "200": {
        "description": "Success",
        "content": {
          "application/json": {
            "schema": { "$ref": "../components/schemas/common.yaml#/ApiSuccessEnvelope" }
          }
        }
      },
      "400": { "$ref": "../components/responses/errors.yaml#/BadRequest" },
      "401": { "$ref": "../components/responses/errors.yaml#/Unauthorized" },
      "403": { "$ref": "../components/responses/errors.yaml#/Forbidden" },
      "404": { "$ref": "../components/responses/errors.yaml#/NotFound" },
      "500": { "$ref": "../components/responses/errors.yaml#/ServerError" }
    }
  }
},
"/api/v1/admin/users/{id}/dl/unverify": {
  "post": {
    "operationId": "adminUnverifyDlForTest",
    "summary": "POST admin/users/{id}/dl/unverify",
    "description": "Test-only override: clears a user's driving-licence verification. Moves the synthetic `DlVerification` row to DECLINED and sets `user.dlVerified` to false. A genuine APPROVED Veriff record is left as-is, so the flag and the record can legitimately disagree after this call — the flag is the authority.",
    "tags": ["Admin"],
    "security": [{ "BearerAuth": [] }],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": { "type": "string", "format": "uuid" }
      }
    ],
    "responses": {
      "200": {
        "description": "Success",
        "content": {
          "application/json": {
            "schema": { "$ref": "../components/schemas/common.yaml#/ApiSuccessEnvelope" }
          }
        }
      },
      "400": { "$ref": "../components/responses/errors.yaml#/BadRequest" },
      "401": { "$ref": "../components/responses/errors.yaml#/Unauthorized" },
      "403": { "$ref": "../components/responses/errors.yaml#/Forbidden" },
      "404": { "$ref": "../components/responses/errors.yaml#/NotFound" },
      "500": { "$ref": "../components/responses/errors.yaml#/ServerError" }
    }
  }
}
```

- [ ] **Step 2: Register both paths in `openapi.yaml`**

Add next to the other admin `$ref` entries (near line 145):

```json
"/api/v1/admin/users/{id}/dl/verify": {
  "$ref": "./paths/admin.yaml#/paths/~1api~1v1~1admin~1users~1{id}~1dl~1verify"
},
"/api/v1/admin/users/{id}/dl/unverify": {
  "$ref": "./paths/admin.yaml#/paths/~1api~1v1~1admin~1users~1{id}~1dl~1unverify"
}
```

- [ ] **Step 3: Verify the spec lints, bundles and covers**

```bash
npm run openapi:check
```

Expected: PASS. A JSON syntax error here usually means a missing or trailing comma from Step 1 — check with `node -e "JSON.parse(require('fs').readFileSync('docs/api/openapi/paths/admin.yaml','utf8')); console.log('ok')"`.

- [ ] **Step 4: Commit**

```bash
git add docs/api/openapi/paths/admin.yaml docs/api/openapi/openapi.yaml
git commit -m "docs(api): document admin test DL verify/unverify routes"
```

---

### Task 4: E2E spec

**Files:**
- Create: `tests/e2e/specs/35-admin-test-dl.e2e.test.ts`

**Interfaces:**
- Consumes: the routes from Task 2; `authed` / `api` from `../helpers/api.client`, `readState` from `../helpers/state`, `signupAndVerifyEmail` / `toAccountState` from `../helpers/auth.helper`.
- Produces: nothing.

**Background:** the API deliberately offers no way to create an admin, so E2E admin specs promote a freshly signed-up user by writing `role: 'ADMIN'` straight to the database, then re-issue the access token — the role travels inside the JWT, so a token minted before the promotion still says `USER` and every admin call returns 403. `tests/e2e/specs/34-vehicle-verification-queue.e2e.test.ts` is the reference for this. Specs skip themselves when `DATABASE_URL` is unset rather than failing.

The DL requirement key in the publish-ride eligibility checklist is `DL_VERIFICATION` (`src/modules/publish-ride/driver-eligibility.service.ts:23`). DL verification is the platform's KYC and no environment flag skips it, so this check is always live — unlike the vehicle check, this spec needs no bypass guard.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/specs/35-admin-test-dl.e2e.test.ts`:

```ts
/**
 * E2E — Admin test DL verification.
 *
 * The "TEST DL" button in the app calls these routes so QA can get past driving-licence
 * verification without a real Veriff round trip. Covers the admin-only guard, the flag
 * and the synthetic record it writes, the downstream publish-ride gate opening, and the
 * unverify route closing it again.
 *
 * Self-contained: creates its own admin and driver. The DB is used only to promote the
 * admin, which the API deliberately cannot do.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { api, authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail, toAccountState } from '../helpers/auth.helper';

const state = readState();

let adminToken: string;
let driverToken: string;
let driverId: string;
let ready = false;

function getDb(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
  return new PrismaClient({ adapter });
}

const dlRequirement = (body: any) =>
  (body.data?.requirements ?? []).find((item: any) => item.key === 'DL_VERIFICATION');

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    console.warn('[35-admin-test-dl] DATABASE_URL not set — tests will skip.');
    return;
  }

  const adminEmail = `e2e-testdl-admin-${state.runId}@test.local`;
  const adminSignup = await signupAndVerifyEmail(adminEmail);
  const admin = toAccountState(adminSignup, adminEmail);

  const db = getDb();
  try {
    await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  } finally {
    await db.$disconnect();
  }

  // The role travels in the JWT, so the signup token still says USER — refresh it or
  // every admin call comes back 403.
  const refreshed = await api.post('/auth/access-token', { refreshToken: adminSignup.refreshToken });
  adminToken =
    refreshed.status === 200 && refreshed.data?.data?.accessToken
      ? refreshed.data.data.accessToken
      : admin.accessToken;

  const driverEmail = `e2e-testdl-driver-${state.runId}@test.local`;
  const driver = toAccountState(await signupAndVerifyEmail(driverEmail), driverEmail);
  driverToken = driver.accessToken;
  driverId = driver.id;
  await authed(driverToken).put('/users/me', {
    firstName: 'Test',
    lastName: 'Licence',
    salutation: 'MR',
  });

  ready = Boolean(adminToken && driverToken && driverId);
});

describe('TC-TDL-001 — access control', () => {
  it('rejects a non-admin caller with 403', async () => {
    if (!ready) return;

    const res = await authed(driverToken).post(`/admin/users/${driverId}/dl/verify`, {});
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated caller with 401', async () => {
    if (!ready) return;

    const res = await api.post(`/admin/users/${driverId}/dl/verify`, {});
    expect(res.status).toBe(401);
  });

  it('rejects a malformed user id with 400', async () => {
    if (!ready) return;

    const res = await authed(adminToken).post('/admin/users/not-a-uuid/dl/verify', {});
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown user', async () => {
    if (!ready) return;

    const res = await authed(adminToken).post(
      '/admin/users/00000000-0000-4000-8000-000000000000/dl/verify',
      {},
    );
    expect(res.status).toBe(404);
  });
});

describe('TC-TDL-002 — the driver starts unverified', () => {
  it('reports NOT_STARTED and blocks publishing on DL_VERIFICATION', async () => {
    if (!ready) return;

    const status = await authed(driverToken).get('/dl-verification/status');
    expect(status.status).toBe(200);
    expect(status.data.data.status).toBe('NOT_STARTED');

    const checklist = await authed(driverToken).get('/publish-ride/eligibility');
    expect(dlRequirement(checklist.data)?.satisfied).toBe(false);
  });
});

describe('TC-TDL-003 — verify', () => {
  it('marks the driver DL-verified', async () => {
    if (!ready) return;

    const res = await authed(adminToken).post(`/admin/users/${driverId}/dl/verify`, {});

    expect(res.status).toBe(200);
    expect(res.data.data.dlVerified).toBe(true);
    expect(res.data.data.record.status).toBe('APPROVED');
  });

  it('shows an APPROVED record on the driver’s own status endpoint', async () => {
    if (!ready) return;

    const status = await authed(driverToken).get('/dl-verification/status');
    expect(status.data.data.status).toBe('APPROVED');
    expect(status.data.data.sessionId).toBe(`admin-test:${driverId}`);
  });

  it('opens the publish-ride DL gate', async () => {
    if (!ready) return;

    const checklist = await authed(driverToken).get('/publish-ride/eligibility');
    expect(dlRequirement(checklist.data)?.satisfied).toBe(true);
  });

  it('is idempotent — a second verify still returns 200 and one record', async () => {
    if (!ready) return;

    const again = await authed(adminToken).post(`/admin/users/${driverId}/dl/verify`, {});
    expect(again.status).toBe(200);
    expect(again.data.data.record.veriffSessionId).toBe(`admin-test:${driverId}`);

    const status = await authed(driverToken).get('/dl-verification/status');
    expect(status.data.data.status).toBe('APPROVED');
  });
});

describe('TC-TDL-004 — unverify', () => {
  it('clears the flag and declines the record', async () => {
    if (!ready) return;

    const res = await authed(adminToken).post(`/admin/users/${driverId}/dl/unverify`, {});

    expect(res.status).toBe(200);
    expect(res.data.data.dlVerified).toBe(false);
    expect(res.data.data.record.status).toBe('DECLINED');
  });

  it('closes the publish-ride DL gate again', async () => {
    if (!ready) return;

    const checklist = await authed(driverToken).get('/publish-ride/eligibility');
    expect(dlRequirement(checklist.data)?.satisfied).toBe(false);
  });
});
```

Note on `any`: the E2E suite is outside `src/` and the existing specs use `any` for loosely-typed response bodies (see `34-vehicle-verification-queue.e2e.test.ts`). This spec follows that local convention. `npx eslint src` does not cover `tests/`.

The requirement shape is `{ key, satisfied, skipped, reason, actionUrl }` (`PublishRequirement` in `src/modules/publish-ride/driver-eligibility.service.ts:34`), which is what the assertions above read.

- [ ] **Step 2: Start a server and run the spec**

Shell 1:

```bash
EXPOSE_OTP_IN_RESPONSE=true BOOKING_PAYMENT_MODE=bypass SMS_MOCK_MODE=true npm run dev:server
```

Shell 2:

```bash
E2E_BASE_URL=http://localhost:3000 npm run test:e2e -- --runInBand --testPathPattern=35-admin-test-dl
```

Expected: all tests pass. `E2E_BASE_URL` is the **origin only** — no `/api/v1` suffix; the client appends it. `--runInBand` matters: these specs share a database and interleave badly in parallel.

If every test silently passes without asserting anything, `DATABASE_URL` is unset and the spec skipped itself — export it and re-run.

- [ ] **Step 3: Run the full E2E suite to check for regressions**

```bash
E2E_BASE_URL=http://localhost:3000 npm run test:e2e -- --runInBand
```

Expected: no new failures versus the pre-change baseline. If unsure of the baseline, `git stash` the new spec and run once to compare.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/35-admin-test-dl.e2e.test.ts
git commit -m "test(e2e): cover admin test DL verify/unverify"
```

---

## Done criteria

All of these must hold, with output pasted:

- `npx jest` — green
- `npx tsc --noEmit` — clean
- `npx eslint src` — clean
- `npm run openapi:check` — green
- `E2E_BASE_URL=http://localhost:3000 npm run test:e2e -- --runInBand` — green
