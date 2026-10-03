# Deliivo Email Templates — UX Spec

## Purpose

This file describes how every Deliivo transactional email should look and read before any HTML is written. It is the source of truth for layout, copy, and colors. The code in `mail.templates.ts` should be rebuilt to match this spec.

Current state: the templates in `mail.templates.ts` are plain Arial HTML with no branding. This spec brings them in line with the webapp theme.

---

## 1. Brand theme

Colors are mirrored from `deliivo-webapp/src/app/globals.css` (Tailwind v4 `@theme`). Email clients do not support CSS variables, so templates must use these hex values inline.

| Name          | Hex       | Webapp token                      | Used for                                  |
|---------------|-----------|-----------------------------------|-------------------------------------------|
| Orange        | `#f97316` | `deliivo-orange` / `primary-500`  | Top bar, CTA button, OTP digits            |
| Orange dark   | `#ea580c` | `deliivo-orange-dark` / `primary-600` | OTP box border, links                  |
| Orange light  | `#fff7ed` | `deliivo-orange-light` / `primary-50` | OTP box background, info panels        |
| Cream         | `#fff8f0` | `deliivo-cream`                   | Outer email background                     |
| Dark          | `#1a1a2e` | `deliivo-dark`                    | Headings, body text                        |
| Gray          | `#6b7280` | `deliivo-gray`                    | Helper text, footer                        |
| White         | `#ffffff` | —                                 | Content card, button text                  |

**Font:** `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`.
Most email clients do not load Inter, so the system fonts are the real fallback.

**Type scale:**

| Element      | Size  | Weight | Color  |
|--------------|-------|--------|--------|
| Heading      | 22px  | 700    | Dark   |
| Body         | 15px  | 400    | Dark   |
| OTP digits   | 32px  | 700    | Orange, letter-spacing 8px |
| Helper note  | 13px  | 400    | Gray   |
| Footer       | 12px  | 400    | Gray   |

**Shape:** the card has 16px corner radius. The button is fully rounded (pill), which matches `btn-primary` in the webapp. The OTP box has 12px radius.

---

## 2. Shared layout

Every email uses the same skeleton, from top to bottom:

```
┌──────────────────────────────────────────┐  ← Cream background (#fff8f0)
│  [hidden preheader text]                 │
│                                          │
│   ┌──────────────────────────────────┐   │
│   │████████ orange bar 6px ██████████│   │  ← #f97316
│   │                                  │   │
│   │   DELIIVO  (logo / wordmark)     │   │
│   │                                  │   │
│   │   Heading                        │   │  ← White card
│   │   Body copy, 1–2 short lines     │   │
│   │                                  │   │
│   │   ┌──────────────────────────┐   │   │
│   │   │   MAIN ELEMENT           │   │   │  ← OTP box or CTA button
│   │   └──────────────────────────┘   │   │
│   │                                  │   │
│   │   Helper / security note (gray)  │   │
│   └──────────────────────────────────┘   │
│                                          │
│   Footer: support · why you got this     │  ← Gray, centered
│   © Deliivo                              │
└──────────────────────────────────────────┘
```

**Layout rules**

- Max width 600px, centered. On mobile the card fills the width with 16px side padding.
- Card inner padding: 32px on desktop, 24px on mobile.
- Exactly one primary action per email (one OTP or one button).
- Copy is short: heading plus at most two body sentences.
- Preheader is always set. It shows in the inbox preview next to the subject.
- No images other than the logo. The email must still read correctly with images blocked.

**Two main elements**

1. **OTP box:** orange-light background, 1px orange-dark border, 12px radius. Code centered in large orange digits. Below it, gray expiry text: "Expires in 5 minutes."
2. **CTA button:** orange background, white text, 15px, weight 600. Pill shape, padding 14px × 32px. Built as a bulletproof table button so it works in Outlook.

---

## 3. Templates

All OTPs are currently valid for **5 minutes** (from `mail.templates.ts`).

### 3.1 Signup OTP — `signupOtpTemplate(otp)`

| Field          | Content |
|----------------|---------|
| When sent      | User starts sign-up with an email address |
| Subject        | Verify your email for Deliivo |
| Preheader      | Your code is {{otp}}. It expires in 5 minutes. |
| Heading        | Verify your email |
| Body           | Enter this code in Deliivo to finish creating your account. |
| Main element   | OTP box with `{{otp}}` |
| Helper note    | Expires in 5 minutes. Never share this code with anyone. |
| Variables      | `otp` |

### 3.2 Login / sign-in OTP — `loginOtpTemplate(otp)`

