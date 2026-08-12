import nodemailer from 'nodemailer';
import type SESTransport from 'nodemailer/lib/ses-transport/index.js';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config({ quiet: true });

export type MailProvider = 'resend' | 'smtp' | 'ses';

const parseMailProvider = (value?: string): MailProvider => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'resend') return 'resend';
  if (normalized === 'ses') return 'ses';
  if (normalized === 'smtp') return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return 'smtp';
};

export const mailProvider: MailProvider = parseMailProvider(process.env.MAIL_PROVIDER);

export interface SendMailOptions {
  from?: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
}

export interface SendMailResult {
  messageId: string;
}

let resendClient: Resend | null = null;
const getResendClient = (): Resend => {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('[MAILER] RESEND_API_KEY is not set');
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
};

let nodemailerTransporter: nodemailer.Transporter | null = null;
const getNodemailerTransporter = (): nodemailer.Transporter => {
  if (!nodemailerTransporter) {
    if (mailProvider === 'ses') {
      const sesClient = new SESv2Client({ region: process.env.AWS_SES_REGION || process.env.AWS_REGION });
      const sesOptions: SESTransport.Options = { SES: { sesClient, SendEmailCommand } };
      nodemailerTransporter = nodemailer.createTransport(sesOptions);
    } else {
      nodemailerTransporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST || 'smtp.gmail.com',
        port: Number(process.env.MAIL_PORT) || 587,
        secure: false,
        requireTLS: true,
        auth: {
          user: process.env.MAIL_USER,
          pass: process.env.MAIL_PASS,
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
      });
    }
  }
  return nodemailerTransporter;
};

const getMailerLogMeta = () => ({
  provider: mailProvider,
  host:
    mailProvider === 'resend'
      ? 'api.resend.com'
      : mailProvider === 'ses'
        ? `ses:${process.env.AWS_SES_REGION || process.env.AWS_REGION || 'unset'}`
        : process.env.MAIL_HOST || 'smtp.gmail.com',
  port: mailProvider === 'smtp' ? Number(process.env.MAIL_PORT) || 587 : undefined,
  hasResendKey: Boolean(process.env.RESEND_API_KEY),
  hasUser: Boolean(process.env.MAIL_USER),
  hasPass: Boolean(process.env.MAIL_PASS),
  hasFrom: Boolean(process.env.MAIL_FROM),
});

logger.info('[MAILER] Config loaded', getMailerLogMeta());

export const verifyMailer = async (): Promise<boolean> => {
  const mailerMeta = getMailerLogMeta();

  if (mailProvider === 'resend') {
    if (!mailerMeta.hasResendKey) {
      logger.warn('[MAILER] RESEND_API_KEY not set; skipping Resend verification', mailerMeta);
      return false;
    }
    logger.info('[MAILER] Resend API key verified', mailerMeta);
    return true;
  }

  const isConfigured =
    mailProvider === 'ses'
      ? mailerMeta.hasFrom
      : mailerMeta.hasUser && mailerMeta.hasPass && mailerMeta.hasFrom;

  if (!isConfigured) {
    logger.warn('[MAILER] Variables are incomplete; skipping verification', mailerMeta);
    return false;
  }

  try {
    const transporterInstance = getNodemailerTransporter();
    await transporterInstance.verify();
    logger.info('[MAILER] Connection verified', mailerMeta);
    return true;
  } catch (error) {
    logger.error('[MAILER] Verification failed', {
      ...mailerMeta,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

export const transporter = {
  sendMail: async (options: SendMailOptions): Promise<SendMailResult> => {
    const from = options.from || process.env.MAIL_FROM || 'noreply@example.com';
    const to = options.to;

    if (mailProvider === 'resend') {
      const resend = getResendClient();
      const recipientList = Array.isArray(to) ? to : [to];
      const resendOptions = options.html
        ? { from, to: recipientList, subject: options.subject, html: options.html, ...(options.text ? { text: options.text } : {}) }
        : { from, to: recipientList, subject: options.subject, text: options.text || '' };

      const { data, error } = await resend.emails.send(resendOptions);

      if (error) {
        throw new Error(`[MAILER/Resend] ${error.name}: ${error.message}`);
      }

      const messageId = data?.id || 'resend-sent';
      logger.info('[MAILER/Resend] Mail sent', { messageId, to });
      return { messageId };
    }

    const nmTransporter = getNodemailerTransporter();
    const result = await nmTransporter.sendMail({
      from,
      to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    logger.info('[MAILER/Nodemailer] Mail sent', { messageId: result.messageId, to });
    return { messageId: result.messageId };
  },

  verify: async (): Promise<boolean> => {
    return verifyMailer();
  },
};

export default transporter;
