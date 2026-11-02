import { NextRequest, NextResponse } from 'next/server';
import { disputesForShop } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ disputes: disputesForShop(params.id) });
}
