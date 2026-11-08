import { NextRequest, NextResponse } from 'next/server';
import { claimShop, isShopOwner, releaseShop } from '@/core/store';
import { badRequest, fail, isStr } from '@/app/api/_lib/guards';
import { provenKey } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Claim a shop; a real shop someone already owns answers 409 'already_owned'. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.ownerKey) || !body.ownerKey) return badRequest();
  // You can only claim for yourself: your login or this browser.
  const key = provenKey(req, body.ownerKey);
  if (!key) return NextResponse.json({ error: 'login_required' }, { status: 401 });
  try {
    claimShop(params.id, key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

/** Release it — only with the key that holds it. */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ownerKey = req.nextUrl.searchParams.get('ownerKey') ?? '';
  if (!ownerKey) return badRequest();
  if (!provenKey(req, ownerKey)) return NextResponse.json({ error: 'login_required' }, { status: 401 });
  if (!isShopOwner(params.id, ownerKey)) return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  releaseShop(params.id, ownerKey);
  return NextResponse.json({ ok: true });
}
