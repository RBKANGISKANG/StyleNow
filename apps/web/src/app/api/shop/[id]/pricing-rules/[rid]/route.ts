import { NextRequest, NextResponse } from 'next/server';
import { toggleRule, updatePricingRule, deletePricingRule } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function PATCH(_req: NextRequest, { params }: { params: { id: string; rid: string } }) {
  try {
    return NextResponse.json({ enabled: toggleRule(params.id, params.rid) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string; rid: string } }) {
  const body = await req.json().catch(() => ({}));
  try {
    updatePricingRule(params.id, params.rid, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; rid: string } }) {
  deletePricingRule(params.id, params.rid);
  return NextResponse.json({ ok: true });
}
