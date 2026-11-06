import { NextRequest, NextResponse } from 'next/server';
import { userReviewsForShop } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ reviews: userReviewsForShop(params.id) });
}
