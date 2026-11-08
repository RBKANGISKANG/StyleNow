import { NextRequest, NextResponse } from 'next/server';
import { estimatedWaitMin, membersOfShop, publicQueue, shopById, shopCountry } from '@/core/store';

export const dynamic = 'force-dynamic';

/** What a shop page may show anyone: queue, wait estimate, club size. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return NextResponse.json({
    queue: publicQueue(params.id),
    waitMin: estimatedWaitMin(params.id),
    members: membersOfShop(params.id),
    slug: shopById(params.id)?.slug ?? null,
    country: shopCountry(params.id),
  });
}
