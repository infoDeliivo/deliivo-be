# Driver Verification — Poparide vs Deliivo

Status: **Analysis. Comparison of Poparide's driver-verification model against Deliivo's current publish-ride gating.**

Question that prompted this: does the ride service verify **driver's license** to publish a ride, but **not vehicle** and **not identity**?

---

## 1. Poparide (reference — poparide.com)

What Poparide verifies before a member can **book or post** a ride:

| Item | Verified? | How |
|---|---|---|
| Driver's license | **Yes** | Front/back photo + biometric check (valid & not expired). **Mandatory before posting a trip since June 1, 2024.** Regular license fine — no class 4 required. Re-verify if license expires or account recreated. |
| Identity | **Yes** | Multi-factor: **email + phone + credit card / bank account**, plus driver's license for drivers. This combined set is their identity check. |
| Vehicle | **No** | Driver enters car info; no registration / ownership / plate verification documented. |

So Poparide: **DL verified, identity verified, vehicle NOT verified.**

---

## 2. Deliivo (current code)

Publish gating in `src/modules/publish-ride/draft-ride.service.ts` (`publishRide()`):

| Item | Verified? | Where |
|---|---|---|
| ToS accepted | **Yes** — required | `:1433` → `TOS_NOT_ACCEPTED` |
| Driver's license | **Yes** — required | `:1437-1440` → `DRIVER_NOT_VERIFIED` (Veriff sets `user.dlVerified`, `dl-verification.service.ts:206-210`; doc type `DRIVERS_LICENSE`, `:83`). Skippable via `SKIP_DL_VERIFICATION=true`. |
| Vehicle exists | **Yes** — required | `:1462-1468` → `VEHICLE_REQUIRED` |
| Vehicle **verified** | **No** | `:1469-1471` — `isVerified` check **commented out** (field exists `schema.prisma:176`). Vehicle must *exist*, never *verified*. |
| Identity | **No** | No identity gate. Veriff = license only, not identity/passport. |
| Email / phone verified | **No** | Flags exist on User but not enforced at publish. |

So Deliivo: **DL verified, vehicle NOT verified (only existence), identity NOT verified.**

---

## 3. Side-by-side

| Verification | Poparide | Deliivo (current) |
|---|---|---|
| Driver's license | ✅ Verified (biometric) | ✅ Verified (Veriff `dlVerified`) |
| Identity (email + phone + payment) | ✅ Verified | ❌ Not gated at publish |
| Vehicle | ❌ Not verified | ❌ Not verified (check commented out) |

---

## 4. Gaps vs Poparide

1. **Identity not gated.** Poparide requires verified email + phone + payment method before publish/book. Deliivo has `emailVerified` / `phoneVerified` fields but does not enforce them at publish. No payment-method identity check.
2. **Vehicle unverified (both platforms).** Neither verifies registration/ownership. Deliivo already has the `vehicle.isVerified` field and a dead check — closest to enabling if we want to exceed Poparide here.

## 5. Options (not implemented)

- **Match Poparide:** enforce `phoneVerified` + `emailVerified` (and optionally a saved payment method) at publish, alongside existing `dlVerified`.
- **Exceed Poparide:** enable the commented-out `vehicle.isVerified` gate (`draft-ride.service.ts:1469-1471`) + a vehicle-document verification flow.
- **Document-only:** keep current gating, record the accepted risk.

---

## Sources (Poparide)

- Driver's license verification — https://support.poparide.com/en/articles/9704781-how-to-get-your-driver-s-license-verification
- Set up your profile — https://support.poparide.com/en/articles/9704546-how-to-set-up-your-profile
- Safety — https://www.poparide.com/en-ca/safety
- Class 4 license (BC) — https://support.poparide.com/en/articles/9704848-do-i-need-a-class-4-license-to-drive-on-poparide-in-british-columbia
