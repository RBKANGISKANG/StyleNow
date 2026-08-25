/**
 * Offline gazetteer for the launch city. Resolves what people actually type
 * into a location box — a district name or a postal code — to coordinates,
 * with no external geocoding dependency (works offline / in the PWA).
 * Browser GPS (navigator.geolocation) complements it for "use my location".
 */
export interface GeoPoint {
  lat: number;
  lng: number;
}

interface GazetteerEntry extends GeoPoint {
  name: string;
  aliases: string[];
  /** 4-digit postal prefixes covering the district (Berlin PLZ 10115–14199) */
  zipPrefixes: string[];
}

export const BERLIN_GAZETTEER: GazetteerEntry[] = [
  { name: 'Mitte', aliases: ['mitte'], zipPrefixes: ['1011', '1017', '1018'], lat: 52.5200, lng: 13.4050 },
  { name: 'Prenzlauer Berg', aliases: ['prenzlauer berg', 'prenzlberg', 'pberg'], zipPrefixes: ['1040', '1043'], lat: 52.5409, lng: 13.4123 },
  { name: 'Kreuzberg', aliases: ['kreuzberg', 'xberg'], zipPrefixes: ['1096', '1099'], lat: 52.4996, lng: 13.4033 },
  { name: 'Friedrichshain', aliases: ['friedrichshain', 'fhain'], zipPrefixes: ['1024'], lat: 52.5158, lng: 13.4540 },
  { name: 'Neukölln', aliases: ['neukolln', 'neukoelln', 'neukölln'], zipPrefixes: ['1204', '1205'], lat: 52.4811, lng: 13.4353 },
  { name: 'Charlottenburg', aliases: ['charlottenburg'], zipPrefixes: ['1058', '1062'], lat: 52.5163, lng: 13.3042 },
  { name: 'Schöneberg', aliases: ['schoneberg', 'schoeneberg', 'schöneberg'], zipPrefixes: ['1077', '1078', '1082'], lat: 52.4867, lng: 13.3565 },
  { name: 'Wedding', aliases: ['wedding'], zipPrefixes: ['1334', '1335'], lat: 52.5502, lng: 13.3439 },
  { name: 'Moabit', aliases: ['moabit'], zipPrefixes: ['1055'], lat: 52.5300, lng: 13.3420 },
  { name: 'Tempelhof', aliases: ['tempelhof'], zipPrefixes: ['1209', '1210'], lat: 52.4700, lng: 13.3859 },
  { name: 'Steglitz', aliases: ['steglitz'], zipPrefixes: ['1216', '1220'], lat: 52.4562, lng: 13.3320 },
  { name: 'Wilmersdorf', aliases: ['wilmersdorf'], zipPrefixes: ['1071', '1419'], lat: 52.4870, lng: 13.3200 },
  { name: 'Pankow', aliases: ['pankow'], zipPrefixes: ['1312', '1318'], lat: 52.5692, lng: 13.4019 },
  { name: 'Lichtenberg', aliases: ['lichtenberg'], zipPrefixes: ['1035'], lat: 52.5156, lng: 13.4990 },
  { name: 'Treptow', aliases: ['treptow'], zipPrefixes: ['1243', '1245'], lat: 52.4937, lng: 13.4573 },
  { name: 'Spandau', aliases: ['spandau'], zipPrefixes: ['1358', '1359'], lat: 52.5361, lng: 13.2028 },
  { name: 'Zehlendorf', aliases: ['zehlendorf'], zipPrefixes: ['1416'], lat: 52.4340, lng: 13.2591 },
  { name: 'Reinickendorf', aliases: ['reinickendorf'], zipPrefixes: ['1340', '1343'], lat: 52.5900, lng: 13.3300 },
  { name: 'Marzahn', aliases: ['marzahn'], zipPrefixes: ['1267', '1268'], lat: 52.5450, lng: 13.5650 },
  { name: 'Köpenick', aliases: ['kopenick', 'koepenick', 'köpenick'], zipPrefixes: ['1255', '1257'], lat: 52.4457, lng: 13.5748 },
];

/** District name or postal code → point; null when nothing matches. */
export function resolveLocation(input: string): (GeoPoint & { label: string }) | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  if (/^\d{4,5}$/.test(q)) {
    const prefix = q.slice(0, 4);
    const hit = BERLIN_GAZETTEER.find((e) => e.zipPrefixes.some((z) => prefix.startsWith(z) || z.startsWith(prefix)));
    if (hit) return { lat: hit.lat, lng: hit.lng, label: `${q} · ${hit.name}` };
    return null;
  }
  const hit = BERLIN_GAZETTEER.find((e) => e.aliases.some((a) => a.includes(q) || q.includes(a)));
  return hit ? { lat: hit.lat, lng: hit.lng, label: hit.name } : null;
}
