/** Locale resolution: explicit user choice → Accept-Language → shop default → de-DE.
 *  Currency and VAT always follow the SHOP, never the user's browser. */
export const SUPPORTED_LOCALES = ['de-DE', 'en-GB', 'tr-TR', 'ar-SA'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const RTL_LOCALES: Locale[] = ['ar-SA'];
export const DEFAULT_LOCALE: Locale = 'de-DE';

export function resolveLocale(
  userChoice: string | null,
  acceptLanguage: string | null,
  shopDefault: string | null,
): Locale {
  const supported = SUPPORTED_LOCALES as readonly string[];
  const candidates = [
    userChoice,
    ...(acceptLanguage ?? '')
      .split(',')
      .map((p) => p.split(';')[0].trim())
      .filter(Boolean),
    shopDefault,
  ].filter((c): c is string => Boolean(c));

  for (const c of candidates) {
    if (supported.includes(c)) return c as Locale;
    const base = c.split('-')[0];
    const match = supported.find((s) => s.split('-')[0] === base);
    if (match) return match as Locale;
  }
  return DEFAULT_LOCALE;
}

export const isRtl = (l: Locale): boolean => RTL_LOCALES.includes(l);
