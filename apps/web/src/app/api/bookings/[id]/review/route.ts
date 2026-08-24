import { NextRequest, NextResponse } from 'next/server';
import { setReview } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.rating !== 'number' || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'invalid_review' }, { status: 400 });
  }
  try {
    const b = setReview(params.id, body.rating, body.text);
    return NextResponse.json({ review: b.review });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
