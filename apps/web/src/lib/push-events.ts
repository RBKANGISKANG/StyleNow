/**
 * Which event becomes which push, for whom. Server only; started once from
 * instrumentation.ts next to the booking emails.
 */
import {
  customerDevicesForKey,
  onBookingEvent,
  onMessageEvent,
  shopById,
  shopNotifyKeys,
  type Booking,
  type BookingEvent,
} from '@/core/store';
import { pushTo, type PushMessage } from './push';

const de = (l: string) => l !== 'en';

function when(b: Booking, l: string): string {
  return new Date(b.startsAt).toLocaleString(de(l) ? 'de-DE' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
}

/** Bookings made by the business itself (walk-ins, phone) carry a shop: device. */
const customerOwners = (b: Booking) => (b.deviceId.startsWith('shop:') ? [] : [b.deviceId]);

export function pushBookingEvent(event: BookingEvent | 'reminder', b: Booking): void {
  const shop = shopById(b.shopId)?.name ?? 'StyleNow';
  const tag = `bk-${b.id}`;
  const guest = (l: string): PushMessage => {
    const at = when(b, l);
    const d = de(l);
    switch (event) {
      case 'confirmed':
        return { title: d ? `Termin bestätigt ✅` : 'Booking confirmed ✅', body: `${shop} · ${at}`, url: '/bookings', tag };
      case 'cancelled':
        return { title: d ? 'Termin storniert' : 'Booking cancelled', body: `${shop} · ${at}`, url: '/bookings', tag };
      case 'moved':
        return { title: d ? 'Termin verschoben' : 'Booking moved', body: `${shop} · ${at}`, url: '/bookings', tag };
      default:
        return { title: d ? `Morgen: ${shop}` : `Tomorrow: ${shop}`, body: d ? `${at} · Schaffst du es nicht? Bitte rechtzeitig absagen.` : `${at} · Can't make it? Please cancel in time.`, url: '/bookings', tag };
    }
  };
  void pushTo(customerOwners(b), event === 'reminder' ? 'reminders' : 'bookings', guest);
  if (event === 'reminder') return;
  void pushTo(shopNotifyKeys(b.shopId), 'bookings', (l) => {
    const at = when(b, l);
    const d = de(l);
    const title =
      event === 'confirmed' ? (d ? '📅 Neue Buchung' : '📅 New booking') : event === 'cancelled' ? (d ? '❌ Storniert' : '❌ Cancelled') : d ? '🔁 Verschoben' : '🔁 Moved';
    return { title, body: `${b.guestName} · ${at}`, url: '/dashboard', tag };
  });
}

export function startPushEvents(): void {
  const g = globalThis as typeof globalThis & { __stylenowPushStarted?: boolean };
  if (g.__stylenowPushStarted) return;
  g.__stylenowPushStarted = true;
  onBookingEvent((event, b) => pushBookingEvent(event, b));
  onMessageEvent((shopId, customerKey, msg) => {
    const shop = shopById(shopId)?.name ?? 'StyleNow';
    const text = msg.text.length > 120 ? `${msg.text.slice(0, 117)}…` : msg.text;
    if (msg.from === 'shop') {
      void pushTo(customerDevicesForKey(shopId, customerKey), 'messages', () => ({ title: `💬 ${shop}`, body: text, url: '/messages', tag: `msg-${shopId}` }));
    } else {
      void pushTo(shopNotifyKeys(shopId), 'messages', (l) => ({ title: de(l) ? '💬 Neue Nachricht' : '💬 New message', body: text, url: '/dashboard', tag: `msg-${shopId}-${customerKey}` }));
    }
  });
}
