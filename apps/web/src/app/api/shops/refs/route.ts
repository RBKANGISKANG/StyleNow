import { NextRequest, NextResponse } from 'next/server';
import { shopById } from '@/core/store';

export const dynamic = 'force-dynamic';

/** Name + emoji for salon ids — lets operator screens show salons registered after the build. */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 50);
  const shops = ids.flatMap((id) => {
    const s = shopById(id);
    return s ? [{ id: s.id, name: s.name, emoji: s.emoji }] : [];
  });
  return NextResponse.json({ shops });
}
