import { NextRequest, NextResponse } from 'next/server';
import { exportShopConfig, restoreShopConfig } from '@/core/store';
import { badRequest, fail } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** The shop's whole configuration as one document. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ doc: exportShopConfig(params.id) });
  } catch (e) {
    return fail(e);
  }
}

/** Restore from { doc } — the engine validates the document. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!body.doc || typeof body.doc !== 'object' || Array.isArray(body.doc)) return badRequest();
  try {
    restoreShopConfig(params.id, body.doc);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
