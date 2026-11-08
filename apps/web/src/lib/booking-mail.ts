/**
 * What people hear about a booking: confirmation, day-before reminder,
 * cancellation and moves for the guest; a "new booking" alert for the salon.
 * Server only. Started once from instrumentation.ts.
 */
import {
  accountByEmail,
  bookingsDueReminder,
  markReminded,
  onBookingEvent,
  shopById,
  shopContactEmail,
  type Booking,
  type BookingEvent,
} from '@/core/store';
import { sendEmail, sendSms, siteOrigin } from './notify';
import { pushBookingEvent } from './push-events';

const REMINDER_EVERY_MS = Number(process.env.STYLENOW_REMINDER_TICK_MS) || 5 * 60e3;
/** How long before the visit the reminder goes out (default 24 h). */
const REMINDER_HOURS = Number(process.env.STYLENOW_REMINDER_HOURS) || 24;

function lang(b: Booking): 'de' | 'en' {
  const pref = b.guestEmail ? accountByEmail(b.guestEmail)?.profile.preferredLanguage : undefined;
  return pref === 'en' ? 'en' : 'de';
}

function when(b: Booking, l: 'de' | 'en'): string {
  return new Date(b.startsAt).toLocaleString(l === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
}

const eur = (c: number, l: 'de' | 'en') => new Intl.NumberFormat(l === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(c / 100);

function texts(event: BookingEvent | 'reminder', b: Booking) {
  const l = lang(b);
  const shop = shopById(b.shopId);
  const name = shop?.name ?? 'StyleNow';
  const at = when(b, l);
  const addr = shop?.address ?? '';
  const link = `${siteOrigin()}/bookings`;
  const de = l === 'de';
  const policy = de
    ? `Kostenlos stornieren bis ${b.policySnapshot.freeUntilHours} Std. vorher.`
    : `Free cancellation until ${b.policySnapshot.freeUntilHours} h before.`;
  switch (event) {
    case 'confirmed':
      return {
        subject: de ? `Termin bestätigt: ${name}, ${at}` : `Booking confirmed: ${name}, ${at}`,
        text: de
          ? `Hallo ${b.guestName},\n\ndein Termin ist bestätigt.\n\n${name}\n${at}\n${addr}\nBuchungsnummer: ${b.reference}\nGesamt: ${eur(b.quote.totalCents, l)}\n\n${policy}\n\nDeine Termine:\n${link}`
          : `Hi ${b.guestName},\n\nyour booking is confirmed.\n\n${name}\n${at}\n${addr}\nReference: ${b.reference}\nTotal: ${eur(b.quote.totalCents, l)}\n\n${policy}\n\nYour bookings:\n${link}`,
        sms: de ? `StyleNow: Termin bestätigt bei ${name}, ${at}. Nr. ${b.reference}` : `StyleNow: booked at ${name}, ${at}. Ref ${b.reference}`,
      };
    case 'reminder':
      return {
        subject: de ? `Erinnerung: morgen bei ${name}` : `Reminder: tomorrow at ${name}`,
        text: de
          ? `Hallo ${b.guestName},\n\nkleine Erinnerung an deinen Termin:\n\n${name}\n${at}\n${addr}\n\nDu schaffst es nicht? ${policy} Bitte sag rechtzeitig ab, damit jemand anderes den Platz bekommt:\n${link}`
          : `Hi ${b.guestName},\n\na quick reminder of your appointment:\n\n${name}\n${at}\n${addr}\n\nCan't make it? ${policy} Please cancel in time so someone else can have the slot:\n${link}`,
        sms: de ? `Erinnerung: ${name}, ${at}. Absagen: ${link}` : `Reminder: ${name}, ${at}. Cancel: ${link}`,
      };
    case 'cancelled': {
      const refund = b.cancellation?.refundCents ?? 0;
      return {
        subject: de ? `Termin storniert: ${name}, ${at}` : `Booking cancelled: ${name}, ${at}`,
        text: de
          ? `Hallo ${b.guestName},\n\ndein Termin bei ${name} am ${at} wurde storniert.${refund > 0 ? `\nErstattung: ${eur(refund, l)} — sie erscheint in wenigen Tagen auf deiner Karte.` : ''}\n\nNeuen Termin buchen:\n${siteOrigin()}`
          : `Hi ${b.guestName},\n\nyour booking at ${name} on ${at} was cancelled.${refund > 0 ? `\nRefund: ${eur(refund, l)} — it reaches your card within a few days.` : ''}\n\nBook again:\n${siteOrigin()}`,
        sms: de ? `StyleNow: Termin bei ${name} (${at}) storniert.` : `StyleNow: your booking at ${name} (${at}) was cancelled.`,
      };
    }
    case 'moved':
      return {
        subject: de ? `Neue Zeit: ${name}, ${at}` : `New time: ${name}, ${at}`,
        text: de
          ? `Hallo ${b.guestName},\n\ndein Termin bei ${name} hat eine neue Zeit:\n${at}\n\nDeine Termine:\n${link}`
          : `Hi ${b.guestName},\n\nyour booking at ${name} has a new time:\n${at}\n\nYour bookings:\n${link}`,
        sms: de ? `StyleNow: neue Zeit bei ${name}: ${at}` : `StyleNow: new time at ${name}: ${at}`,
      };
  }
}

/** Every guest email carries a quiet "own a business? join free" line. */
function poweredBy(b: Booking): string {
  const de = lang(b) === 'de';
  const url = `${siteOrigin()}/partner?utm_source=email`;
  return de
    ? `\n\n—\nGebucht mit StyleNow. Eigenes Studio oder eigener Salon? 12 Monate ohne Provision starten:\n${url}`
    : `\n\n—\nBooked with StyleNow. Own a salon or studio? Start with 12 months commission-free:\n${url}`;
}

async function tellGuest(event: BookingEvent | 'reminder', b: Booking): Promise<boolean> {
  const t = texts(event, b);
  let sent = false;
  if (b.guestEmail) sent = (await sendEmail(b.guestEmail, t.subject, `${t.text}${poweredBy(b)}`)) || sent;
  // SMS only for the two that prevent no-shows, so the salon's SMS bill stays small.
  if (b.guestPhone && (event === 'reminder' || event === 'confirmed')) sent = (await sendSms(b.guestPhone, t.sms)) || sent;
  return sent;
}

async function tellShop(event: BookingEvent, b: Booking): Promise<void> {
  const to = shopContactEmail(b.shopId);
  if (!to) return;
  const at = when(b, 'de');
  const subject =
    event === 'confirmed' ? `Neue Buchung: ${b.guestName}, ${at}` : event === 'cancelled' ? `Storniert: ${b.guestName}, ${at}` : `Verschoben: ${b.guestName}, ${at}`;
  await sendEmail(to, subject, `${subject}\nBuchungsnummer: ${b.reference}\n\nKalender öffnen:\n${siteOrigin()}/dashboard`);
}

let started = false;

export function startBookingMail(): void {
  if (started) return;
  started = true;
  onBookingEvent((event, b) => {
    void tellGuest(event, b);
    void tellShop(event, b);
  });
  const tick = async () => {
    for (const b of bookingsDueReminder(Date.now(), REMINDER_HOURS * 36e5)) {
      markReminded(b.id); // first, so a slow mail server can never cause a second reminder
      pushBookingEvent('reminder', b);
      await tellGuest('reminder', b);
    }
  };
  setInterval(() => void tick(), REMINDER_EVERY_MS).unref?.();
  void tick();
}
