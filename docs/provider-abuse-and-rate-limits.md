# Provider Abuse & Rate-Limit Handling (Email / SMS)

Status: **Implemented** (backend abuse layers + provider abstraction). CAPTCHA (§4e / P3) deferred — needs a frontend token + external account.

Implemented in: layered OTP limiter `src/middlewares/rateLimit.ts` (`otpLimiters`, applied in `src/app.ts` incl. signup/login + `trust proxy`); SMS abuse gate `src/modules/sms/sms.abuse.ts` (country allowlist + per-phone daily cap + daily/monthly spend circuit breaker with one-shot admin email alert), wired into `src/modules/sms/sms.service.ts`; worker throughput limiters on `sms.worker.ts` / `mail.worker.ts`; provider abstraction `src/modules/sms/providers/` (Twilio + Messente) and `src/config/mailer.ts` (SMTP + SES). Config/env in `src/modules/sms/sms.config.ts`, `src/modules/mail/mail.config.ts`, `.env.example`. Tests: `sms.abuse.test.ts`, `rateLimit.test.ts`, `providers/index.test.ts`, e2e `tests/e2e/specs/33-otp-abuse.e2e.test.ts`.

Context: provider evaluation in `Email & SMS Service Cost Comparison.pdf`
- Email: SMTP (Nodemailer) → **Amazon SES**
- SMS: **Twilio → Messente** (Estonia, ~€0.05/SMS, "Deliivo" sender)

This document answers: **how do the providers themselves handle bot attacks and rate limits**, where they fall short, and what we must build on top.

---

## 1. Summary & threat model

Cost model (from the comparison):

| Channel | Provider | ~Monthly cost @ example volume |
|---|---|---|
| Email | Amazon SES | ~$1 (10k emails) |
| SMS | Messente | ~€250 (5k SMS) |

**SMS is the abuse target.** Email bot-spam is near-free ($0.10/1000). Each SMS costs real money, so the attack that matters is:

> A bot repeatedly hits the request-OTP endpoints (signup / login / password-reset), forcing us to send SMS. This is **SMS pumping / toll fraud** — every send costs €0.05, and fraudsters route sends toward premium/rare country codes they profit from. Result: money burned + carrier/sender-ID reputation damage.

OTP send is triggered in `src/modules/auth/auth.controller.ts`:
- signup `:124`, requestOtp `:184`, login `:305`, reset `:378`.

---

## 2. Provider-native capabilities (what each does on its own)

| Concern | Amazon SES (email) | Messente (SMS) | For reference |
|---|---|---|---|
| **Rate limit** | Per-account max send rate (per second) + 24h sending quota. Over the ceiling → `Throttling` error. | Per-second API throughput cap. | Twilio: per-number / messaging-service throughput. |
| **Abuse / bot** | Reputation dashboard auto-pauses account on high bounce/complaint rate; suppression list. Email abuse is low-cost, so limited exposure. | Sender-ID registration ("Deliivo"); destination-country restriction via support. **No built-in fraud-guard / anti-pumping.** | Twilio Verify: **Fraud Guard + SMS-pumping protection + geo-permissions**. Amazon SNS: native **monthly SMS spend cap**. |

### ⚠️ Critical callout
Today we run **Twilio**, which — via Verify — ships **Fraud Guard + SMS-pumping protection**. **Moving Twilio → Messente removes that layer.** Messente has no equivalent. So the anti-abuse protection that was previously the provider's job becomes **our** job. This must land **before** the switch, not after.

Providers alone will **not** stop OTP-pumping on Messente.

---

## 3. Gap analysis (what providers won't cover → we own)

1. **`otpLimiter` number-rotation bypass** — `src/middlewares/rateLimit.ts:63`:
   ```ts
   keyGenerator: (req) => (req.body?.identifier || req.body?.phone || req.body?.email || ipKeyGenerator(...))
   ```
   Fallback-OR keying means the limiter keys on the identifier when present. A bot that **rotates phone numbers** gets a fresh 5-per-15-min bucket for every new number → the limit is trivially bypassed for the exact attack we care about.

2. **No global SMS spend circuit breaker** — nothing caps total sends/cost. A sustained flood runs until someone notices the bill.

3. **No destination geo allowlist** — OTP can be sent to any country code, including the expensive/rare codes pumping fraud targets. Our real audience is Estonia + a known set.

4. **No per-second worker throughput cap** — mail worker (concurrency 1) and SMS worker (`SMS_WORKER_CONCURRENCY`, default 5) have **no BullMQ `limiter`**. We rely only on `SMS_RETRY_ATTEMPTS` (3, exponential) to absorb provider `Throttling`. Reactive, not preventive.

Coupling points for any change:
- SMS send: `src/modules/sms/sms.worker.ts:26-29,79-96` + direct fallback `src/modules/sms/sms.service.ts:104-127`; config `src/modules/sms/sms.config.ts`.
- Email send: single seam `src/config/mailer.ts`; worker `src/modules/mail/mail.worker.ts`.

