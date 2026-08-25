/**
 * The category vocabulary, shared by company registration, the service
 * manager and the consumer feed. Companies can extend it at runtime
 * (see store.addCustomCategory) — those additions are appended to this base
 * list everywhere a picker is shown.
 */
export interface CategoryDef {
  id: string;
  emoji: string;
  en: string;
  de: string;
}

export const BASE_CATEGORIES: CategoryDef[] = [
  { id: 'hair', emoji: '💇', en: 'Hair', de: 'Haare' },
  { id: 'barber', emoji: '💈', en: 'Barber', de: 'Barbier' },
  { id: 'nails', emoji: '💅', en: 'Nails', de: 'Nägel' },
  { id: 'brows', emoji: '👁️', en: 'Brows & lashes', de: 'Brauen & Wimpern' },
  { id: 'makeup', emoji: '💄', en: 'Make-up', de: 'Make-up' },
  { id: 'skincare', emoji: '🧖', en: 'Facial & skincare', de: 'Gesicht & Hautpflege' },
  { id: 'massage', emoji: '💆', en: 'Massage & spa', de: 'Massage & Spa' },
  { id: 'waxing', emoji: '🪷', en: 'Waxing & hair removal', de: 'Waxing & Haarentfernung' },
  { id: 'tanning', emoji: '☀️', en: 'Tanning', de: 'Bräunung' },
  { id: 'tattoo', emoji: '🖋️', en: 'Tattoo & piercing', de: 'Tattoo & Piercing' },
];

export function categoryLabel(cat: CategoryDef, lang: 'en' | 'de'): string {
  return lang === 'de' ? cat.de : cat.en;
}

/** Merge the base vocabulary with the categories companies have added. */
export function allCategories(custom: Array<{ id: string; label: string }>): CategoryDef[] {
  return [
    ...BASE_CATEGORIES,
    ...custom
      .filter((c) => !BASE_CATEGORIES.some((b) => b.id === c.id))
      .map((c) => ({ id: c.id, emoji: '🏷️', en: c.label, de: c.label })),
  ];
}
