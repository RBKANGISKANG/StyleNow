import { NextRequest, NextResponse } from 'next/server';
import { isShopOwner, messageThread, sendMessage, markThreadRead, threadKeyForDevice } from '@/core/store';
import { requireShopAccess } from '@/app/api/_lib/guards';
import { callerKeys } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** A thread is readable by the salon, or by the customer whose device it belongs to. */
function mayUseThread(req: NextRequest, shopId: string, customerKey: string): boolean {
  const keys = callerKeys(req);
  if (keys.some((k) => isShopOwner(shopId, k))) return true;
  return keys.some((k) => k === customerKey || threadKeyForDevice(shopId, k) === customerKey);
}

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId') ?? '';
  const customerKey = req.nextUrl.searchParams.get('customerKey') ?? '';
  if (!mayUseThread(req, shopId, customerKey)) return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  return NextResponse.json({ messages: messageThread(shopId, customerKey) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const from = body.from === 'shop' ? 'shop' : 'customer';
  const shopId = String(body.shopId ?? '');
  if (from === 'shop') {
    const denied = requireShopAccess(req, shopId);
    if (denied) return denied;
  }
  // Bookings live in this process's store, so the device's real key for the
  // shop is only knowable here — resolve it rather than forking a thread.
  const resolve = typeof body.resolveKeyForDevice === 'string' ? body.resolveKeyForDevice : '';
  if (resolve && from === 'customer' && !callerKeys(req).includes(resolve)) {
    return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  }
  const customerKey = resolve ? threadKeyForDevice(shopId, resolve) : String(body.customerKey ?? '');
  if (from === 'customer' && !resolve && !mayUseThread(req, shopId, customerKey)) {
    return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  }
  const message = sendMessage(shopId, customerKey, from, String(body.text ?? ''));
  if (!message) return NextResponse.json({ error: 'empty' }, { status: 400 });
  return NextResponse.json({ message });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const reader = body.reader === 'shop' ? 'shop' : 'customer';
  const shopId = String(body.shopId ?? '');
  const customerKey = String(body.customerKey ?? '');
  if (reader === 'shop') {
    const denied = requireShopAccess(req, shopId);
    if (denied) return denied;
  } else if (!mayUseThread(req, shopId, customerKey)) {
    return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  }
  markThreadRead(shopId, customerKey, reader);
  return NextResponse.json({ ok: true });
}
