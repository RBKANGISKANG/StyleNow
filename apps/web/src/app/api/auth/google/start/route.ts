import { NextRequest, NextResponse } from 'next/server';
import { cookieOptions, newToken } from '@/lib/session';
import { siteOrigin } from '@/lib/notify';
import { originFor } from '@/lib/stripe-server';

export const dynamic = 'force-dynamic';

const OAUTH_COOKIE = 'sn_oauth';

/**
 * Sign in with Google, step 1: send the browser to Google with a one-time
 * `state` (kept in an httpOnly cookie) so the answer can only come back to
 * the browser that asked. Needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return NextResponse.json({ error: 'google_not_configured' }, { status: 501 });
  const state = newToken();
  const device = req.nextUrl.searchParams.get('device') ?? '';
  const back = (req.nextUrl.searchParams.get('back') ?? '/account').startsWith('/') ? req.nextUrl.searchParams.get('back') ?? '/account' : '/account';
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `${siteOrigin(originFor(req))}/api/auth/google/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  const res = NextResponse.redirect(url.toString(), 302);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, device, back }), cookieOptions(req, 600));
  return res;
}
