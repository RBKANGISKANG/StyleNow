import { NextRequest, NextResponse } from 'next/server';
import { addPricingRule, effectiveRules } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ rules: effectiveRules(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.kind || !body?.adjustKind) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  return NextResponse.json({ rule: addPricingRule(params.id, body) }, { status: 201 });
}
