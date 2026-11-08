import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { resolveDispute } from '@/core/store';
import { errStatus } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

const KINDS = ['redo', 'goodwill', 'declined'] as const;

export async function POST(req: NextRequest, props: { params: Promise<{ id: string; did: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!KINDS.includes(body.kind)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  try {
    const dispute = resolveDispute(params.id, params.did, {
      kind: body.kind,
      note: typeof body.note === 'string' ? body.note.slice(0, 500) : undefined,
    });
    return NextResponse.json({ dispute });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
