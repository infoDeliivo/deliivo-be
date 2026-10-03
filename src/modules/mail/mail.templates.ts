// Branded email templates. Layout, copy, and colors follow EMAIL_TEMPLATES_UX.md.
// Email clients ignore CSS variables and most <style> rules, so everything is inline and table-based.

// Mirrored from deliivo-webapp/src/app/globals.css.
const colors = {
  orange: '#f97316',
  orangeDark: '#ea580c',
  orangeLight: '#fff7ed',
  cream: '#fff8f0',
  dark: '#1a1a2e',
  gray: '#6b7280',
  white: '#ffffff',
  text: '#374151',
  border: '#f3e8dc',
  divider: '#f3f4f6',
  orangeBorder: '#fed7aa', // primary-200
  orangeText: '#c2410c', // primary-700, readable on orangeLight
} as const;

const fontStack = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const OTP_EXPIRY_MINUTES = 5;

// Read at send time, not import time, so env changes (and tests) take effect.
const mailLogoUrl = () => process.env.MAIL_LOGO_URL || 'https://deliivo.com/logo.png';
const supportEmailAddress = () => process.env.SUPPORT_EMAIL || 'support@deliivo.com';
// Same fallback chain as buildAppUrl in ride-operations.service.ts.
const appBaseUrl = () => process.env.APP_BASE_URL || process.env.WEB_APP_URL || 'http://localhost:3000';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type LayoutOptions = {
  preheader: string;
  heading: string;
  body: string;
  // Short label above the heading that says why this email was sent, e.g. "Sign up".
  purpose?: string;
  main?: string;
  note?: string;
};

