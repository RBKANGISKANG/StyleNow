import { NextRequest, NextResponse } from 'next/server';
import { feed } from '@/server/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ shops: feed(body) });
}
