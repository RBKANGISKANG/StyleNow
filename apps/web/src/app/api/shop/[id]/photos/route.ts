import { NextRequest, NextResponse } from 'next/server';
import {
  shopPhotos,
  addShopPhoto,
  removeShopPhoto,
  makeShopCover,
  captionShopPhoto,
  MAX_SHOP_PHOTOS,
} from '@/core/store';

export const dynamic = 'force-dynamic';

/** Roughly a 1000px WebP after base64; anything larger did not go through the
 *  client-side downscaler and should not be trusted with the quota. */
const MAX_BYTES = 900_000;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ photos: shopPhotos(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const dataUrl = typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:image/') ? body.dataUrl : null;
  if (!dataUrl) return NextResponse.json({ error: 'bad_image' }, { status: 400 });
  if (dataUrl.length > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  if (shopPhotos(params.id).length >= MAX_SHOP_PHOTOS) {
    return NextResponse.json({ error: 'photo_limit' }, { status: 409 });
  }
  const photo = addShopPhoto(params.id, dataUrl, typeof body.caption === 'string' ? body.caption : '');
  return NextResponse.json({ photo });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const photoId = typeof body.photoId === 'string' ? body.photoId : null;
  if (!photoId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  if (body.cover === true) makeShopCover(params.id, photoId);
  if (typeof body.caption === 'string') captionShopPhoto(params.id, photoId, body.caption);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const photoId = req.nextUrl.searchParams.get('photoId');
  if (!photoId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  removeShopPhoto(params.id, photoId);
  return NextResponse.json({ ok: true });
}
