import { NextRequest, NextResponse } from 'next/server';
import { platformSettings, setRequireApproval } from '@/core/store';
import { requireAdmin, badRequest } from '../../_lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ settings: platformSettings() });
}

export async function PATCH(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (typeof body?.requireApproval !== 'boolean') return badRequest();
  setRequireApproval(body.requireApproval);
  return NextResponse.json({ settings: platformSettings() });
}
