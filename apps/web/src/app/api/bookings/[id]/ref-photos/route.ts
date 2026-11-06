import { NextRequest, NextResponse } from 'next/server';
import { addRefPhoto, removeRefPhoto } from '@/core/store';

export const dynamic = 'force-dynamic';

/** "This is what I mean" — see store.addRefPhoto. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
  const caption = typeof body.caption === 'string' ? body.caption : '';
  if (!deviceId || !dataUrl) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  try {
    const b = addRefPhoto(params.id, deviceId, dataUrl, caption);
    return NextResponse.json({ refPhotos: b.refPhotos ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const deviceId = req.nextUrl.searchParams.get('deviceId') ?? '';
  const photoId = req.nextUrl.searchParams.get('photoId') ?? '';
  if (!deviceId || !photoId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  try {
    const b = removeRefPhoto(params.id, deviceId, photoId);
    return NextResponse.json({ refPhotos: b.refPhotos ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
