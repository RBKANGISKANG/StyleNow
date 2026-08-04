/**
 * Timezone helpers. Convention (see root README): epoch-ms everywhere in the
 * domain, local time only at the presentation edge, derived from shop.timezone.
 * All demo shops are Europe/Berlin.
 */
const TZ = 'Europe/Berlin';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parts(epoch: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(new Date(epoch))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset east of UTC in ms at the given instant. */
function offsetAt(epoch: number): number {
  const p = parts(epoch);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(epoch / 1000) * 1000;
}

/** Epoch of local midnight for a YYYY-MM-DD date in the shop timezone. */
export function dayStart(isoDate: string): number {
  const guess = Date.parse(`${isoDate}T00:00:00Z`);
  const once = guess - offsetAt(guess);
  return guess - offsetAt(once); // second pass handles DST-transition midnights
}

export function isoDateOf(epoch: number): string {
  const p = parts(epoch);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** ISO day of week, 1 = Monday … 7 = Sunday. */
export function isoDow(epoch: number): number {
  const p = parts(epoch);
  const jsDow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return jsDow === 0 ? 7 : jsDow;
}

export function minuteOfDay(epoch: number): number {
  const p = parts(epoch);
  return (p.hour % 24) * 60 + p.minute;
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return isoDateOf(Date.now());
}
