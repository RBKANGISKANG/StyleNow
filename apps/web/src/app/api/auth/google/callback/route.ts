import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { accountByEmail, createAccount, updateAccount } from '@/core/store';
import { SESSION_COOKIE, cookieOptions, sessionCookieValue } from '@/lib/session';
import { siteOrigin } from '@/lib/notify';
import { originFor } from '@/lib/stripe-server';

export const dynamic = 'force-dynamic';

const OAUTH_COOKIE = 'sn_oauth';

/**
 * Sign in with Google, step 2: check `state`, swap the code for an ID token,
 * let Google itself confirm the token (audience = our client id, email
 * verified), then sign in — creating the account on first use. An existing
 * account with the same verified email is the same person and is signed in.
 */
export async function GET(req: NextRequest) {
  const origin = siteOrigin(originFor(req));
  const fail = (why: string) => {
    const res = NextResponse.redirect(`${origin}/account?signin_error=${why}`, 302);
    res.cookies.set(OAUTH_COOKIE, '', cookieOptions(req, 0));
    return res;
  };
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) return fail('google_not_configured');

  let saved: { state?: string; device?: string; back?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get(OAUTH_COOKIE)?.value ?? '{}');
  } catch {
    /* treated as missing */
  }
  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  if (!state || !saved.state || state !== saved.state) return fail('bad_state');
  if (!code) return fail(req.nextUrl.searchParams.get('error') ?? 'no_code');

  try {
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: `${origin}/api/auth/google/callback`, grant_type: 'authorization_code' }),
    }).then((r) => r.json());
    if (!tok.id_token) return fail('token');
    const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tok.id_token)}`).then((r) => r.json());
    if (info.aud !== clientId || String(info.email_verified) !== 'true' || !info.email) return fail('unverified');

    const email = String(info.email).toLowerCase();
    let acc = accountByEmail(email);
    if (!acc) {
      const device = /^[A-Za-z0-9_-]{8,80}$/.test(saved.device ?? '') ? saved.device! : `dev-${crypto.randomUUID()}`;
      // No password: this account signs in with Google (or sets one via "forgot password").
      acc = createAccount(email, `oauth$google$${randomBytes(16).toString('base64')}`, device, {
        name: String(info.name ?? ''),
        consents: { terms: true, marketing: false, personalisation: false },
      });
    }
    acc = updateAccount(email, { emailVerified: true });
    const res = NextResponse.redirect(`${origin}${saved.back ?? '/account'}`, 302);
    res.cookies.set(SESSION_COOKIE, sessionCookieValue(acc.email), cookieOptions(req));
    res.cookies.set(OAUTH_COOKIE, '', cookieOptions(req, 0));
    return res;
  } catch {
    return fail('google_unreachable');
  }
}
