import { NextRequest, NextResponse } from 'next/server';
import {
  accountByEmail,
  bookingsForDeviceView,
  createAccount,
  deleteAccountRecord,
  giftCardsForDevice,
  storeAuthToken,
  takeAuthToken,
  updateAccount,
  type Account,
} from '@/core/store';
import {
  SESSION_COOKIE,
  checkPassword,
  clientIp,
  cookieOptions,
  hashPassword,
  newToken,
  passwordOk,
  rateLimited,
  sessionAccount,
  sessionCookieValue,
  tokenHash,
} from '@/lib/session';
import { sendEmail, siteOrigin } from '@/lib/notify';
import { originFor } from '@/lib/stripe-server';

export const dynamic = 'force-dynamic';

/**
 * Accounts in server mode.
 *   POST /api/auth/register { email, password, profile, deviceId }
 *   POST /api/auth/login    { email, password }
 *   POST /api/auth/logout
 *   GET  /api/auth/me       → { user } or { user: null }
 *   PATCH /api/auth/me      { profile }
 *   DELETE /api/auth/me     (GDPR: removes the account)
 *   GET  /api/auth/export   (GDPR: everything about the person)
 *   POST /api/auth/forgot   { email }   → always 200 (never reveals who has an account)
 *   POST /api/auth/reset    { token, password }
 *   POST /api/auth/verify   { token }
 */
const PROFILE_KEYS = ['name', 'phone', 'city', 'postalCode', 'birthday', 'preferredLanguage', 'consents'];

function cleanProfile(p: unknown): Record<string, unknown> {
  const src = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) {
    const v = src[k];
    if (k === 'consents' && v && typeof v === 'object') {
      const c = v as Record<string, unknown>;
      out.consents = { terms: Boolean(c.terms), marketing: Boolean(c.marketing), personalisation: Boolean(c.personalisation) };
    } else if (typeof v === 'string') out[k] = v.slice(0, 120);
  }
  return out;
}

const view = (a: Account) => ({ id: a.id, email: a.email, deviceId: a.deviceId, emailVerified: a.emailVerified, provider: 'email', demo: false, ...a.profile });

function withSession(req: NextRequest, a: Account, status = 200) {
  const res = NextResponse.json({ user: view(a) }, { status });
  res.cookies.set(SESSION_COOKIE, sessionCookieValue(a.email), cookieOptions(req));
  return res;
}

async function sendVerify(req: NextRequest, a: Account) {
  const token = newToken();
  storeAuthToken(tokenHash(token), { email: a.email, kind: 'verify', expiresAt: Date.now() + 7 * 864e5 });
  const de = a.profile.preferredLanguage === 'de';
  const link = `${siteOrigin(originFor(req))}/account?verify=${token}`;
  await sendEmail(
    a.email,
    de ? 'Bitte bestätige deine E-Mail-Adresse' : 'Please confirm your email address',
    de ? `Willkommen bei StyleNow!\n\nBitte bestätige deine E-Mail-Adresse:\n${link}` : `Welcome to StyleNow!\n\nPlease confirm your email address:\n${link}`,
  );
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  switch (params.action) {
    case 'register': {
      if (!passwordOk(body.password)) return bad('weak_password');
      if (rateLimited(`reg:${clientIp(req)}`)) return bad('too_many_attempts', 429);
      const dev = typeof body.deviceId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.deviceId) ? body.deviceId : `dev-${crypto.randomUUID()}`;
      try {
        const a = createAccount(email, await hashPassword(body.password), dev, cleanProfile(body.profile));
        void sendVerify(req, a);
        return withSession(req, a, 201);
      } catch (e) {
        return bad((e as Error).message, (e as Error).message === 'email_taken' ? 409 : 400);
      }
    }
    case 'login': {
      if (rateLimited(`login:${clientIp(req)}:${email}`)) return bad('too_many_attempts', 429);
      const a = accountByEmail(email);
      // Same answer and similar time whether or not the account exists.
      const ok = await checkPassword(typeof body.password === 'string' ? body.password : '', a?.passHash ?? 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AA==');
      if (!a || !ok) return bad('bad_credentials', 401);
      return withSession(req, a);
    }
    case 'logout': {
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, '', cookieOptions(req, 0));
      return res;
    }
    case 'forgot': {
      if (rateLimited(`forgot:${clientIp(req)}`)) return bad('too_many_attempts', 429);
      const a = accountByEmail(email);
      if (a) {
        const token = newToken();
        storeAuthToken(tokenHash(token), { email: a.email, kind: 'reset', expiresAt: Date.now() + 60 * 60e3 });
        const de = a.profile.preferredLanguage === 'de';
        const link = `${siteOrigin(originFor(req))}/account?reset=${token}`;
        await sendEmail(
          a.email,
          de ? 'Passwort zurücksetzen' : 'Reset your password',
          de
            ? `Jemand (hoffentlich du) möchte das Passwort für dein StyleNow-Konto zurücksetzen. Der Link gilt eine Stunde:\n${link}\n\nWenn du das nicht warst, ignoriere diese E-Mail.`
            : `Someone (hopefully you) asked to reset the password for your StyleNow account. The link works for one hour:\n${link}\n\nIf that wasn't you, just ignore this email.`,
        );
      }
      return NextResponse.json({ ok: true });
    }
    case 'reset': {
      if (!passwordOk(body.password)) return bad('weak_password');
      const t = typeof body.token === 'string' ? takeAuthToken(tokenHash(body.token), 'reset') : null;
      if (!t) return bad('bad_token');
      const a = updateAccount(t.email, { passHash: await hashPassword(body.password), emailVerified: true });
      return withSession(req, a);
    }
    case 'verify': {
      const t = typeof body.token === 'string' ? takeAuthToken(tokenHash(body.token), 'verify') : null;
      if (!t) return bad('bad_token');
      updateAccount(t.email, { emailVerified: true });
      return NextResponse.json({ ok: true });
    }
    case 'resend-verify': {
      const a = sessionAccount(req);
      if (!a) return bad('login_required', 401);
      if (rateLimited(`verify:${a.email}`)) return bad('too_many_attempts', 429);
      await sendVerify(req, a);
      return NextResponse.json({ ok: true });
    }
    default:
      return bad('not_found', 404);
  }
}

export async function GET(req: NextRequest, { params }: { params: { action: string } }) {
  const a = sessionAccount(req);
  if (params.action === 'me') return NextResponse.json({ user: a ? view(a) : null });
  if (params.action === 'export') {
    if (!a) return bad('login_required', 401);
    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      profile: view(a),
      bookings: bookingsForDeviceView(a.deviceId),
      giftCards: giftCardsForDevice(a.deviceId),
    });
  }
  return bad('not_found', 404);
}

export async function PATCH(req: NextRequest, { params }: { params: { action: string } }) {
  if (params.action !== 'me') return bad('not_found', 404);
  const a = sessionAccount(req);
  if (!a) return bad('login_required', 401);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.newPassword !== undefined) {
    if (!passwordOk(body.newPassword)) return bad('weak_password');
    if (!(await checkPassword(String(body.password ?? ''), a.passHash))) return bad('bad_credentials', 401);
    updateAccount(a.email, { passHash: await hashPassword(body.newPassword) });
  }
  return NextResponse.json({ user: view(updateAccount(a.email, { profile: cleanProfile(body.profile) })) });
}

export async function DELETE(req: NextRequest, { params }: { params: { action: string } }) {
  if (params.action !== 'me') return bad('not_found', 404);
  const a = sessionAccount(req);
  if (!a) return bad('login_required', 401);
  deleteAccountRecord(a.email);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(req, 0));
  return res;
}
