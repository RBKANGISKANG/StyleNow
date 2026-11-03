import { NextRequest, NextResponse } from 'next/server';
import { exportShopConfig, isShopOwner, restoreShopConfig } from '@/core/store';
import { badRequest, fail } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

const notYours = () => NextResponse.json({ error: 'not_yours' }, { status: 403 });

/**
 * The shop's whole configuration, for whoever runs it. The owner key is not
 * part of the answer: it is the shop's only credential, and a backup is a file
 * people email around.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isShopOwner(params.id, req.nextUrl.searchParams.get('ownerKey') ?? '')) return notYours();
  try {
    const { owner: _owner, ...doc } = exportShopConfig(params.id);
    return NextResponse.json({ doc });
  } catch (e) {
    return fail(e);
  }
}

/** Restore from { doc, ownerKey } — settings only; who owns the shop is not restorable. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!body.doc || typeof body.doc !== 'object' || Array.isArray(body.doc)) return badRequest();
  if (!isShopOwner(params.id, typeof body.ownerKey === 'string' ? body.ownerKey : '')) return notYours();
  try {
    const current = exportShopConfig(params.id).owner;
    restoreShopConfig(params.id, { ...body.doc, owner: current });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