| Field          | Content |
|----------------|---------|
| When sent      | User signs in with an email address |
| Subject        | Your Deliivo sign-in code |
| Preheader      | Use {{otp}} to sign in. It expires in 5 minutes. |
| Heading        | Your sign-in code |
| Body           | Enter this code to sign in to your Deliivo account. |
| Main element   | OTP box with `{{otp}}` |
| Helper note    | Expires in 5 minutes. If you did not try to sign in, ignore this email. Your account is safe. |
| Variables      | `otp` |

### 3.3 Reset password OTP — `resetOtpTemplate(otp)`

| Field          | Content |
|----------------|---------|
| When sent      | User taps "Forgot password" |
| Subject        | Reset your Deliivo password |
| Preheader      | Your reset code is {{otp}}. It expires in 5 minutes. |
| Heading        | Reset your password |
| Body           | We received a request to reset your password. Enter this code to choose a new one. |
| Main element   | OTP box with `{{otp}}` |
| Helper note    | Expires in 5 minutes. If you did not request a reset, ignore this email. Your password does not change. |
| Variables      | `otp` |

### 3.4 Password changed — *new, no function yet*

| Field          | Content |
|----------------|---------|
| When sent      | Right after a password reset or change succeeds |
| Subject        | Your Deliivo password was changed |
| Preheader      | If this was you, no action is needed. |
| Heading        | Password changed |
| Body           | The password for your Deliivo account was changed on {{changedAt}}. |
| Main element   | None, or an outline "Contact support" link. This is a security notice, not a call to action. |
| Helper note    | Not you? Contact {{supportEmail}} right away. |
| Variables      | `changedAt`, `supportEmail` |

### 3.5 Contact verify OTP — `contactVerifyOtpTemplate(otp)`

| Field          | Content |
|----------------|---------|
| When sent      | User adds an email address to their profile |
| Subject        | Verify your email |
| Preheader      | Your code is {{otp}}. It expires in 5 minutes. |
| Heading        | Confirm this email address |
| Body           | Enter this code to add this email address to your Deliivo account. |
| Main element   | OTP box with `{{otp}}` |
| Helper note    | Expires in 5 minutes. If you did not request this, ignore this email. |
| Variables      | `otp` |

### 3.6 Verification success — `otpSuccessTemplate(purpose)`

| Field          | Content |
|----------------|---------|
| When sent      | OTP verified for login or signup |
| Subject        | `login`: New sign-in to Deliivo · `signup`: Your email is verified |
| Preheader      | `login`: You signed in just now. · `signup`: You're all set. |
| Heading        | `login`: New sign-in · `signup`: Email verified |
| Body           | `login`: You signed in to your Deliivo account. · `signup`: Your email is confirmed. |
| Main element   | None (confirmation only) |
| Helper note    | Not you? Contact {{supportEmail}} right away. |
| Variables      | `purpose: 'login' \| 'signup'` |

### 3.7 Welcome — `signupWelcomeTemplate(name?)`

| Field          | Content |
|----------------|---------|
| When sent      | Account created |
| Subject        | Welcome to Deliivo |
| Preheader      | Your account is ready. Finish your profile to get started. |
| Heading        | Welcome, {{name}}! (fallback: "Welcome to Deliivo!") |
| Body           | Your account is ready. Complete your profile to book your first ride or start driving. |
| Main element   | CTA button "Open Deliivo" linking to `{{appUrl}}` |
| Helper note    | Questions? Reply to this email or contact {{supportEmail}}. |
| Variables      | `name` (optional), `appUrl`, `supportEmail` |

---

## 4. Accessibility and email-client notes

- **Contrast:** orange `#f97316` on white is about 2.8:1, which fails WCAG for small text. Use orange only for large text (OTP digits) and for the button background with white bold text. Body text is always Dark.
- **Logo:** always set `alt="Deliivo"`, plus a text wordmark fallback.
- **Styles:** inline only. Use table layout, no flexbox or grid. No `<style>` dependence except optional media queries.
- **OTP:** render as plain text so users can copy it. No image.
- **Dark mode:** some clients (Gmail app, Outlook) invert colors. Keep the orange bar and the button solid so they survive inversion. Test in Apple Mail dark mode.
- **Plain-text version:** send a `text` part with every email (`SendMailPayload.text`). It should contain the same heading, code, and note.

---

## 5. Open questions

- **Logo:** which logo asset to use, and whether to host it or inline it as base64. A scratch version exists in `deliivo-be/.tmp/logo.b64`.
- **Support email:** which address to show in `{{supportEmail}}`.
- **Languages:** the site ships in `en`, `et`, `lv`, `lt`, `ru` (`src/utils/locale.ts`). Decide whether emails get translated copy.
- **Password changed:** this email is new, so it needs a trigger in the auth flow.
- **App URL:** confirm the value for `{{appUrl}}` (web link or app deep link).
