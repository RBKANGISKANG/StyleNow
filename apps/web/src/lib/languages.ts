/** Every interface language. `content` is the language shop-provided text falls back to. */
export interface UiLanguage {
  code: string;
  name: string;
  flag: string;
  content: 'en' | 'de';
}

export const UI_LANGUAGES: UiLanguage[] = [
  { code: 'de', name: 'Deutsch', flag: '🇩🇪', content: 'de' },
  { code: 'en-GB', name: 'English (UK)', flag: '🇬🇧', content: 'en' },
  { code: 'en-US', name: 'English (US)', flag: '🇺🇸', content: 'en' },
  { code: 'bg', name: 'Български', flag: '🇧🇬', content: 'en' },
  { code: 'bs', name: 'Bosanski', flag: '🇧🇦', content: 'en' },
  { code: 'cs', name: 'Čeština', flag: '🇨🇿', content: 'en' },
  { code: 'da', name: 'Dansk', flag: '🇩🇰', content: 'en' },
  { code: 'el', name: 'Ελληνικά', flag: '🇬🇷', content: 'en' },
  { code: 'es', name: 'Español', flag: '🇪🇸', content: 'en' },
  { code: 'et', name: 'Eesti', flag: '🇪🇪', content: 'en' },
  { code: 'fi', name: 'Suomi', flag: '🇫🇮', content: 'en' },
  { code: 'fr', name: 'Français', flag: '🇫🇷', content: 'en' },
  { code: 'ga', name: 'Gaeilge', flag: '🇮🇪', content: 'en' },
  { code: 'hr', name: 'Hrvatski', flag: '🇭🇷', content: 'en' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺', content: 'en' },
  { code: 'is', name: 'Íslenska', flag: '🇮🇸', content: 'en' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹', content: 'en' },
  { code: 'lt', name: 'Lietuvių', flag: '🇱🇹', content: 'en' },
  { code: 'lv', name: 'Latviešu', flag: '🇱🇻', content: 'en' },
  { code: 'mk', name: 'Македонски', flag: '🇲🇰', content: 'en' },
  { code: 'mt', name: 'Malti', flag: '🇲🇹', content: 'en' },
  { code: 'nb', name: 'Norsk', flag: '🇳🇴', content: 'en' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱', content: 'en' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱', content: 'en' },
  { code: 'pt', name: 'Português', flag: '🇵🇹', content: 'en' },
  { code: 'ro', name: 'Română', flag: '🇷🇴', content: 'en' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺', content: 'en' },
  { code: 'sk', name: 'Slovenčina', flag: '🇸🇰', content: 'en' },
  { code: 'sl', name: 'Slovenščina', flag: '🇸🇮', content: 'en' },
  { code: 'sq', name: 'Shqip', flag: '🇦🇱', content: 'en' },
  { code: 'sr', name: 'Srpski', flag: '🇷🇸', content: 'en' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪', content: 'en' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷', content: 'en' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦', content: 'en' },
];

const BY_CODE = new Map(UI_LANGUAGES.map((l) => [l.code, l]));

export function uiLanguage(code: string): UiLanguage {
  return BY_CODE.get(code) ?? BY_CODE.get('en-GB')!;
}

/** Best supported match for a browser language tag such as "fr-CA" or "en-US". */
export function matchUiLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null;
  if (BY_CODE.has(tag)) return tag;
  const base = tag.toLowerCase().split('-')[0];
  if (base === 'en') return tag.toUpperCase().endsWith('US') ? 'en-US' : 'en-GB';
  if (base === 'no' || base === 'nn') return 'nb';
  if (base === 'hr' || base === 'sr' || base === 'bs') return base;
  return BY_CODE.has(base) ? base : null;
}
