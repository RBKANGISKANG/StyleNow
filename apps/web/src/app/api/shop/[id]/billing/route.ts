import { NextRequest, NextResponse } from 'next/server';
import { billingProfile, setBillingProfile } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ billing: billingProfile(params.id) });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.legalName !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  setBillingProfile(params.id, body);
  return NextResponse.json({ ok: true });
}
