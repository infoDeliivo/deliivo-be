# Amazon SNS as the SMS backend

The SMS module resolves its backend at boot from `SMS_PROVIDER`
(`src/modules/sms/providers/index.ts`). `sns` is now a third option alongside
`twilio` and `messente`. Queueing, abuse gating, mock mode, and retry behaviour
are unchanged — a provider only performs the send.

## Enable it

```bash
SMS_PROVIDER=sns
SNS_REGION=eu-central-1        # falls back to AWS_REGION when unset
SNS_SMS_TYPE=Transactional     # Transactional (OTP) | Promotional
SNS_SENDER_ID=                 # optional, 1-11 alphanumeric, must start with a letter
```

Credentials resolve through the AWS SDK default chain — the same
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` that SES uses. No SNS-specific
credential vars.

Restart the `sms-worker` process after changing these; the provider is selected
once at boot (`src/modules/sms/sms.worker.ts`).

## IAM permission required

Attach to the sending user (`arn:aws:iam::826696545186:user/deliivo`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["sns:Publish", "sns:GetSMSAttributes", "sns:SetSMSAttributes"],
    "Resource": "*"
  }]
}
```

`sns:Publish` on `"*"` is required for SMS: direct-to-phone publishing has no
topic ARN to scope against. `GetSMSAttributes` is only needed for reading the
account's spend limit and sandbox state.

## SNS SMS sandbox

New accounts start in the **SMS sandbox**, which is separate from the SES
sandbox and has its own allowlist: destination numbers must be registered and
confirmed with a one-time code before `Publish` will deliver to them. Console →
Amazon SNS → Mobile → **Text messaging (SMS)** → Sandbox destination phone
numbers → Add. Leaving the SMS sandbox is a separate support request from the
SES one.

Also on that page: **Account spend limit** (default 1.00 USD/month — raise it
before any real traffic) and the default sender ID / SMS type.

## Sender ID caveats

`SNS_SENDER_ID` is honoured only where carriers support alphanumeric sender IDs
(most of Europe, India after DLT registration). In the US and Canada SNS ignores
it and substitutes a number it owns. Setting it is harmless elsewhere.

## Notes vs Twilio

- No delivery-status callback equivalent to `TWILIO_STATUS_CALLBACK_URL`. SNS
  delivery status goes to CloudWatch Logs and must be enabled per account
  (Mobile → Text messaging → Delivery status logging, needs an IAM role).
- `Publish` returns a `MessageId` and nothing else; there is no per-message
  status field, so the provider reports `status: 'sent'` on acceptance.
- Twilio's `messages.create` validates the sender number up front; SNS does not
  fail early on an unsupported destination country — it accepts and drops.

## Verification status (2026-07-27)

Unit tests pass (`npx jest src/modules/sms` — 20 tests, includes 8 for the SNS
provider). A live publish has **not** been proven: the IAM user currently lacks
SNS rights, so the call returns

```
AuthorizationErrorException - User: arn:aws:iam::826696545186:user/deliivo is not
authorized to perform: SNS:GetSMSAttributes ... no identity-based policy allows
```

Attach the policy above, then re-run the live check.
