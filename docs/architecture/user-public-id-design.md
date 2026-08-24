# Public User ID Design

Status: Design proposal — not implemented
Date: 2026-08-19

## Purpose

Every API response, deep link, and support conversation currently carries `User.id`, the internal
database primary key (`String @id @default(uuid())`, `prisma/schema.prisma:90`). Two problems:

1. A UUID cannot be read aloud, typed from memory, or quoted in a support chat.
2. Publishing the storage key welds the public API contract to the database layout. Any future
   change to how users are keyed becomes a breaking client change.

This document specifies a short, non-guessable **public user ID** that the frontend displays and
the backend can resolve back to a user. The mapping lives in **its own table**, so the change is
purely additive:

- no column added to `User`
- no foreign key changes
- no migration of the other 39 models that use `uuid()`
- no existing endpoint, service signature, or query modified

Uniqueness is a requirement met by construction, not by chance: **one public ID per user forever,
and no two users can ever share one.**

## Goals / Non-Goals

**Goals**

- Human-readable, speakable, URL-safe identifier.
- Not enumerable — an attacker cannot walk the user base or infer user count.
- Stable for the lifetime of the account (it will be printed on support tickets).
- One generation path, reusable later for bookings, rides, and vehicles.
- Zero disruption to the running backend.

**Non-Goals**

- Replacing the UUID primary key (UUIDv7 / ULID). Out of scope.
- Changing foreign keys, the JWT `sub` claim, or any existing route contract.
- Making the public ID a credential. It is an identifier; authorization stays with `protect`
  plus the existing ownership checks.

## Current State

| Existing identifier | Location | How it is built | Assessment |
| --- | --- | --- | --- |
| User identifier | `prisma/schema.prisma:90` | UUID v4 primary key, returned to clients | Unreadable; couples contract to storage |
| Booking reference | `src/utils/booking-reference.ts:1-4` | `DLV-` + last 6 characters of the booking UUID, uppercased | Derived from the primary key (leaks 6 characters of it), no uniqueness check, collides in practice |
| Referral code | `src/modules/rewards/rewards.service.ts:33` | `DLV-` + first 8 hex characters of `randomUUID()` | Only 32 bits on an abuse-sensitive surface; correctness saved by the retry loop in `ensureReferralCodeInternal` (lines 125-147) |

Patterns this design deliberately reuses:

- The idempotent "ensure" shape and `P2002` retry of `ensureReferralCodeInternal`
  (`src/modules/rewards/rewards.service.ts:125-147`), wrapped in a transaction by
  `ensureUserReferralCode` (`:281-283`).
- The `DLV-` brand prefix convention (but **not** the last-6-of-UUID derivation).
- The signup transaction in `signupService` (`src/modules/auth/auth.service.ts:118-160`) as the
  mint point.
- The existing Redis client (`src/cache/redis.ts`, imported as `redis.js` per the ESM convention) for the resolution cache.

## Data Model

A separate mapping table. `User` gains only a back-relation field — no column, no data rewrite,
no reindex of a hot table.

```prisma
model UserPublicId {
  id       String @id @default(uuid())

  userId   String @unique                            // one row per user, ever
  sequence BigInt @unique @default(autoincrement())   // uniqueness spine, Postgres-owned
  publicId String @unique                            // "DLV-U-3K7QM94ZP2XR"

  issuedAt    DateTime @default(now())               // timestamp folded into the ID
  algoVersion Int      @default(1)                   // scheme can evolve without rewriting old IDs

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([issuedAt])
}
```

Three constraints, each doing distinct work:

- **`userId @unique` — no double public ID for a user.** A second mint attempt fails at the
  database; the loser reads the winner's row and returns it. Race-proof across the three PM2
  processes (`ecosystem.config.cjs`) without any lock, and without the single-instance assumption
  that the BullMQ deadline checker carries.
- **`sequence @unique @default(autoincrement())` — the uniqueness spine.** A Postgres `BIGSERIAL`:
  the classic URL-shortener counter. Never repeats, needs no worker/shard configuration, survives
  restarts and horizontal scaling.
- **`publicId @unique` — the backstop.** Under the bijective encoding below a duplicate is
  impossible; the index turns that from an assumption into an enforced invariant.

`onDelete: Cascade` means the GDPR delete path (`src/modules/user/user-gdpr.service.ts`) needs no
new code.

