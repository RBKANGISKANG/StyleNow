'use client';
/**
 * Add-to-calendar for a confirmed booking.
 *
 * This is the closest thing to a reminder this product can honestly offer: a
 * static site has no server, so it can never push a notification. What it can
 * do is hand the appointment to the calendar the customer already carries —
 * which then alarms them the day before and again on the morning, survives
 * clearing site data, and shows up on their watch. Better than a push we
 * cannot send.
 *
 * The alarms are the whole point. Without VALARM this was a diary entry
 * nobody was ever told about.
 */

function icsDate(epoch: number): string {
  return new Date(epoch).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 §3.3.11: commas, semicolons and backslashes are escaped; newlines encoded. */
function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
}

/** Long lines must be folded at 75 octets, or strict parsers reject the file. */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = rest.slice(74);
  }
  parts.push(rest);
  return parts.join('\r\n ');
}

export function icsHref(params: {
  reference: string;
  title: string;
  location: string;
  startsAt: number;
  endsAt: number;
  /** shown in the calendar entry — services, stylist, what to bring */
  description?: string;
  /** deep link back into the booking */
  url?: string;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StyleNow//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${params.reference}@stylenow`,
    `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsDate(params.startsAt)}`,
    `DTEND:${icsDate(params.endsAt)}`,
    `SUMMARY:${esc(params.title)}`,
    `LOCATION:${esc(params.location)}`,
    `DESCRIPTION:${esc(params.description ?? `Booking ${params.reference}`)}`,
    ...(params.url ? [`URL:${params.url}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    // A day ahead: still time to move it or cancel for free.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-P1D',
    `DESCRIPTION:${esc(`${params.title} — tomorrow`)}`,
    'END:VALARM',
    // Two hours ahead: time to actually set off.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT2H',
    `DESCRIPTION:${esc(params.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const body = lines.map(fold).join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}
