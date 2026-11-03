import { NextRequest, NextResponse } from 'next/server';
import { addStaffPhoto, deleteStaffPhoto, staffPhotos } from '@/core/store';
import { badRequest, fail, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** Same ceiling as the salon gallery: anything larger skipped the client downscaler. */
const MAX_BYTES = 900_000;

type P = { params: { id: string; sid: string } };

export async function GET(_req: NextRequest, { params }: P) {
  return NextResponse.json({ photos: staffPhotos(params.sid) });
}

export async function POST(req: NextRequest, { params }: P) {
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.dataUrl) || (body.caption != null && !isStr(body.caption))) return badRequest();
  if (body.dataUrl.length > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  try {
    return NextResponse.json({ photo: addStaffPhoto(params.id, params.sid, body.dataUrl, body.caption ?? '') }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: P) {
  const photoId = req.nextUrl.searchParams.get('photoId');
  if (!photoId) return badRequest();
  try {
    deleteStaffPhoto(params.id, params.sid, photoId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
