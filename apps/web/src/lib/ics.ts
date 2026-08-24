'use client';
/** Add-to-calendar: build an .ics data URI for a confirmed booking. */

function icsDate(epoch: number): string {
  return new Date(epoch).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function icsHref(params: {
  reference: string;
  title: string;
  location: string;
  startsAt: number;
  endsAt: number;
}): string {
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StyleNow//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${params.reference}@stylenow`,
    `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsDate(params.startsAt)}`,
    `DTEND:${icsDate(params.endsAt)}`,
    `SUMMARY:${params.title.replace(/[,;]/g, ' ')}`,
    `LOCATION:${params.location.replace(/[,;]/g, ' ')}`,
    `DESCRIPTION:Booking ${params.reference}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}
