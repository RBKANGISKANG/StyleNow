/** Presentation-edge formatting. Money in minor units + EUR; shop time is Europe/Berlin. */
const TZ = 'Europe/Berlin';

export function money(cents: number, lang: 'en' | 'de'): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

export function timeOf(epoch: number, lang: 'en' | 'de'): string {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epoch));
}

export function dateOf(epoch: number, lang: 'en' | 'de'): string {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(epoch));
}

export function fullDateOf(epoch: number, lang: 'en' | 'de'): string {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epoch));
}

export function weekdayShort(isoDate: string, lang: 'en' | 'de'): string {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: TZ,
    weekday: 'short',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function dayNum(isoDate: string): string {
  return String(Number(isoDate.slice(8, 10)));
}

export function distance(m: number, lang: 'en' | 'de'): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1).replace('.', lang === 'de' ? ',' : '.')} km`;
}

export function monthShort(isoDate: string, lang: 'en' | 'de'): string {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: TZ,
    month: 'short',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

/** Weekday name from an ISO weekday number (1 = Monday). 2024-01-01 was a Monday. */
export function weekdayName(dow: number, lang: 'en' | 'de', style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: 'UTC',
    weekday: style,
  }).format(new Date(Date.UTC(2024, 0, dow)));
}

/** Minute-of-day as a clock time. Opening hours are stored as minutes, not instants. */
export function hhmm(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
}
