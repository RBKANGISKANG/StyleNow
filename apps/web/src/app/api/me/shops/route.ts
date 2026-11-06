import { NextRequest, NextResponse } from 'next/server';
import { shopsForOwner } from '@/core/store';
import { badRequest } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ownerKey = req.nextUrl.searchParams.get('ownerKey');
  if (!ownerKey) return badRequest();
  return NextResponse.json({ shopIds: shopsForOwner(ownerKey) });
}
