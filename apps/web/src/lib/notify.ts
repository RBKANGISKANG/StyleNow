/**
 * Outgoing email and SMS. Server only.
 *
 * Email, first match wins:
 *   RESEND_API_KEY + MAIL_FROM   → Resend (HTTPS API)
 *   SMTP_URL + MAIL_FROM         → any SMTP server, e.g. smtps://user:pass@smtp.ionos.de:465
 *   neither                      → not sent; written to the server log and the outbox
 * SMS (optional):
 *   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM → Twilio
 *
 * Sending never throws: a failed email must not fail a booking. Every attempt
 * lands in a small in-memory outbox the admin can read (last 200), so "did
 * the reminder go out?" has an answer.
 */
export interface OutboxEntry {
  at: number;
  channel: 'email' | 'sms';
  to: string;
  subject: string;
  status: 'sent' | 'failed' | 'not_configured';
  provider: string;
  error?: string;
}

// On globalThis: instrumentation and the API routes are separate bundles in Next.js.
const holder = globalThis as typeof globalThis & { __stylenowOutbox?: OutboxEntry[] };
const outbox: OutboxEntry[] = (holder.__stylenowOutbox ??= []);
function record(e: OutboxEntry) {
  outbox.unshift(e);
  outbox.length = Math.min(outbox.length, 200);
  if (e.status !== 'sent') console.log(`[stylenow] ${e.channel} to ${e.to} "${e.subject}": ${e.status}${e.error ? ` (${e.error})` : ''}`);
}
export const recentOutbox = () => outbox.slice();

export function emailConfigured(): boolean {
  return Boolean(process.env.MAIL_FROM && (process.env.RESEND_API_KEY || process.env.SMTP_URL));
}
export function smsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Plain text in, a simple branded HTML mail out (links become buttons). */
function toHtml(text: string): string {
  const body = esc(text)
    .split('\n')
    .map((l) => (/^https?:\/\/\S+$/.test(l.trim()) ? `<p><a href="${l.trim()}" style="display:inline-block;background:#e8445a;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">${l.trim().length > 60 ? 'Open' : l.trim()}</a></p>` : `<p style="margin:0 0 10px">${l || '&nbsp;'}</p>`))
    .join('');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;color:#1f1a24;max-width:560px;margin:auto;padding:24px"><div style="font-weight:700;font-size:20px;margin-bottom:16px">✂️ Style<span style="color:#e8445a">Now</span></div>${body}<p style="color:#8a8291;font-size:12px;margin-top:24px">StyleNow · Hamburg</p></div>`;
}

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const from = process.env.MAIL_FROM ?? '';
  if (!to || !/@/.test(to)) return false;
  try {
    if (from && process.env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text, html: toHtml(text) }),
      });
      if (!res.ok) throw new Error(`resend ${res.status} ${(await res.text()).slice(0, 120)}`);
      record({ at: Date.now(), channel: 'email', to, subject, status: 'sent', provider: 'resend' });
      return true;
    }
    if (from && process.env.SMTP_URL) {
      const nodemailer = await import('nodemailer');
      const t = nodemailer.createTransport(process.env.SMTP_URL);
      await t.sendMail({ from, to, subject, text, html: toHtml(text) });
      record({ at: Date.now(), channel: 'email', to, subject, status: 'sent', provider: 'smtp' });
      return true;
    }
    record({ at: Date.now(), channel: 'email', to, subject, status: 'not_configured', provider: 'none' });
    return false;
  } catch (e) {
    record({ at: Date.now(), channel: 'email', to, subject, status: 'failed', provider: process.env.RESEND_API_KEY ? 'resend' : 'smtp', error: (e as Error).message });
    return false;
  }
}

/** German numbers to E.164: 0171… → +49171…; anything else must already start with +. */
export function e164(phone: string): string | null {
  const p = phone.replace(/[\s()/-]/g, '');
  if (/^\+\d{8,15}$/.test(p)) return p;
  if (/^00\d{8,15}$/.test(p)) return `+${p.slice(2)}`;
  if (/^0\d{6,14}$/.test(p)) return `+49${p.slice(1)}`;
  return null;
}

export async function sendSms(phone: string, text: string): Promise<boolean> {
  const to = e164(phone);
  if (!to) return false;
  const subject = text.slice(0, 40);
  if (!smsConfigured()) {
    record({ at: Date.now(), channel: 'sms', to, subject, status: 'not_configured', provider: 'none' });
    return false;
  }
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: text.slice(0, 600) }),
    });
    if (!res.ok) throw new Error(`twilio ${res.status}`);
    record({ at: Date.now(), channel: 'sms', to, subject, status: 'sent', provider: 'twilio' });
    return true;
  } catch (e) {
    record({ at: Date.now(), channel: 'sms', to, subject, status: 'failed', provider: 'twilio', error: (e as Error).message });
    return false;
  }
}

/** The public address of the site, for links in emails. */
export function siteOrigin(fallback?: string): string {
  return (process.env.NEXT_PUBLIC_SITE_ORIGIN || fallback || 'http://localhost:3000').replace(/\/$/, '');
}
