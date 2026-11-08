/**
 * Server-side login: password hashing, the session cookie, and "who is
 * calling" for every API route. Server only — never imported by client code.
 *
 * The session cookie is httpOnly + SameSite=Lax + Secure (on https), and
 * holds `email.expiry.signature` — HMAC-SHA256 with STYLENOW_SESSION_SECRET
 * (or a random secret kept with the data). Nothing in it can be forged or
 * read by page scripts.
 */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { accountByEmail, serverSecret, type Account } from '@/core/store';

export const SESSION_COOKIE = 'sn_session';
const SESSION_DAYS = 30;
const N = 16384;

function scryptAsync(pw: string, salt: Buffer, n = N): Promise<Buffer> {
  return new Promise((ok, fail) =>
    scrypt(pw, salt, 64, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? fail(e) : ok(k))),
  );
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt);
  return ['scrypt', String(N), salt.toString('base64'), key.toString('base64')].join('$');
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, n, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scryptAsync(pw, Buffer.from(salt, 'base64'), Number(n));
  return got.length === want.length && timingSafeEqual(got, want);
}

/** At least 8 characters with a letter and a digit. */
export function passwordOk(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

function secret(): string {
  return process.env.STYLENOW_SESSION_SECRET || serverSecret(() => randomBytes(32).toString('base64'));
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function sessionCookieValue(email: string): string {
  const payload = `${Buffer.from(email).toString('base64url')}.${Date.now() + SESSION_DAYS * 864e5}`;
  return `${payload}.${sign(payload)}`;
}

export function cookieOptions(req: NextRequest, maxAgeSec = SESSION_DAYS * 86400) {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  return { httpOnly: true, sameSite: 'lax' as const, secure: proto === 'https', path: '/', maxAge: maxAgeSec };
}

/** The logged-in account, or null. */
export function sessionAccount(req: NextRequest): Account | null {
  const raw = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const [e, exp, sig] = raw.split('.');
  if (!e || !exp || !sig) return null;
  const want = sign(`${e}.${exp}`);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  if (Number(exp) < Date.now()) return null;
  return accountByEmail(Buffer.from(e, 'base64url').toString());
}

/**
 * Who is calling: the logged-in email (proved by the cookie) and this
 * browser's device id (a random id only that browser knows). An email typed
 * into a request body proves nothing and is never trusted on its own.
 */
export function callerKeys(req: NextRequest): string[] {
  const keys: string[] = [];
  const acc = sessionAccount(req);
  if (acc) keys.push(acc.email, acc.deviceId);
  const dev = req.headers.get('x-sn-device') ?? '';
  if (/^[A-Za-z0-9_-]{8,80}$/.test(dev)) keys.push(dev);
  return [...new Set(keys)];
}

/** A claimed owner key is accepted only if the caller can prove it. */
export function provenKey(req: NextRequest, claimed: unknown): string | null {
  return typeof claimed === 'string' && callerKeys(req).includes(claimed) ? claimed : null;
}

export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/** A small brake on password guessing: 10 tries per 15 minutes per key. */
const tries = new Map<string, { n: number; until: number }>();
export function rateLimited(key: string): boolean {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || t.until < now) {
    tries.set(key, { n: 1, until: now + 15 * 60e3 });
    return false;
  }
  t.n++;
  return t.n > 10;
}

export const clientIp = (req: NextRequest) =>
  (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
