import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { billingProfile, setBillingProfile } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  return NextResponse.json({ billing: billingProfile(params.id) });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.legalName !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  setBillingProfile(params.id, body);
  return NextResponse.json({ ok: true });
}
