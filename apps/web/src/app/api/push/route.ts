import { NextRequest, NextResponse } from 'next/server';
import { pushSubFor, removePushSub, savePushSub, setPushPrefs, type PushSub } from '@/core/store';
import { callerKeys, rateLimited } from '@/lib/session';
import { pushTo, vapidPublicKey } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * Push notifications for this browser or app.
 *   GET    /api/push?id=…           → { publicKey, sub? }  (sub only for its owner)
 *   POST   /api/push { kind, id, keys?, prefs?, lang } → registers this device for the caller
 *   PATCH  /api/push { id, prefs }  → change which kinds arrive
 *   DELETE /api/push { id }         → stop all notifications on this device
 *   POST   /api/push?test=1 { id }  → send a test notification to this device
 */
const view = (s: PushSub) => ({ id: s.id, kind: s.kind, prefs: s.prefs });
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const sub = id ? pushSubFor(id, callerKeys(req)) : null;
  return NextResponse.json({ publicKey: vapidPublicKey(), sub: sub ? view(sub) : null });
}

export async function POST(req: NextRequest) {
  const keys = callerKeys(req);
  if (!keys.length) return bad('no_device', 401);
  if (rateLimited(`push:${keys[0]}`)) return bad('too_many_attempts', 429);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (req.nextUrl.searchParams.get('test')) {
    const sub = pushSubFor(String(body.id ?? ''), keys);
    if (!sub) return bad('not_found', 404);
    const de = sub.lang !== 'en';
    await pushTo([keys[0]], 'bookings', () => ({ title: 'StyleNow 🔔', body: de ? 'Benachrichtigungen funktionieren.' : 'Notifications are working.', url: '/', tag: 'test' }));
    return NextResponse.json({ ok: true });
  }
  const kind = body.kind === 'fcm' || body.kind === 'apns' ? body.kind : 'web';
  try {
    const sub = savePushSub({
      id: String(body.id ?? ''),
      kind,
      owners: keys,
      keys: body.keys as PushSub['keys'],
      prefs: body.prefs,
      lang: typeof body.lang === 'string' ? body.lang : 'de',
    });
    return NextResponse.json({ sub: view(sub) }, { status: 201 });
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return NextResponse.json({ sub: view(setPushPrefs(String(body.id ?? ''), callerKeys(req), body.prefs)) });
  } catch {
    return bad('not_found', 404);
  }
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  removePushSub(String(body.id ?? ''), callerKeys(req));
  return NextResponse.json({ ok: true });
}
