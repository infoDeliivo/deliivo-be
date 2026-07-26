# Amazon SES — DNS setup for `deliivo.com`

Hand this to whoever manages DNS for `deliivo.com`. Nothing here is a repo change; all
records live in the domain's DNS zone.

**AWS account:** `826696545186` — **SES region:** `eu-central-1` (Europe / Frankfurt)

## Why it is needed

SES currently refuses to send as `noreply@deliivo.com` because the domain identity
`deliivo.com` is in state `FAILED` (DKIM records absent). Until DKIM verifies:

- Only `info@deliivo.com` — a standalone verified email identity — can be used as the sender.
- The **Request production access** button in the SES console stays disabled
  ("Domain verification needed"), so the account cannot leave the sandbox.

## Required records — DKIM (3 × CNAME)

Zone-file form:

```dns
xbywbzipdo5tqbigeii7fjihf6gtybut._domainkey.deliivo.com. 300 IN CNAME xbywbzipdo5tqbigeii7fjihf6gtybut.dkim.amazonses.com.
7n7666pa7fsciujhovzpbqxepni2gl6s._domainkey.deliivo.com. 300 IN CNAME 7n7666pa7fsciujhovzpbqxepni2gl6s.dkim.amazonses.com.
a2bqr4boxuytrtwew5rb44zqzluv6ww6._domainkey.deliivo.com. 300 IN CNAME a2bqr4boxuytrtwew5rb44zqzluv6ww6.dkim.amazonses.com.
```

Control-panel form:

| Type  | Host / Name                                        | Value / Points to                                             | TTL |
| ----- | -------------------------------------------------- | ------------------------------------------------------------- | --- |
| CNAME | `xbywbzipdo5tqbigeii7fjihf6gtybut._domainkey`       | `xbywbzipdo5tqbigeii7fjihf6gtybut.dkim.amazonses.com`          | 300 |
| CNAME | `7n7666pa7fsciujhovzpbqxepni2gl6s._domainkey`       | `7n7666pa7fsciujhovzpbqxepni2gl6s.dkim.amazonses.com`          | 300 |
| CNAME | `a2bqr4boxuytrtwew5rb44zqzluv6ww6._domainkey`       | `a2bqr4boxuytrtwew5rb44zqzluv6ww6.dkim.amazonses.com`          | 300 |

Two mistakes that reproduce the current `FAILED` state:

- Typing the full `..._domainkey.deliivo.com` into a Host field that already appends the
  domain, producing `..._domainkey.deliivo.com.deliivo.com`.
- Quoting the value or creating it as TXT. These are CNAME records, unquoted.

## Recommended alongside (deliverability, not verification)

```dns
deliivo.com.        300 IN TXT "v=spf1 include:amazonses.com ~all"
_dmarc.deliivo.com. 300 IN TXT "v=DMARC1; p=none; rua=mailto:info@deliivo.com"
```

If `deliivo.com` already has an SPF record, merge `include:amazonses.com` into the
existing one — a domain must not have two `v=spf1` records.

## After the records are live

1. SES console → **Get set up** → *Verify sending domain* → **Retry**. SES stops
   re-checking on its own once an identity has failed, so the manual retry matters.
2. Wait for DKIM status `SUCCESS` (minutes to a few hours, depending on TTL/propagation).
3. **Request production access** unlocks. Submit it as: mail type *Transactional*;
   use case = signup/login OTP codes and booking notifications for a carpooling app;
   recipients enter their own addresses; bounces and complaints handled via SES
   notifications; no purchased lists.
4. Only then change `.env`:

   ```bash
   MAIL_FROM="Deliivo <noreply@deliivo.com>"
   ```

   No other code change — `src/config/mailer.ts` reads the sender from `MAIL_FROM`.

## Verifying from the CLI

```bash
dig +short xbywbzipdo5tqbigeii7fjihf6gtybut._domainkey.deliivo.com CNAME
# expect: xbywbzipdo5tqbigeii7fjihf6gtybut.dkim.amazonses.com.
```

## Current state (checked 2026-07-27)

| Item                          | State                                               |
| ----------------------------- | --------------------------------------------------- |
| IAM user                      | `arn:aws:iam::826696545186:user/deliivo`, SES policy attached |
| Sandbox                       | Yes — 200 emails/24h, 1 email/sec, health `HEALTHY`  |
| `info@deliivo.com` (email)    | Verified, sends OK (live send confirmed)             |
| `deliivo.com` (domain)        | `FAILED` — DKIM records not published                |
| `MAIL_FROM`                   | `Deliivo <info@deliivo.com>` (interim)               |

While in the sandbox every **recipient** must also be a verified identity. To test a real
inbox before production access lands: SES → Identities → Create identity → Email address →
enter it → the owner clicks the confirmation link AWS sends.