**Why a separate table rather than a column on `User`:** a column would avoid one join. The table
was chosen because it leaves the `User` model and every existing `select` in the codebase
completely untouched, keeps issue metadata (`sequence`, `issuedAt`, `algoVersion`) out of a hot
core table, and generalizes to other entities later without widening `User`. The join cost is
answered by the cache below, and the mapping is immutable so the cache never needs invalidation.

## ID Construction

A URL shortener turns a counter into a short string by base-encoding it. Same technique here, with
one addition: the counter is scrambled first, so the output is not enumerable.

```txt
STEP 1 — build a 64-bit unique spine                          (uniqueness by construction)

        +--------------------------- 64 bits --------------------------+
        |   issuedAt, unix seconds (32)   |       sequence (32)        |
        +--------------------------------------------------------------+

        Both values come from the row itself. The sequence alone already guarantees
        no repeat; the timestamp adds issue-time provenance and keeps the spine
        unique even across a counter reset or a table reseed.
        32 unsigned seconds carries to 2106; algoVersion covers the widening.

STEP 2 — scramble, bijectively                                (non-enumerable)

        64-bit Feistel network, 8 rounds
        round function: HMAC-SHA256(PUBLIC_ID_KEY, round || half)
        key from env / secret manager, never committed

        A Feistel network is a PERMUTATION: distinct inputs always map to distinct
        outputs. That is the whole point — a hash is not injective and would
        reintroduce birthday collisions. Encrypt, do not hash.

STEP 3 — encode, URL-shortener style

        Crockford base32: 0123456789ABCDEFGHJKMNPQRSTVWXYZ
        drops I, L, O, U — visual ambiguity and accidental profanity
        64 bits / 5 bits per symbol = 13 symbols

RESULT  DLV-U-3K7QM94ZP2XR
         ^   ^        ^
         |   |        13 symbols; uppercase storage, case-insensitive input
         |   entity tag: U = user (B / R / V reserved for booking, ride, vehicle)
         brand prefix
```

| Property | How it is obtained |
| --- | --- |
| No two users share an ID | Unique spine (`BIGSERIAL`) through a bijection — collision is mathematically impossible, not merely improbable |
| One ID per user, forever | `userId @unique` plus an idempotent `ensure` that returns the existing row |
| Not enumerable | Keyed Feistel output is indistinguishable from random without the key; consecutive sequence values produce unrelated strings |
| No PII inside | Deliberate — see below |
| Short and speakable | 13 unambiguous symbols, splits into readable groups |
| URL-safe | Uppercase alphanumerics only; needs no escaping in a path or query |
| Immutable | Computed once at mint time and stored; never recomputed on read |

### PII is not an input — deliberately

Email, phone, and name are **not** folded into the derivation. Two reasons, both concrete:

1. **Confirmation oracle.** Any deterministic function of an email is checkable offline. An
   attacker holding a public ID could test candidate addresses until one reproduced it, turning a
   displayed ID into an email-verification service.
2. **Mutability.** Users change email and phone. An ID derived from them would either change with
   the account — breaking the "stable for life" goal and every support ticket that quotes it — or
   silently stop matching its own inputs.

"User details" live as **columns on the row** (`userId`, `issuedAt`, `sequence`), which is what
makes the mapping auditable and the uniqueness provable. They are not inside the string.

### Key management — the honest trade-off

Unpredictability rests entirely on `PUBLIC_ID_KEY`. If that key leaks, an attacker can generate
every valid ID from a counter and learn both signup order and total user count. The collision
guarantee is unaffected; only the enumeration resistance is.

Mitigations, team's choice:

- **(a)** Store the key in the secret manager under the same handling as the JWT signing key.
  Rotation is safe: `algoVersion` records which key produced which row, and resolution is a table
  lookup, never a decryption.
- **(b)** Append 2 random Crockford symbols (15 total). Key compromise then still leaves 1024
  unknowns per ID, at the cost of two characters and a `P2002` retry path.

The simpler alternative — 10 purely random symbols with a unique index and retry — is kept in the
trade-off table. It has no key to protect; its cost is that collision becomes probabilistic
(8.9e-9 per insert at 10M users) rather than impossible.

For reference, the entropy of a purely random variant at various lengths:

