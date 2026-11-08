import { NextRequest, NextResponse } from 'next/server';
import { exportShopConfig, restoreShopConfig } from '@/core/store';
import { badRequest, fail, requireShopAccess } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';


/**
 * The shop's whole configuration, for whoever runs it. The owner key is not
 * part of the answer: it is the shop's only credential, and a backup is a file
 * people email around.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  try {
    const { owner: _owner, ...doc } = exportShopConfig(params.id);
    return NextResponse.json({ doc });
  } catch (e) {
    return fail(e);
  }
}

/** Restore from { doc, ownerKey } — settings only; who owns the shop is not restorable. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  if (!body.doc || typeof body.doc !== 'object' || Array.isArray(body.doc)) return badRequest();
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  try {
    const current = exportShopConfig(params.id).owner;
    restoreShopConfig(params.id, { ...body.doc, owner: current });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
