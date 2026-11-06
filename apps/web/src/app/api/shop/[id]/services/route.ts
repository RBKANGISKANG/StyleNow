import { NextRequest, NextResponse } from 'next/server';
import { addService, effectiveServices } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ services: effectiveServices(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.basePriceCents || !body?.durationMin) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  return NextResponse.json({ service: addService(params.id, body) }, { status: 201 });
}
