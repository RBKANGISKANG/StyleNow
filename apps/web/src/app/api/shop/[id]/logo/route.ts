import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { getShopLogo, setShopLogo } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return NextResponse.json({ logoUrl: getShopLogo(params.id) });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const dataUrl = typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:image/') ? body.dataUrl : null;
  if (dataUrl && dataUrl.length > 300_000) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }
  setShopLogo(params.id, dataUrl);
  return NextResponse.json({ ok: true });
}