const emailLayout = ({ preheader, heading, body, purpose, main = '', note = '' }: LayoutOptions) => {
  const siteUrl = appBaseUrl().replace(/\/$/, '');
  const footerLink = (label: string, href: string) =>
    `<a href="${escapeHtml(href)}" target="_blank" style="color: ${colors.gray}; text-decoration: underline">${label}</a>`;

  // No <title>: some webmail clients render it as visible text above the email.
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <style>
      @media only screen and (max-width: 600px) {
        .email-outer { padding: 0 !important; }
        .email-card { border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
        .email-px { padding-left: 20px !important; padding-right: 20px !important; }
        .email-heading { font-size: 22px !important; }
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${colors.cream}">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${colors.cream}">
      <tr>
        <td align="center" class="email-outer" style="padding: 40px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-card" style="max-width: 560px; background-color: ${colors.white}; border: 1px solid ${colors.border}; border-radius: 16px; overflow: hidden">
            <tr>
              <td style="height: 4px; line-height: 4px; font-size: 0; background-color: ${colors.orange}">&nbsp;</td>
            </tr>
            <tr>
              <td class="email-px" style="padding: 28px 40px 24px; border-bottom: 1px solid ${colors.divider}">
                <img src="${escapeHtml(mailLogoUrl())}" width="112" height="39" alt="Deliivo" style="display: block; width: 112px; height: 39px; border: 0; font-family: ${fontStack}; font-size: 20px; font-weight: 800; color: ${colors.orangeDark}" />
              </td>
            </tr>
            <tr>
              <td class="email-px" style="padding: 36px 40px 40px; font-family: ${fontStack}; color: ${colors.dark}">
                ${purpose ? `<div style="margin: 0 0 14px"><span style="display: inline-block; padding: 4px 12px; border-radius: 999px; background-color: ${colors.orangeLight}; border: 1px solid ${colors.orangeBorder}; font-family: ${fontStack}; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; color: ${colors.orangeText}">${purpose}</span></div>` : ''}
                <div role="heading" aria-level="1" class="email-heading" style="margin: 0 0 12px; font-family: ${fontStack}; font-size: 24px; line-height: 1.3; font-weight: 700; color: ${colors.dark}">${heading}</div>
                <p style="margin: 0; font-family: ${fontStack}; font-size: 15px; line-height: 1.6; color: ${colors.text}">${body}</p>
                ${main}
                ${note ? `<p style="margin: 28px 0 0; font-family: ${fontStack}; font-size: 13px; line-height: 1.6; color: ${colors.gray}">${note}</p>` : ''}
                <p style="margin: 28px 0 0; font-family: ${fontStack}; font-size: 15px; line-height: 1.6; color: ${colors.text}">Thanks,<br />The Deliivo team</p>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px">
            <tr>
              <td align="center" style="padding: 24px 16px 0; font-family: ${fontStack}; font-size: 12px; line-height: 1.8; color: ${colors.gray}">
                ${footerLink('Help', `mailto:${supportEmailAddress()}`)} &nbsp;&middot;&nbsp;
                ${footerLink('Privacy', `${siteUrl}/privacy`)} &nbsp;&middot;&nbsp;
                ${footerLink('Terms', `${siteUrl}/terms`)}<br />
                You received this email because of activity on your Deliivo account.<br />
                &copy; ${new Date().getFullYear()} Deliivo. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
};

// Email clients strip JavaScript, so a copy-to-clipboard button cannot work inside an email.
// `user-select: all` selects the whole code in one click where the client supports it, and
// the "verification code" wording lets the Gmail app show its own "Copy code" button.
const otpBox = (otp: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 28px">
    <tr>
      <td align="center" style="padding: 24px 16px; background-color: ${colors.orangeLight}; border: 1px solid ${colors.orangeBorder}; border-radius: 12px">
        <div style="font-family: ${fontStack}; font-size: 12px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: ${colors.gray}">Your verification code</div>
        <div style="margin-top: 10px; font-family: ${fontStack}; font-size: 36px; line-height: 1.2; font-weight: 700; letter-spacing: 10px; color: ${colors.dark}">
          <span style="-webkit-user-select: all; user-select: all">${escapeHtml(otp)}</span>
        </div>
        <div style="margin-top: 10px; font-family: ${fontStack}; font-size: 13px; color: ${colors.gray}">Expires in ${OTP_EXPIRY_MINUTES} minutes</div>
      </td>
    </tr>
  </table>
`;

const ctaButton = (label: string, href: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top: 24px">
    <tr>
      <td align="center" style="border-radius: 999px; background-color: ${colors.orange}">
        <a href="${escapeHtml(href)}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: ${fontStack}; font-size: 15px; font-weight: 600; color: ${colors.white}; text-decoration: none; border-radius: 999px">${label}</a>
      </td>
    </tr>
  </table>
`;

const supportLink = (supportEmail = supportEmailAddress()) =>
  `<a href="mailto:${escapeHtml(supportEmail)}" style="color: ${colors.orangeDark}">${escapeHtml(supportEmail)}</a>`;

const supportLine = (supportEmail?: string) => `Not you? Contact ${supportLink(supportEmail)} right away.`;

// Subjects start with the purpose so the reason for the email is visible in the inbox list.
export const mailSubjects = {
  signupOtp: 'Sign up – Verify your email for Deliivo',
  loginOtp: 'Sign in – Your Deliivo sign-in code',
  resetOtp: 'Password reset – Reset your Deliivo password',
  contactVerifyOtp: 'Email verification – Confirm your Deliivo email',
  loginSuccess: 'Sign in – New sign-in to Deliivo',
  signupSuccess: 'Sign up – Your email is verified',
  welcome: 'Welcome to Deliivo',
  passwordChanged: 'Security alert – Your Deliivo password was changed',
} as const;

export const loginOtpTemplate = (otp: string) =>
  emailLayout({
    preheader: `Use ${escapeHtml(otp)} to sign in. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    purpose: 'Sign in',
    heading: 'Your sign-in code',
    body: 'Enter this code to sign in to your Deliivo account.',
    main: otpBox(otp),
    note: 'Never share this code with anyone. If you did not try to sign in, ignore this email. Your account is safe.',
  });

export const signupOtpTemplate = (otp: string) =>
  emailLayout({
    preheader: `Your code is ${escapeHtml(otp)}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    purpose: 'Sign up',
    heading: 'Verify your email',
    body: 'Enter this code in Deliivo to finish creating your account.',
    main: otpBox(otp),
    note: 'Never share this code with anyone.',
  });

export const contactVerifyOtpTemplate = (otp: string) =>
  emailLayout({
    preheader: `Your code is ${escapeHtml(otp)}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    purpose: 'Email verification',
    heading: 'Confirm this email address',
    body: 'Enter this code to add this email address to your Deliivo account.',
    main: otpBox(otp),
    note: 'If you did not request this, ignore this email.',
  });

export const otpSuccessTemplate = (purpose: 'login' | 'signup', supportEmail?: string) =>
  purpose === 'login'
    ? emailLayout({
        preheader: 'You signed in just now.',
        purpose: 'Sign in',
    heading: 'New sign-in',
        body: 'You signed in to your Deliivo account.',
        note: supportLine(supportEmail),
      })
    : emailLayout({
        preheader: "You're all set.",
        purpose: 'Sign up',
    heading: 'Email verified',
        body: 'Your email is confirmed.',
        note: supportLine(supportEmail),
      });

export const signupWelcomeTemplate = (name?: string, appUrl?: string, supportEmail?: string) =>
  emailLayout({
    preheader: 'Your account is ready. Finish your profile to get started.',
    purpose: 'Welcome',
    heading: name ? `Welcome, ${escapeHtml(name)}!` : 'Welcome to Deliivo!',
    body: 'Your account is ready. Complete your profile to book your first ride or start driving.',
    main: ctaButton('Open Deliivo', appUrl ?? appBaseUrl()),
    note: `Questions? Reply to this email or contact ${supportLink(supportEmail)}.`,
  });

export const resetOtpTemplate = (otp: string) =>
  emailLayout({
    preheader: `Your reset code is ${escapeHtml(otp)}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    purpose: 'Password reset',
    heading: 'Reset your password',
    body: 'We received a request to reset your password. Enter this code to choose a new one.',
    main: otpBox(otp),
    note: 'If you did not request a reset, ignore this email. Your password does not change.',
  });

export const passwordChangedTemplate = (changedAt: Date, supportEmail?: string) =>
  emailLayout({
    preheader: 'If this was you, no action is needed.',
    purpose: 'Security alert',
    heading: 'Password changed',
    body: `The password for your Deliivo account was changed on ${escapeHtml(changedAt.toUTCString())}.`,
    note: supportLine(supportEmail),
  });
