import { NextRequest, NextResponse } from 'next/server';
import { userReviewsForShop } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return NextResponse.json({ reviews: userReviewsForShop(params.id) });
}