---

## 4. Recommended handling (app-side defense layers)

Each layer: **what / why / where.**

### a. Layered rate limit (closes the rotation hole)
- **What:** enforce per-identifier **AND** per-IP **AND** per-subnet limits *simultaneously* (not fallback-OR). All three must pass.
- **Why:** rotating phone numbers no longer helps — the IP/subnet bucket still trips.
- **Where:** `src/middlewares/rateLimit.ts` (`otpLimiter`). Compose multiple limiters or run several `RedisStore` counters per request.

### b. Global SMS spend cap (cost circuit breaker)
- **What:** Redis daily + monthly counter of SMS sent. When cap reached, stop sending and raise an alert.
- **Why:** hard ceiling on worst-case bot damage — mirrors Amazon SNS's native monthly spend limit that Messente lacks.
- **Where:** producer `src/modules/sms/sms.service.ts`, checked before enqueue (and in the direct fallback path).

### c. Per-phone daily cap
- **What:** Redis counter, e.g. ≤5 OTP per phone number per rolling day — independent of the 15-min window.
- **Why:** stops slow-drip abuse against a single number that stays under the short-window limiter.
- **Where:** `src/modules/sms/sms.service.ts`.

### d. Geo allowlist
- **What:** restrict OTP destinations to expected country codes (Estonia + allowed set); reject high-risk/premium codes.
- **Why:** removes the fraud payout vector — pumping is unprofitable if we won't send to the target codes.
- **Where:** `src/modules/sms/sms.service.ts` validation (alongside existing E.164 check).

### e. CAPTCHA / attestation (optional, larger lift)
- **What:** bot challenge on OTP request — Cloudflare Turnstile / reCAPTCHA, or mobile device attestation (Play Integrity / App Attest).
- **Why:** strongest deterrent; stops automated abuse at the door before any send.
- **Where:** OTP request handlers in `auth.controller.ts` + frontend. Bigger change — reserve for if abuse persists after a–d.

### f. Worker throughput limiter
- **What:** BullMQ `limiter: { max, duration }` on the mail and SMS workers so send rate never exceeds the provider per-second ceiling.
- **Why:** prevents `Throttling` errors preventively instead of retrying after the fact. Keep existing exponential backoff as backstop.
- **Where:** `src/modules/sms/sms.worker.ts` Worker options; `src/modules/mail/mail.worker.ts` Worker options.

---

## 5. Provider abstraction (makes the swap clean)

Introduce a provider selector so vendor swaps don't touch producers/queues:
- `SMS_PROVIDER=twilio|messente`, `MAIL_PROVIDER=smtp|ses`.
- Wrap sending behind a small interface, e.g. `send(to, body): Promise<{ id, status }>`, with `twilio` / `messente` implementations selected at boot.
- SMS coupling to remove: hardcoded `import twilio` in `sms.worker.ts` and `sms.service.ts`.
- Email: `mailer.ts` is already a single seam — SES fits via Nodemailer's SES transport with **zero** changes to worker/service.

---

## 6. Config / env additions (proposed)

```
# provider selection
SMS_PROVIDER=twilio            # twilio | messente
MAIL_PROVIDER=smtp             # smtp | ses
# messente / ses credentials … (added with the integration)

# abuse / cost controls
SMS_DAILY_SPEND_CAP=           # hard daily SMS count/cost ceiling
SMS_MONTHLY_SPEND_CAP=
SMS_PER_PHONE_DAILY_MAX=5
SMS_ALLOWED_COUNTRY_CODES=372  # comma-separated E.164 country codes

# throughput limiters (BullMQ limiter)
SMS_LIMITER_MAX=
SMS_LIMITER_DURATION=
MAIL_LIMITER_MAX=
MAIL_LIMITER_DURATION=
```

---

## 7. Rollout phases

| Phase | Scope | Rationale |
|---|---|---|
| **P1 — before the switch** | Layered rate limit (a) + global spend cap (b) + geo allowlist (d) | Cheap, high-impact. Replaces the Twilio Fraud Guard protection we lose on Messente. |
| **P2** | Provider abstraction (5) + Messente/SES integration + per-phone cap (c) + worker limiters (f) | The actual migration + preventive throughput control. |
| **P3** | CAPTCHA / attestation (e) | Only if automated abuse persists after P1–P2. |

---

## Appendix — current state (as of writing)

- SMS: Twilio only. Worker concurrency `SMS_WORKER_CONCURRENCY` (default 5), retry `SMS_RETRY_ATTEMPTS` (3, exponential `SMS_RETRY_BACKOFF_MS`). No BullMQ limiter.
- Email: Nodemailer/SMTP, single transport `src/config/mailer.ts`. Worker concurrency default 1. No BullMQ limiter.
- Rate limiting: HTTP-layer only (`express-rate-limit` + Redis store). `otpLimiter` = 5 / 15 min, keyed identifier-or-IP (see gap #1). No queue-level or spend-level controls.
