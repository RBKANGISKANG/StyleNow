import { NextRequest, NextResponse } from 'next/server';
import { growthMetrics } from '@/core/store';
import { requireAdmin } from '../../_lib/guards';

export const dynamic = 'force-dynamic';

/** GET /api/admin/growth → the platform's growth numbers (admin key required). */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(growthMetrics());
}
