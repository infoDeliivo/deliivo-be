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
  main?: string;
  note?: string;
};

const emailLayout = ({ preheader, heading, body, main = '', note = '' }: LayoutOptions) => `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${heading}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${colors.cream}">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${colors.cream}">
      <tr>
        <td align="center" style="padding: 32px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: ${colors.white}; border-radius: 16px; overflow: hidden">
            <tr>
              <td style="height: 6px; line-height: 6px; font-size: 0; background-color: ${colors.orange}">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding: 32px 32px 0; font-family: ${fontStack}">
                <img src="${escapeHtml(mailLogoUrl())}" width="112" height="39" alt="Deliivo" style="display: block; width: 112px; height: 39px; border: 0; font-size: 20px; font-weight: 800; color: ${colors.orangeDark}" />
              </td>
            </tr>
            <tr>
              <td style="padding: 24px 32px 32px; font-family: ${fontStack}; color: ${colors.dark}">
                <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: ${colors.dark}">${heading}</h1>
                <p style="margin: 0; font-size: 15px; line-height: 1.6; color: ${colors.dark}">${body}</p>
                ${main}
                ${note ? `<p style="margin: 24px 0 0; font-size: 13px; line-height: 1.6; color: ${colors.gray}">${note}</p>` : ''}
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px">
            <tr>
              <td align="center" style="padding: 24px 16px; font-family: ${fontStack}; font-size: 12px; line-height: 1.6; color: ${colors.gray}">
                You received this email because of activity on your Deliivo account.<br />
                &copy; ${new Date().getFullYear()} Deliivo
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

const otpBox = (otp: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 24px">
    <tr>
      <td align="center" style="padding: 20px; background-color: ${colors.orangeLight}; border: 1px solid ${colors.orangeDark}; border-radius: 12px">
        <div style="font-family: ${fontStack}; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: ${colors.orange}">${escapeHtml(otp)}</div>
        <div style="margin-top: 8px; font-family: ${fontStack}; font-size: 13px; color: ${colors.gray}">Expires in ${OTP_EXPIRY_MINUTES} minutes.</div>
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

export const loginOtpTemplate = (otp: string) =>
  emailLayout({
    preheader: `Use ${escapeHtml(otp)} to sign in. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    heading: 'Your sign-in code',
    body: 'Enter this code to sign in to your Deliivo account.',
    main: otpBox(otp),
    note: 'Never share this code with anyone. If you did not try to sign in, ignore this email. Your account is safe.',
  });

export const signupOtpTemplate = (otp: string) =>
  emailLayout({
    preheader: `Your code is ${escapeHtml(otp)}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    heading: 'Verify your email',
    body: 'Enter this code in Deliivo to finish creating your account.',
    main: otpBox(otp),
    note: 'Never share this code with anyone.',
  });

export const contactVerifyOtpTemplate = (otp: string) =>
  emailLayout({
    preheader: `Your code is ${escapeHtml(otp)}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    heading: 'Confirm this email address',
    body: 'Enter this code to add this email address to your Deliivo account.',
    main: otpBox(otp),
    note: 'If you did not request this, ignore this email.',
  });

export const otpSuccessTemplate = (purpose: 'login' | 'signup', supportEmail?: string) =>
  purpose === 'login'
    ? emailLayout({
        preheader: 'You signed in just now.',
        heading: 'New sign-in',
        body: 'You signed in to your Deliivo account.',
        note: supportLine(supportEmail),
      })
    : emailLayout({
        preheader: "You're all set.",
        heading: 'Email verified',
        body: 'Your email is confirmed.',
        note: supportLine(supportEmail),
      });

export const signupWelcomeTemplate = (name?: string, appUrl?: string, supportEmail?: string) =>
  emailLayout({
    preheader: 'Your account is ready. Finish your profile to get started.',
    heading: name ? `Welcome, ${escapeHtml(name)}!` : 'Welcome to Deliivo!',
    body: 'Your account is ready. Complete your profile to book your first ride or start driving.',
    main: ctaButton('Open Deliivo', appUrl ?? appBaseUrl()),
    note: `Questions? Reply to this email or contact ${supportLink(supportEmail)}.`,
  });

export const resetOtpTemplate = (otp: string) =>
  emailLayout({
    preheader: `Your reset code is ${escapeHtml(otp)}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    heading: 'Reset your password',
    body: 'We received a request to reset your password. Enter this code to choose a new one.',
    main: otpBox(otp),
    note: 'If you did not request a reset, ignore this email. Your password does not change.',
  });

export const passwordChangedTemplate = (changedAt: Date, supportEmail?: string) =>
  emailLayout({
    preheader: 'If this was you, no action is needed.',
    heading: 'Password changed',
    body: `The password for your Deliivo account was changed on ${escapeHtml(changedAt.toUTCString())}.`,
    note: supportLine(supportEmail),
  });
