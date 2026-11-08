import { NextRequest, NextResponse } from 'next/server';
import { staffPhotos } from '@/core/store';

export const dynamic = 'force-dynamic';

/** A stylist's public portfolio (writes go through /api/shop/[id]/staff/[sid]/photos). */
export async function GET(_req: NextRequest, props: { params: Promise<{ sid: string }> }) {
  const params = await props.params;
  return NextResponse.json({ photos: staffPhotos(params.sid) });
}
