/**
 * Outgoing mail (Phase 6.3).
 *
 * The transport is built from a single connection URL (`SMTP_URL`), so the same
 * code works with any provider that speaks SMTP – including Brevo, which offers
 * an SMTP relay. Credentials live only in the environment; nothing here logs a
 * password or a token.
 *
 * When no mail is configured the sender is a no-op: registration still
 * succeeds, and the caller decides whether to surface the missing delivery.
 */

import nodemailer, { type Transporter } from 'nodemailer';

import { type AppConfig, isMailConfigured } from '../config.js';

export interface Mailer {
  /** Whether a transport is configured and can actually send. */
  readonly enabled: boolean;
  /** Send one message. Returns whether it was handed to the transport. */
  send(message: { to: string; subject: string; text: string; html: string }): Promise<boolean>;
}

/** Escape a value for safe interpolation into the HTML part of an e-mail. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The `Name <address>` form Nodemailer expects, with the name quoted. */
function formatFrom(config: AppConfig): string {
  const name = config.mailFromName.trim();
  if (!name) return config.mailFrom;
  return `"${name.replace(/"/g, '')}" <${config.mailFrom}>`;
}

/**
 * Build the mailer for a config. Returns a disabled mailer when `SMTP_URL` or
 * `MAIL_FROM` is missing, or when the URL cannot be parsed.
 */
export function createMailer(config: AppConfig): Mailer {
  if (!isMailConfigured(config)) {
    return { enabled: false, send: async () => false };
  }

  let transport: Transporter;
  try {
    transport = nodemailer.createTransport(config.smtpUrl);
  } catch {
    return { enabled: false, send: async () => false };
  }

  return {
    enabled: true,
    async send(message) {
      await transport.sendMail({
        from: formatFrom(config),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return true;
    },
  };
}

/**
 * The verification e-mail. Kept as its own function so the wording lives in one
 * place and the link is never duplicated across call sites.
 */
export function verificationEmail(input: {
  username: string;
  verifyUrl: string;
  ttlHours: number;
}): { subject: string; text: string; html: string } {
  const name = input.username;
  const url = input.verifyUrl;
  const hours = input.ttlHours;
  const subject = 'Confirm your ZeroPeek account';
  const text = [
    `Hi ${name},`,
    '',
    'welcome to ZeroPeek! Please confirm your e-mail address to activate your account:',
    '',
    url,
    '',
    `The link is valid for ${hours} hours and can be used once.`,
    'If you did not create an account, you can ignore this message.',
    '',
    '— ZeroPeek',
  ].join('\n');
  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    '<p>welcome to ZeroPeek! Please confirm your e-mail address to activate your account:</p>',
    `<p><a href="${escapeHtml(url)}">Confirm my account</a></p>`,
    `<p>The link is valid for ${hours} hours and can be used once.<br>`,
    'If you did not create an account, you can ignore this message.</p>',
    '<p>— ZeroPeek</p>',
  ].join('\n');
  return { subject, text, html };
}
