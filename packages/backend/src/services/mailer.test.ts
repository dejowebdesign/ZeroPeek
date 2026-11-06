/**
 * Mailer unit tests (Phase 6.3).
 *
 * These never open a network connection: they only cover the decisions the
 * mailer makes before a transport is used – whether it is enabled, and how the
 * confirmation e-mail is built. The disabled path is the important one: with no
 * SMTP configuration, sending must be a harmless no-op so registration still
 * works.
 */

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { createMailer, verificationEmail } from './mailer.js';

describe('createMailer', () => {
  it('is disabled when no SMTP URL or sender is configured', () => {
    const mailer = createMailer(loadConfig({}));
    expect(mailer.enabled).toBe(false);
  });

  it('reports failure instead of throwing when disabled', async () => {
    const mailer = createMailer(loadConfig({}));
    await expect(
      mailer.send({ to: 'a@b.c', subject: 's', text: 't', html: '<p>t</p>' }),
    ).resolves.toBe(false);
  });

  it('is disabled when only the sender is missing', () => {
    const mailer = createMailer(loadConfig({ SMTP_URL: 'smtps://user:key@smtp.example.com:465' }));
    expect(mailer.enabled).toBe(false);
  });

  it('is enabled once a URL and a sender are both present', () => {
    const mailer = createMailer(
      loadConfig({
        SMTP_URL: 'smtps://user:key@smtp.example.com:465',
        MAIL_FROM: 'no-reply@example.com',
      }),
    );
    expect(mailer.enabled).toBe(true);
  });
});

describe('verificationEmail', () => {
  const message = verificationEmail({
    username: 'Maya',
    verifyUrl: 'https://quiz.example.com/auth.html#verify=abc123',
    ttlHours: 24,
  });

  it('names the recipient, the link and the validity window', () => {
    expect(message.subject).toContain('ZeroPeek');
    expect(message.text).toContain('https://quiz.example.com/auth.html#verify=abc123');
    expect(message.text).toContain('24 hours');
    expect(message.html).toContain('https://quiz.example.com/auth.html#verify=abc123');
  });

  it('escapes a display name so it cannot inject markup', () => {
    const hostile = verificationEmail({
      username: '<script>alert(1)</script>',
      verifyUrl: 'https://quiz.example.com/x',
      ttlHours: 1,
    });
    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).toContain('&lt;script&gt;');
  });
});
