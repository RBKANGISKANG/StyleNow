import { NextRequest, NextResponse } from 'next/server';
import { addLocation, shopLocations } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ locations: shopLocations(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.street?.trim() || !body?.city?.trim()) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  return NextResponse.json({ location: addLocation(params.id, body) }, { status: 201 });
}