| Symbols | Bits | Space | P(collision per insert @ 10M users) | P(guessing a live ID per attempt) |
| --- | --- | --- | --- | --- |
| 6 | 30 | 1.07e9 | 9.3e-3 | 9.3e-3 — enumerable, rejected |
| 8 | 40 | 1.10e12 | 9.1e-6 | 9.1e-6 |
| 10 | 50 | 1.13e15 | 8.9e-9 | 8.9e-9 |
| 13 (chosen, keyed) | 64 | 1.84e19 | 0 — bijection | 5.4e-13 |

## Minting Flow

```txt
signup   (or first profile read, for a user created before this feature)
   |
   v
ensureUserPublicId(userId)                 idempotent; shape mirrors ensureReferralCodeInternal
   |
   +-- row already exists?  -> return its publicId       (never regenerate)
   |
   v
INSERT INTO "UserPublicId" ("userId")      sequence + issuedAt assigned by Postgres
   |
   +-- P2002 on userId  -> lost a concurrent race: SELECT the winning row, return it
   |
   v
publicId = crockford32( feistel_K( issuedAt_seconds : sequence ) )
   |
   v
UPDATE that row SET "publicId" = ...       same transaction as the INSERT
   |
   +-- P2002 on publicId -> impossible under a bijection. Do NOT retry silently:
                            alert and fail loudly, it signals a key or algorithm bug.
```

Two statements in one transaction, because the spine values are database-assigned. Optimization
noted for implementation: reserve the counter with `nextval()` first and write a single `INSERT`.

## Resolution — a thin edge layer

Roughly forty services pass `userId` around (`ride-operations.service.ts`, `chat.service.ts`,
`admin.service.ts`, `search-ride.service.ts`, …). None of them change. Translation happens only at
the boundary.

```txt
INBOUND
  DLV-U-3K7QM94ZP2XR  -> resolveUserPublicId -> internal UUID -> existing controller / service
  a raw UUID          -> passes straight through        (every existing client keeps working)

  format detection:  /^DLV-U-[0-9A-HJKMNP-TV-Z]{13}$/   vs   UUID regex

OUTBOUND
  service returns internal UUID -> serializer attaches publicId -> response

  list case, no N+1:
    findMany({ where: { userId: { in: ids } }, select: { userId: true, publicId: true } })

CACHE  (src/cache/redis.ts) — the mapping is immutable, so long TTL and no invalidation problem
  uid:pub:<publicId>  -> uuid
  uid:int:<uuid>      -> publicId
```

- The edge layer only **adds**: one accepted input format, one response field. Nothing existing is
  rewritten, which is what makes the rollout non-breaking.
- Resolution is always a table or cache lookup, never a decryption. The table stays the single
  source of truth, so key rotation cannot orphan an existing ID.
- Responses carry `publicId` alongside today's `id`. The frontend switches to `publicId`; removing
  `id` from responses is a later, separate decision (phase 6 below), not part of this change.
- JWT `sub` keeps the internal UUID. Changing it would invalidate every live token, and
  non-breaking is the binding constraint here. Residual leak recorded as an open item: a JWT
  payload is base64, so `sub` is readable by any client. Worth addressing in a future token
  version, not a blocker for this design.

Affected boundary surfaces, for the implementer's map: `src/modules/user/user.routes.ts:42-47`
(`/:userId/profile`, `/report`, `/block`), `src/modules/admin/admin.routes.ts:27` and `:74-84`
(admin lookup, DL verification), and the socket payloads in `src/socket/index.ts` that carry
`senderId` / `receiverId`.

## Rollout Phases

1. Migration creates `UserPublicId`. New table only — no `ALTER TABLE "User"`.
2. Mint on signup; lazy `ensureUserPublicId` on profile read, so pre-existing users self-heal.
3. Backfill script under `src/scripts/`: batched, idempotent, safe to re-run — the unique `userId`
   makes a re-run a no-op.
4. Verify (both must return 0):

   ```sql
   SELECT count(*) FROM "User" u
     LEFT JOIN "UserPublicId" p ON p."userId" = u.id
    WHERE p.id IS NULL;

   SELECT count(*) - count(DISTINCT "publicId") FROM "UserPublicId";
   ```

5. Frontend reads `publicId`; support tooling and admin lookup accept it.
6. Later, separately: drop `id` from API responses once no client reads it.
7. Optional, later: the same primitive replaces the UUID-derived booking reference and the 32-bit
   referral code, via entity tags `B` and `R`.

