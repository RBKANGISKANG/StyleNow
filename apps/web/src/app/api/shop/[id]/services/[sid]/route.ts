import { NextRequest, NextResponse } from 'next/server';
import { patchService, archiveService } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  const body = await req.json().catch(() => ({}));
  const patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean; categoryId?: string; requiresPatchTest?: boolean; consultationFirst?: boolean; resource?: 'basin' | 'colour' | null } = {};
  if (typeof body.categoryId === 'string' && body.categoryId) patch.categoryId = body.categoryId;
  if (typeof body.basePriceCents === 'number' && body.basePriceCents >= 0) {
    patch.basePriceCents = Math.round(body.basePriceCents);
  }
  if (typeof body.durationMin === 'number' && body.durationMin > 0) {
    patch.durationMin = Math.round(body.durationMin);
  }
  if (typeof body.dynamicPricing === 'boolean') patch.dynamicPricing = body.dynamicPricing;
  if (typeof body.requiresPatchTest === 'boolean') patch.requiresPatchTest = body.requiresPatchTest;
  if (typeof body.consultationFirst === 'boolean') patch.consultationFirst = body.consultationFirst;
  // null (not undefined) is the explicit "cleared" — undefined keys never
  // arrive here at all, JSON.stringify drops them client-side.
  if ('resource' in body) patch.resource = body.resource === 'basin' || body.resource === 'colour' ? body.resource : null;
  try {
    patchService(params.id, params.sid, patch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  archiveService(params.id, params.sid);
  return NextResponse.json({ ok: true });
}
