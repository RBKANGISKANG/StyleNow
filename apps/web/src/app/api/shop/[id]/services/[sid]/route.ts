import { NextRequest, NextResponse } from 'next/server';
import { patchService } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  const body = await req.json().catch(() => ({}));
  const patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean } = {};
  if (typeof body.basePriceCents === 'number' && body.basePriceCents >= 0) {
    patch.basePriceCents = Math.round(body.basePriceCents);
  }
  if (typeof body.durationMin === 'number' && body.durationMin > 0) {
    patch.durationMin = Math.round(body.durationMin);
  }
  if (typeof body.dynamicPricing === 'boolean') patch.dynamicPricing = body.dynamicPricing;
  try {
    patchService(params.id, params.sid, patch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