**Environment note.** `npm run prisma:migrate:dev` currently fails on shadow-database replay in
this repo. Dev applies schema changes with `prisma db push`; the deploy path needs a hand-written
migration file under `prisma/migrations/`.

## Security Analysis

- **Enumeration.** Output is a keyed permutation, so guessing a live ID is 5.4e-13 per attempt at
  10M users, before rate limiting. Resistance depends on the key, not on randomness — see the key
  management section, including the random-tail mitigation.
- **No ordering or count leak.** The timestamp is an *input*, not a prefix. Feistel output is
  uncorrelated with input ordering, so IDs are not sortable by signup time and reveal nothing
  about how many users exist. This is the specific reason a sortable ULID / UUIDv7 was rejected
  for the public surface — both expose creation time by design — and why the original `SERIAL`
  primary key (`prisma/migrations/20260131131629_init/migration.sql:3`) was wrong to expose.
- **Not a credential.** A public ID identifies; it does not authorize. All existing `protect` and
  ownership checks stay exactly as they are. Treating it as a bearer value would be a bug.
- **Safe to log.** Unlike email or phone, a public ID can appear in logs, error payloads, and
  support tickets without leaking PII.

## Failure Modes

| Scenario | Expected behavior |
| --- | --- |
| Two concurrent mints for one user | `userId @unique` rejects the loser; it reads the winning row and returns the same ID |
| `publicId` unique violation | Impossible under a bijection. Treat as a key/algorithm defect: alert, fail loudly, never silently retry |
| `PUBLIC_ID_KEY` missing at boot | Fail fast at startup. Minting without it would produce IDs from an unknown key space |
| Key rotated | Existing IDs keep resolving — resolution is a lookup, not a decryption. New rows record the new `algoVersion` |
| Backfill interrupted | Harmless; the lazy `ensure` path fills the remainder on read, and re-running the script is a no-op |
| Client sends lowercase or hyphen-variant | Normalize (uppercase, strip separators) before the cache key and the query |
| Cache holds a mapping for a deleted user | Cascade delete removes the row; the stale cache entry expires by TTL and resolves to 404 |
| Valid format, unknown ID | 404, not 500 |

## Trade-offs Considered

| Option | Collision guarantee | Enumeration resistance | Cost |
| --- | --- | --- | --- |
| **Encrypted sequence + timestamp in a mapping table (chosen)** | Impossible — bijection over a unique spine | Strong, key-dependent | One key to protect; one join (cached) |
| 10 random symbols + unique index and retry | Probabilistic, 8.9e-9 per insert | Strong, no key needed | Retry loop; slightly weaker guarantee |
| `publicId` column on `User` | Same as chosen | Same as chosen | Touches the hot core table; widens every existing `select` |
| Replace the primary key with UUIDv7 / ULID | Strong | **Weak — leaks signup time and order** | Migration across 39 models and every FK |
| Plain base62 of the counter (Hashids / Sqids style) | Impossible | **None — trivially enumerable** | Cheapest, and unusable for a public surface |
| Hash the UUID (SHA-256, truncated) | **Probabilistic — birthday collisions** | Strong | Not injective; truncation defeats the purpose |

## Findings Recorded For Later

- `formatBookingReference` (`src/utils/booking-reference.ts:3`) publishes 6 characters of the
  booking primary key and performs no uniqueness check. Should move onto this primitive with tag `B`.
- `generateReferralCode` (`src/modules/rewards/rewards.service.ts:33`) carries only 32 bits on an
  abuse-sensitive surface.
- `@@index([id])` on `User` is redundant; a primary key is already indexed.

## Open Questions

1. Is `publicId` visible to *other* users (driver ↔ passenger profile), or self-and-support only?
2. 13 symbols, or 15 with the random tail for key-leak resilience?
3. Do referral links move to `publicId`, or keep a separate code?
4. When can `id` leave API responses — which client releases still read it?

## If This Is Approved For Implementation

Per `CLAUDE.md`, a feature is complete only with both levels of test:

- **Unit** (`src/utils/id/public-id.test.ts`): bijectivity over a large sample, alphabet contains
  no ambiguous characters, exact length, idempotent `ensure`, race-loser path, `algoVersion`
  handling, correct behavior with a rotated key.
- **E2E** (`tests/e2e/specs/`): signup returns a `publicId`; the ID resolves on a profile fetch;
  a raw UUID still resolves (non-breaking); an unknown but well-formed ID returns 404.
