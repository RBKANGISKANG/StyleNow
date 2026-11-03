import { NextRequest, NextResponse } from 'next/server';
import { claimShop, isShopOwner, releaseShop } from '@/core/store';
import { badRequest, fail, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** Claim a shop; a real shop someone already owns answers 409 'already_owned'. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.ownerKey) || !body.ownerKey) return badRequest();
  try {
    claimShop(params.id, body.ownerKey);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

/** Release it — only with the key that holds it. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ownerKey = req.nextUrl.searchParams.get('ownerKey') ?? '';
  if (!ownerKey) return badRequest();
  if (!isShopOwner(params.id, ownerKey)) return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  releaseShop(params.id, ownerKey);
  return NextResponse.json({ ok: true });
}
