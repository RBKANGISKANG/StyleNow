import { NextRequest, NextResponse } from 'next/server';
import { shopsForOwner } from '@/core/store';
import { callerKeys } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The salons connected to the caller's login and/or this browser. */
export async function GET(req: NextRequest) {
  const ids = new Set(callerKeys(req).flatMap((k) => shopsForOwner(k)));
  return NextResponse.json({ shopIds: [...ids] });
}
