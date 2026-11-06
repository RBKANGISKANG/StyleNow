import { NextRequest, NextResponse } from 'next/server';
import { setReview } from '@/core/store';
import { errStatus, ownBooking } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.rating !== 'number' || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'invalid_review' }, { status: 400 });
  }
  const own = ownBooking(params.id, body.deviceId);
  if ('error' in own) return own.error;
  try {
    const b = setReview(params.id, body.rating, body.text, Array.isArray(body.tags) ? body.tags : undefined);
    return NextResponse.json({ review: b.review });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
