import { NextRequest, NextResponse } from 'next/server';
import { shopReviews, setReviewReply } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ reviews: shopReviews(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (typeof body?.bookingId !== 'string') {
    return NextResponse.json({ error: 'missing_booking' }, { status: 400 });
  }
  try {
    setReviewReply(params.id, body.bookingId, String(body.text ?? ''));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
