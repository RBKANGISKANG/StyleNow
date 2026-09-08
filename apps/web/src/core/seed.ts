/**
 * Demo dataset — nine Berlin shops with staff, shifts, services, pricing rules
 * and reviews. Deterministic so the experience is stable between restarts.
 *
 * In production this data lives in Postgres (db/migrations); the web app talks
 * to the API described in apps/api/openapi.yaml. The demo store keeps the same
 * shapes so swapping the transport is mechanical.
 */
import type { ShopBookingRules } from '@stylenow/api/domain/availability';
import type { PricingRule } from '@stylenow/api/domain/pricing';

export interface LocalText {
  en: string;
  de: string;
}

export interface SeedService {
  id: string;
  emoji: string;
  /** Category this service belongs to (base vocabulary or a company-added one). */
  categoryId?: string;
  name: LocalText;
  durationMin: number;
  processingGapMin: number;
  finishMin: number;
  basePriceCents: number;
  vatRateBps: number;
  dynamicPricing: boolean;
  popular?: boolean;
  /** Colour/chemical services: a patch test within the last 6 months is expected. */
  requiresPatchTest?: boolean;
  /** Complex treatments: a short consultation should come before the first booking. */
  consultationFirst?: boolean;
  /** The bottleneck this service occupies besides the stylist, if any.
   *  null is an explicit "none" (a shop override clearing a seeded marker) —
   *  unlike undefined it survives JSON persistence. */
  resource?: 'basin' | 'colour' | null;
  /** Tattoos, piercings: not bookable for minors at all, guardian or not. */
  adultsOnly?: boolean;
}

export interface SeedStaff {
  id: string;
  name: string;
  role: LocalText;
  tier: 'senior' | 'stylist';
  /** working windows in local minutes, keyed by ISO dow (1 = Monday … 7 = Sunday) */
  shifts: Partial<Record<number, Array<{ startMin: number; endMin: number }>>>;
}

export interface SeedReview {
  author: string;
  rating: number;
  text: LocalText;
  service: string;
  date: string;
}

export interface SeedShop {
  id: string;
  slug: string;
  name: string;
  category: 'hair' | 'barber' | 'nails' | 'brows' | 'mobile' | 'spa' | 'makeup' | 'tattoo' | 'physio' | 'kids';
  tagline: LocalText;
  about: LocalText;
  address: string;
  district: string;
  lat: number;
  lng: number;
  gradient: [string, string];
  emoji: string;
  languagesSpoken: string[];
  ratingAvg: number;
  ratingCount: number;
  isNew: boolean;
  isMobile: boolean;
  /** Built for children: play corner, patient staff, the explore filter. */
  kidsFriendly?: boolean;
  /** VIP/concierge tier: premium service level, priced accordingly. */
  premium?: boolean;
  chainId: string | null;
  tags: string[];
  /** cosine similarity of the shop embedding to the demo user's taste vector */
  semanticSimilarity: number;
  cancellationRate: number;
  rules: ShopBookingRules;
  depositPercent: number;
  policy: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  timezone: string;
  services: SeedService[];
  staff: SeedStaff[];
  pricingRules: PricingRule[];
  reviews: SeedReview[];
}

const week = (windows: Array<{ startMin: number; endMin: number }>, dows: number[]) =>
  Object.fromEntries(dows.map((d) => [d, windows]));

const STANDARD_RULES: ShopBookingRules = {
  slotGranularityMin: 15,
  bufferBeforeMin: 0,
  bufferAfterMin: 10,
  bookingLeadMin: 60,
  bookingHorizonDays: 62,
};

const h = (n: number, m = 0) => n * 60 + m;

export const USER_LOCATION = { lat: 52.5409, lng: 13.4123 }; // Prenzlauer Berg

export const SHOPS: SeedShop[] = [
  {
    id: 'shop-chroma-mitte',
    slug: 'chroma-studio-mitte',
    name: 'Chroma Studio Mitte',
    category: 'hair',
    tagline: {
      en: 'Colour specialists in the heart of Mitte',
      de: 'Farbspezialisten im Herzen von Mitte',
    },
    about: {
      en: 'Balayage, vivids and precision cuts. Our colourists train in London and Copenhagen, and every service starts with a 10-minute consultation.',
      de: 'Balayage, kräftige Farben und Präzisionsschnitte. Unsere Coloristen bilden sich in London und Kopenhagen fort — jeder Termin beginnt mit einer 10-minütigen Beratung.',
    },
    address: 'Torstraße 112, 10119 Berlin',
    district: 'Mitte',
    lat: 52.5291,
    lng: 13.4022,
    gradient: ['#5c4b8a', '#b4552d'],
    emoji: '🎨',
    languagesSpoken: ['de', 'en'],
    ratingAvg: 4.8,
    ratingCount: 214,
    isNew: false,
    isMobile: false,
    chainId: 'chain-chroma',
    tags: ['balayage', 'colour', 'cut', 'vegan-products'],
    semanticSimilarity: 0.87,
    cancellationRate: 0.03,
    rules: STANDARD_RULES,
    depositPercent: 20,
    policy: { freeUntilHours: 24, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-cm-cut', emoji: '✂️', name: { en: 'Cut & Finish', de: 'Schnitt & Styling' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 6500, vatRateBps: 1900, dynamicPricing: true, popular: true },
      { id: 'svc-cm-wcb', emoji: '🚿', name: { en: 'Wash, Cut & Blow-dry', de: 'Waschen, Schneiden & Föhnen' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 7800, vatRateBps: 1900, resource: 'basin', dynamicPricing: true },
      { id: 'svc-cm-balayage', emoji: '🎨', name: { en: 'Balayage & Gloss', de: 'Balayage & Gloss' }, durationMin: 40, processingGapMin: 45, finishMin: 35, basePriceCents: 18900, vatRateBps: 1900, dynamicPricing: true, requiresPatchTest: true, resource: 'colour', consultationFirst: true },
      { id: 'svc-cm-highlights', emoji: '✨', name: { en: 'Full Head Highlights', de: 'Komplette Foliensträhnen' }, durationMin: 40, processingGapMin: 45, finishMin: 35, basePriceCents: 15900, vatRateBps: 1900, dynamicPricing: true, requiresPatchTest: true, resource: 'colour', consultationFirst: true },
      { id: 'svc-cm-roots', emoji: '🧴', name: { en: 'Root Colour', de: 'Ansatzfarbe' }, durationMin: 30, processingGapMin: 35, finishMin: 25, basePriceCents: 9800, vatRateBps: 1900, dynamicPricing: true, requiresPatchTest: true, resource: 'colour' },
      { id: 'svc-cm-toner', emoji: '🫧', name: { en: 'Toner & Gloss Refresh', de: 'Toner & Gloss-Auffrischung' }, durationMin: 20, processingGapMin: 20, finishMin: 20, basePriceCents: 7400, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-cm-olaplex', emoji: '💧', name: { en: 'Olaplex Bond Treatment', de: 'Olaplex-Aufbaukur' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 4900, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-cm-blowdry', emoji: '💨', name: { en: 'Blow-dry & Style', de: 'Föhnen & Stylen' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 3900, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-cm-lena', name: 'Lena K.', role: { en: 'Senior Colourist', de: 'Senior-Coloristin' }, tier: 'senior', shifts: { ...week([{ startMin: h(9), endMin: h(18) }], [1, 2, 3, 4, 5]), 6: [{ startMin: h(10), endMin: h(16) }] } },
      { id: 'st-cm-yusuf', name: 'Yusuf A.', role: { en: 'Stylist', de: 'Stylist' }, tier: 'stylist', shifts: { ...week([{ startMin: h(10), endMin: h(20) }], [2, 3, 4, 5]), 6: [{ startMin: h(10), endMin: h(18) }] } },
      { id: 'st-cm-marta', name: 'Marta S.', role: { en: 'Stylist', de: 'Stylistin' }, tier: 'stylist', shifts: week([{ startMin: h(9), endMin: h(17) }], [1, 3, 4, 5, 6]) },
    ],
    pricingRules: [
      { id: 'pr-cm-happy', kind: 'time_of_day', name: 'Morning happy hour −15 %', dows: [2, 3], minuteOfDayFrom: h(9), minuteOfDayTo: h(12), adjustKind: 'percent', adjustValue: -15, priority: 10, stackable: false },
      { id: 'pr-cm-sat', kind: 'day_of_week', name: 'Saturday peak +10 %', dows: [6], minuteOfDayFrom: h(11), minuteOfDayTo: h(16), adjustKind: 'percent', adjustValue: 10, priority: 8, stackable: false },
      // The chair everyone wants: straight after work, midweek. Peak pricing
      // only existed on Saturday lunchtime before, which made the prime tier
      // something most customers would never meet.
      { id: 'pr-cm-eve', kind: 'time_of_day', name: 'After-work prime +12 %', dows: [2, 3, 4, 5], minuteOfDayFrom: h(17), minuteOfDayTo: h(20), adjustKind: 'percent', adjustValue: 12, priority: 8, stackable: false },
      { id: 'pr-cm-lastmin', kind: 'last_minute', name: 'Last-minute −20 %', leadHoursMax: 3, adjustKind: 'percent', adjustValue: -20, priority: 12, stackable: false },
    ],
    reviews: [
      { author: 'Annika', rating: 5, text: { en: 'Lena understood exactly what I wanted — best balayage I have ever had.', de: 'Lena hat genau verstanden, was ich wollte — die beste Balayage, die ich je hatte.' }, service: 'Balayage & Gloss', date: '2026-07-18' },
      { author: 'Tom', rating: 5, text: { en: 'Booked at 11:00, sat in the chair at 14:30 the same day. Great cut.', de: 'Um 11 Uhr gebucht, um 14:30 saß ich schon auf dem Stuhl. Toller Schnitt.' }, service: 'Cut & Finish', date: '2026-07-02' },
      { author: 'Sofia', rating: 4, text: { en: 'Lovely space, fair prices with the morning discount.', de: 'Schöner Laden, faire Preise mit dem Vormittagsrabatt.' }, service: 'Root Colour', date: '2026-06-21' },
    ],
  },
  {
    id: 'shop-chroma-xberg',
    slug: 'chroma-studio-kreuzberg',
    name: 'Chroma Studio Kreuzberg',
    category: 'hair',
    tagline: { en: 'Bold colour on Oranienstraße', de: 'Mutige Farben in der Oranienstraße' },
    about: {
      en: 'The loudest branch of the Chroma family. Vivids, creative colour and undercuts — walk out different.',
      de: 'Die lauteste Filiale der Chroma-Familie. Vivids, kreative Farben und Undercuts — geh anders raus, als du reingekommen bist.',
    },
    address: 'Oranienstraße 34, 10999 Berlin',
    district: 'Kreuzberg',
    lat: 52.5012,
    lng: 13.4183,
    gradient: ['#c31432', '#240b36'],
    emoji: '🌈',
    languagesSpoken: ['de', 'en', 'tr'],
    ratingAvg: 4.7,
    ratingCount: 156,
    isNew: false,
    isMobile: false,
    chainId: 'chain-chroma',
    tags: ['vivids', 'colour', 'undercut', 'queer-friendly'],
    semanticSimilarity: 0.74,
    cancellationRate: 0.05,
    rules: STANDARD_RULES,
    depositPercent: 20,
    policy: { freeUntilHours: 24, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-cx-vivid', emoji: '🦩', name: { en: 'Creative Colour (Vivids)', de: 'Kreativfarbe (Vivids)' }, durationMin: 60, processingGapMin: 40, finishMin: 30, basePriceCents: 21500, vatRateBps: 1900, dynamicPricing: true, popular: true },
      { id: 'svc-cx-bleach', emoji: '⚪', name: { en: 'Bleach & Tone', de: 'Blondierung & Tönung' }, durationMin: 50, processingGapMin: 45, finishMin: 30, basePriceCents: 16900, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-cx-refresh', emoji: '🌈', name: { en: 'Colour Refresh', de: 'Farb-Auffrischung' }, durationMin: 30, processingGapMin: 30, finishMin: 25, basePriceCents: 8900, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-cx-cut', emoji: '✂️', name: { en: 'Cut & Finish', de: 'Schnitt & Styling' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 5900, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-cx-undercut', emoji: '⚡', name: { en: 'Undercut & Design', de: 'Undercut & Design' }, durationMin: 40, processingGapMin: 0, finishMin: 0, basePriceCents: 4900, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-cx-nio', name: 'Nio', role: { en: 'Creative Director', de: 'Creative Director' }, tier: 'senior', shifts: week([{ startMin: h(11), endMin: h(20) }], [2, 3, 4, 5, 6]) },
      { id: 'st-cx-ash', name: 'Ash', role: { en: 'Colourist', de: 'Colorist:in' }, tier: 'stylist', shifts: week([{ startMin: h(10), endMin: h(19) }], [1, 2, 4, 5, 6]) },
    ],
    pricingRules: [
      { id: 'pr-cx-lastmin', kind: 'last_minute', name: 'Last-minute −20 %', leadHoursMax: 3, adjustKind: 'percent', adjustValue: -20, priority: 12, stackable: false },
      { id: 'pr-cx-busy', kind: 'occupancy', name: 'High-demand day +10 %', occupancyMinPct: 80, adjustKind: 'percent', adjustValue: 10, priority: 9, stackable: false },
    ],
    reviews: [
      { author: 'Deniz', rating: 5, text: { en: 'Nio turned my hair into art. Turquoise fade, three weeks and still glowing.', de: 'Nio hat aus meinen Haaren Kunst gemacht. Türkiser Verlauf, nach drei Wochen noch strahlend.' }, service: 'Creative Colour', date: '2026-07-25' },
      { author: 'Kim', rating: 4, text: { en: 'Great vibe, decent prices. Book ahead — Saturdays are packed.', de: 'Super Stimmung, faire Preise. Früh buchen — samstags ist es voll.' }, service: 'Undercut & Design', date: '2026-07-11' },
    ],
  },
  {
    id: 'shop-chroma-nk',
    slug: 'chroma-studio-neukoelln',
    name: 'Chroma Studio Neukölln',
    category: 'hair',
    tagline: { en: 'The neighbourhood colour bar', de: 'Die Farb-Bar im Kiez' },
    about: {
      en: 'Small, warm, and honest. Two chairs, great coffee, and colourists who tell you when NOT to bleach.',
      de: 'Klein, warm und ehrlich. Zwei Stühle, guter Kaffee und Coloristen, die dir auch sagen, wann du NICHT blondieren solltest.',
    },
    address: 'Weserstraße 51, 12045 Berlin',
    district: 'Neukölln',
    lat: 52.4863,
    lng: 13.4441,
    gradient: ['#606c88', '#3f4c6b'],
    emoji: '☕',
    languagesSpoken: ['de', 'en', 'ar'],
    ratingAvg: 4.6,
    ratingCount: 88,
    isNew: false,
    isMobile: false,
    chainId: 'chain-chroma',
    tags: ['colour', 'cut', 'cosy'],
    semanticSimilarity: 0.69,
    cancellationRate: 0.04,
    rules: { ...STANDARD_RULES, slotGranularityMin: 30 },
    depositPercent: 0,
    policy: { freeUntilHours: 12, lateFeePercent: 30, noShowFeePercent: 80 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-cn-cut', emoji: '✂️', name: { en: 'Cut & Finish', de: 'Schnitt & Styling' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 5200, vatRateBps: 1900, dynamicPricing: false, popular: true },
      { id: 'svc-cn-wash', emoji: '💨', name: { en: 'Wash & Blow-dry', de: 'Waschen & Föhnen' }, durationMin: 40, processingGapMin: 0, finishMin: 0, basePriceCents: 3500, vatRateBps: 1900, resource: 'basin', dynamicPricing: false },
      { id: 'svc-cn-gloss', emoji: '✨', name: { en: 'Gloss Refresh', de: 'Gloss-Auffrischung' }, durationMin: 25, processingGapMin: 20, finishMin: 20, basePriceCents: 7400, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-cn-fringe', emoji: '💇', name: { en: 'Fringe Trim (15 min)', de: 'Pony nachschneiden (15 Min.)' }, durationMin: 15, processingGapMin: 0, finishMin: 0, basePriceCents: 1500, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-cn-omar', name: 'Omar', role: { en: 'Owner & Stylist', de: 'Inhaber & Stylist' }, tier: 'senior', shifts: week([{ startMin: h(10), endMin: h(18) }], [1, 2, 3, 4, 5]) },
      { id: 'st-cn-jule', name: 'Jule', role: { en: 'Stylist', de: 'Stylistin' }, tier: 'stylist', shifts: week([{ startMin: h(11), endMin: h(19) }], [3, 4, 5, 6]) },
    ],
    pricingRules: [],
    reviews: [
      { author: 'Aylin', rating: 5, text: { en: 'Omar talked me out of bleach and into a gloss. Hair has never felt healthier.', de: 'Omar hat mir vom Blondieren abgeraten und zum Gloss geraten. Meine Haare waren nie gesünder.' }, service: 'Gloss Refresh', date: '2026-07-20' },
    ],
  },
  {
    id: 'shop-atelier-luma',
    slug: 'atelier-luma',
    name: 'Atelier Luma',
    category: 'hair',
    tagline: { en: 'Quiet luxury for your hair', de: 'Stille Eleganz für dein Haar' },
    about: {
      en: 'An appointment at Luma is ninety minutes of calm: single-chair privacy, sulfate-free everything, and a stylist who remembers how you take your tea.',
      de: 'Ein Termin bei Luma bedeutet neunzig Minuten Ruhe: ein einzelner Stuhl, alles sulfatfrei und eine Stylistin, die sich merkt, wie du deinen Tee trinkst.',
    },
    address: 'Rykestraße 18, 10405 Berlin',
    district: 'Prenzlauer Berg',
    lat: 52.5372,
    lng: 13.4197,
    gradient: ['#d1913c', '#ffd194'],
    emoji: '🕯️',
    languagesSpoken: ['de', 'en'],
    ratingAvg: 4.9,
    ratingCount: 97,
    isNew: false,
    isMobile: false,
    chainId: null,
    tags: ['premium', 'organic', 'cut', 'quiet'],
    semanticSimilarity: 0.91,
    cancellationRate: 0.01,
    rules: { ...STANDARD_RULES, bufferAfterMin: 15, bookingLeadMin: 120 },
    depositPercent: 30,
    policy: { freeUntilHours: 48, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-al-signature', emoji: '🌿', name: { en: 'Signature Cut Ritual', de: 'Signature-Schnitt-Ritual' }, durationMin: 75, processingGapMin: 0, finishMin: 0, basePriceCents: 12500, vatRateBps: 1900, dynamicPricing: false, popular: true },
      { id: 'svc-al-silent', emoji: '🤫', name: { en: 'Silent Appointment Cut', de: 'Stiller Termin — Schnitt' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 11000, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-al-colour', emoji: '🍂', name: { en: 'Botanical Colour', de: 'Pflanzenfarbe' }, durationMin: 45, processingGapMin: 50, finishMin: 30, basePriceCents: 16800, vatRateBps: 1900, dynamicPricing: false, requiresPatchTest: true, resource: 'colour' },
      { id: 'svc-al-treatment', emoji: '💧', name: { en: 'Deep Repair Treatment', de: 'Intensiv-Repair-Kur' }, durationMin: 40, processingGapMin: 0, finishMin: 0, basePriceCents: 8900, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-al-bridal', emoji: '👰', name: { en: 'Bridal Hair Trial', de: 'Brautfrisur-Probetermin' }, durationMin: 90, processingGapMin: 0, finishMin: 0, basePriceCents: 15000, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-al-clara', name: 'Clara V.', role: { en: 'Founder', de: 'Gründerin' }, tier: 'senior', shifts: week([{ startMin: h(10), endMin: h(19) }], [2, 3, 4, 5, 6]) },
    ],
    pricingRules: [],
    reviews: [
      { author: 'Henrike', rating: 5, text: { en: 'Worth every cent. The quietest 90 minutes of my month.', de: 'Jeden Cent wert. Die ruhigsten 90 Minuten meines Monats.' }, service: 'Signature Cut Ritual', date: '2026-07-28' },
      { author: 'Paul', rating: 5, text: { en: 'Clara is a perfectionist in the best way.', de: 'Clara ist Perfektionistin im besten Sinne.' }, service: 'Signature Cut Ritual', date: '2026-06-30' },
    ],
  },
  {
    id: 'shop-fadehouse',
    slug: 'fadehouse-barbers',
    name: 'Fadehouse Barbers',
    category: 'barber',
    tagline: { en: 'Skin fades, hot towels, no small talk required', de: 'Skin Fades, heiße Tücher, Smalltalk optional' },
    about: {
      en: 'Four chairs, vinyl on the turntable, and the sharpest fades in Friedrichshain. Beard work with a straight razor and a hot towel, always.',
      de: 'Vier Stühle, Vinyl auf dem Plattenteller und die schärfsten Fades in Friedrichshain. Bartpflege immer mit Rasiermesser und heißem Tuch.',
    },
    address: 'Boxhagener Straße 74, 10245 Berlin',
    district: 'Friedrichshain',
    lat: 52.5091,
    lng: 13.4612,
    gradient: ['#232526', '#414345'],
    emoji: '💈',
    languagesSpoken: ['de', 'en', 'tr'],
    ratingAvg: 4.7,
    ratingCount: 302,
    isNew: false,
    isMobile: false,
    chainId: null,
    tags: ['fade', 'beard', 'razor', 'walk-in-friendly'],
    semanticSimilarity: 0.55,
    cancellationRate: 0.06,
    rules: { ...STANDARD_RULES, slotGranularityMin: 20, bufferAfterMin: 5, bookingLeadMin: 30 },
    depositPercent: 0,
    policy: { freeUntilHours: 6, lateFeePercent: 30, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-fh-fade', emoji: '💈', name: { en: 'Skin Fade', de: 'Skin Fade' }, durationMin: 40, processingGapMin: 0, finishMin: 0, basePriceCents: 3800, vatRateBps: 1900, dynamicPricing: true, popular: true },
      { id: 'svc-fh-classic', emoji: '✂️', name: { en: 'Classic Cut', de: 'Klassischer Herrenschnitt' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 3200, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-fh-beard', emoji: '🪒', name: { en: 'Beard Sculpt & Hot Towel', de: 'Bart-Konturen & heißes Tuch' }, durationMin: 25, processingGapMin: 0, finishMin: 0, basePriceCents: 2600, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-fh-combo', emoji: '🔥', name: { en: 'Fade + Beard Combo', de: 'Fade + Bart Kombi' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 5900, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-fh-shave', emoji: '🧖', name: { en: 'Head Shave & Hot Towel', de: 'Glatzenrasur & heißes Tuch' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 3500, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-fh-kids', emoji: '🧒', name: { en: 'Kids Cut (u12)', de: 'Kinderschnitt (u12)' }, durationMin: 25, processingGapMin: 0, finishMin: 0, basePriceCents: 2200, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-fh-emre', name: 'Emre', role: { en: 'Master Barber', de: 'Master Barber' }, tier: 'senior', shifts: week([{ startMin: h(10), endMin: h(20) }], [1, 2, 3, 4, 5, 6]) },
      { id: 'st-fh-luca', name: 'Luca', role: { en: 'Barber', de: 'Barber' }, tier: 'stylist', shifts: week([{ startMin: h(9), endMin: h(18) }], [1, 2, 3, 4, 5]) },
      { id: 'st-fh-said', name: 'Said', role: { en: 'Barber', de: 'Barber' }, tier: 'stylist', shifts: { ...week([{ startMin: h(12), endMin: h(20) }], [3, 4, 5]), 6: [{ startMin: h(10), endMin: h(20) }] } },
    ],
    pricingRules: [
      { id: 'pr-fh-rush', kind: 'time_of_day', name: 'After-work rush +8 %', dows: [4, 5], minuteOfDayFrom: h(17), minuteOfDayTo: h(20), adjustKind: 'percent', adjustValue: 8, priority: 9, stackable: false },
      { id: 'pr-fh-quiet', kind: 'time_of_day', name: 'Quiet mornings −10 %', dows: [1, 2, 3], minuteOfDayFrom: h(9), minuteOfDayTo: h(11), adjustKind: 'percent', adjustValue: -10, priority: 10, stackable: false },
    ],
    reviews: [
      { author: 'Jonas', rating: 5, text: { en: 'Emre is surgical with the razor. Best fade in the east.', de: 'Emre arbeitet chirurgisch mit dem Messer. Bester Fade im Osten.' }, service: 'Skin Fade', date: '2026-07-30' },
      { author: 'Mert', rating: 4, text: { en: 'Solid combo deal. The hot towel alone is worth it.', de: 'Starkes Kombi-Angebot. Allein das heiße Tuch lohnt sich.' }, service: 'Fade + Beard Combo', date: '2026-07-15' },
      { author: 'Chris', rating: 5, text: { en: 'Booked same-day with the morning discount. In and out in 35 minutes.', de: 'Am selben Tag mit Vormittagsrabatt gebucht. Nach 35 Minuten fertig.' }, service: 'Skin Fade', date: '2026-06-29' },
    ],
  },
  {
    id: 'shop-velvet-nails',
    slug: 'velvet-nails',
    name: 'Velvet Nails & Spa',
    category: 'nails',
    tagline: { en: 'Gel, chrome and quiet luxury in Charlottenburg', de: 'Gel, Chrome und stille Eleganz in Charlottenburg' },
    about: {
      en: 'A nail studio that runs on time. Gel, BIAB, chrome and intricate art — with a massage chair and a flat white while you wait.',
      de: 'Ein Nagelstudio, das pünktlich ist. Gel, BIAB, Chrome und filigrane Nail-Art — mit Massagesessel und Flat White während du wartest.',
    },
    address: 'Kantstraße 45, 10625 Berlin',
    district: 'Charlottenburg',
    lat: 52.5065,
    lng: 13.3092,
    gradient: ['#8e2de2', '#f7971e'],
    emoji: '💅',
    languagesSpoken: ['de', 'en'],
    ratingAvg: 4.8,
    ratingCount: 189,
    isNew: false,
    isMobile: false,
    chainId: null,
    tags: ['gel', 'nail-art', 'biab', 'pedicure'],
    semanticSimilarity: 0.62,
    cancellationRate: 0.02,
    rules: { ...STANDARD_RULES, slotGranularityMin: 30, bufferAfterMin: 10 },
    depositPercent: 20,
    policy: { freeUntilHours: 24, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-vn-gel', emoji: '💅', name: { en: 'Gel Manicure', de: 'Gel-Maniküre' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 5500, vatRateBps: 1900, dynamicPricing: true, popular: true },
      { id: 'svc-vn-classic', emoji: '🤲', name: { en: 'Classic Manicure', de: 'Klassische Maniküre' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 3900, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-vn-biab', emoji: '🛡️', name: { en: 'BIAB Overlay', de: 'BIAB-Overlay' }, durationMin: 75, processingGapMin: 0, finishMin: 0, basePriceCents: 6900, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-vn-pedi', emoji: '🦶', name: { en: 'Spa Pedicure', de: 'Spa-Pediküre' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 6200, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-vn-gelpedi', emoji: '👣', name: { en: 'Gel Pedicure', de: 'Gel-Pediküre' }, durationMin: 75, processingGapMin: 0, finishMin: 0, basePriceCents: 6900, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-vn-art', emoji: '🎨', name: { en: 'Nail Art (per set)', de: 'Nail-Art (pro Set)' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 2500, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-vn-removal', emoji: '🧼', name: { en: 'Gel Removal & Care', de: 'Gel-Entfernung & Pflege' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 2900, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-vn-mai', name: 'Mai', role: { en: 'Nail Artist', de: 'Nail-Artist' }, tier: 'senior', shifts: week([{ startMin: h(10), endMin: h(19) }], [1, 2, 3, 4, 5, 6]) },
      { id: 'st-vn-elif', name: 'Elif', role: { en: 'Nail Artist', de: 'Nail-Artist' }, tier: 'stylist', shifts: week([{ startMin: h(11), endMin: h(20) }], [2, 3, 4, 5, 6]) },
    ],
    pricingRules: [
      { id: 'pr-vn-week', kind: 'day_of_week', name: 'Weekday morning −12 %', dows: [1, 2, 3, 4], minuteOfDayFrom: h(10), minuteOfDayTo: h(13), adjustKind: 'percent', adjustValue: -12, priority: 10, stackable: false },
    ],
    reviews: [
      { author: 'Leonie', rating: 5, text: { en: 'Three weeks and not a single chip. Mai is an artist.', de: 'Drei Wochen und kein einziger Chip. Mai ist eine Künstlerin.' }, service: 'BIAB Overlay', date: '2026-07-22' },
      { author: 'Sarah', rating: 5, text: { en: 'On time, every time. The massage chair is a bonus.', de: 'Immer pünktlich. Der Massagesessel ist das i-Tüpfelchen.' }, service: 'Gel Manicure', date: '2026-07-08' },
    ],
  },
  {
    id: 'shop-browbar',
    slug: 'browbar-brigitte',
    name: 'Browbar Brigitte',
    category: 'brows',
    tagline: { en: 'Brows, lashes and lamination done right', de: 'Brauen, Wimpern und Lamination — richtig gemacht' },
    about: {
      en: 'Specialists only: brow mapping, lamination, tinting and lash lifts. Fifteen years of faces, one steady hand.',
      de: 'Nur Spezialistinnen: Brow-Mapping, Lamination, Färben und Lash Lifts. Fünfzehn Jahre Gesichter, eine ruhige Hand.',
    },
    address: 'Goltzstraße 12, 10781 Berlin',
    district: 'Schöneberg',
    lat: 52.4936,
    lng: 13.3543,
    gradient: ['#5d4157', '#a8caba'],
    emoji: '👁️',
    languagesSpoken: ['de'],
    ratingAvg: 4.9,
    ratingCount: 141,
    isNew: false,
    isMobile: false,
    chainId: null,
    tags: ['brows', 'lashes', 'lamination'],
    semanticSimilarity: 0.44,
    cancellationRate: 0.02,
    rules: { ...STANDARD_RULES, slotGranularityMin: 15, bufferAfterMin: 5 },
    depositPercent: 0,
    policy: { freeUntilHours: 24, lateFeePercent: 40, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-bb-lam', emoji: '✨', name: { en: 'Brow Lamination & Tint', de: 'Brow-Lamination & Färben' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 5800, vatRateBps: 1900, dynamicPricing: false, popular: true },
      { id: 'svc-bb-lash', emoji: '👁️', name: { en: 'Lash Lift & Tint', de: 'Lash Lift & Färben' }, durationMin: 50, processingGapMin: 0, finishMin: 0, basePriceCents: 6400, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-bb-shape', emoji: '🪡', name: { en: 'Brow Shape & Tint', de: 'Brauen formen & färben' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 3200, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-bb-henna', emoji: '🌰', name: { en: 'Henna Brows', de: 'Henna-Brauen' }, durationMin: 40, processingGapMin: 0, finishMin: 0, basePriceCents: 4200, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-bb-lashtint', emoji: '🖤', name: { en: 'Lash Tint', de: 'Wimpern färben' }, durationMin: 20, processingGapMin: 0, finishMin: 0, basePriceCents: 2500, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-bb-brig', name: 'Brigitte', role: { en: 'Founder', de: 'Gründerin' }, tier: 'senior', shifts: week([{ startMin: h(9), endMin: h(17) }], [1, 2, 3, 4, 5]) },
      { id: 'st-bb-nadia', name: 'Nadia', role: { en: 'Brow Artist', de: 'Brow-Artist' }, tier: 'stylist', shifts: { ...week([{ startMin: h(10), endMin: h(18) }], [2, 3, 4, 5]), 6: [{ startMin: h(9), endMin: h(14) }] } },
    ],
    pricingRules: [],
    reviews: [
      { author: 'Maren', rating: 5, text: { en: 'Brigitte has mapped my brows for three years. Would not trust anyone else.', de: 'Brigitte macht seit drei Jahren mein Brow-Mapping. Ich würde niemand anderem vertrauen.' }, service: 'Brow Lamination & Tint', date: '2026-07-19' },
    ],
  },
  {
    id: 'shop-glow-mobile',
    slug: 'glow-mobile',
    name: 'GLOW Mobile Styling',
    category: 'mobile',
    tagline: { en: 'Salon-grade hair & makeup at your door', de: 'Salon-Qualität für Haare & Make-up bei dir zu Hause' },
    about: {
      en: 'Weddings, shoots, big nights and lazy Sundays: GLOW brings the chair to you anywhere inside the S-Bahn ring. Travel is planned automatically between jobs.',
      de: 'Hochzeiten, Shootings, große Abende und faule Sonntage: GLOW bringt den Stuhl zu dir — überall innerhalb des S-Bahn-Rings. Anfahrten werden automatisch zwischen Terminen eingeplant.',
    },
    address: 'Mobile — serves inner Berlin',
    district: 'Citywide',
    lat: 52.52,
    lng: 13.405,
    gradient: ['#11998e', '#38ef7d'],
    emoji: '🚗',
    languagesSpoken: ['de', 'en'],
    ratingAvg: 4.8,
    ratingCount: 76,
    isNew: false,
    isMobile: true,
    chainId: null,
    tags: ['mobile', 'makeup', 'events', 'weddings'],
    semanticSimilarity: 0.58,
    cancellationRate: 0.04,
    rules: { ...STANDARD_RULES, slotGranularityMin: 30, bookingLeadMin: 180, bufferAfterMin: 0 },
    depositPercent: 50,
    policy: { freeUntilHours: 48, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-gm-event', emoji: '🥂', name: { en: 'Event Hair & Makeup', de: 'Event-Styling Haare & Make-up' }, durationMin: 90, processingGapMin: 0, finishMin: 0, basePriceCents: 14900, vatRateBps: 1900, dynamicPricing: true, popular: true },
      { id: 'svc-gm-bridal', emoji: '👰', name: { en: 'Bridal Package (hair + makeup)', de: 'Braut-Paket (Haare + Make-up)' }, durationMin: 180, processingGapMin: 0, finishMin: 0, basePriceCents: 39000, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-gm-group', emoji: '👯', name: { en: 'Group Styling (per person)', de: 'Gruppen-Styling (pro Person)' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 9900, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-gm-blow', emoji: '💨', name: { en: 'At-home Blow-dry', de: 'Föhnstyling zu Hause' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 6900, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-gm-vera', name: 'Vera', role: { en: 'Mobile Stylist', de: 'Mobile Stylistin' }, tier: 'senior', shifts: { ...week([{ startMin: h(8), endMin: h(20) }], [4, 5, 6]), 7: [{ startMin: h(9), endMin: h(15) }] } },
    ],
    pricingRules: [
      { id: 'pr-gm-wknd', kind: 'day_of_week', name: 'Weekend events +15 %', dows: [6, 7], adjustKind: 'percent', adjustValue: 15, priority: 9, stackable: false },
    ],
    reviews: [
      { author: 'Franzi', rating: 5, text: { en: 'Vera did my wedding party of five. Everyone looked incredible, zero stress.', de: 'Vera hat meine fünfköpfige Hochzeitsgesellschaft gestylt. Alle sahen umwerfend aus, null Stress.' }, service: 'Event Hair & Makeup', date: '2026-06-14' },
    ],
  },
  {
    id: 'shop-studio-nord',
    slug: 'studio-nord',
    name: 'Studio Nord',
    category: 'hair',
    tagline: { en: 'New in Wedding — modern cuts, honest prices', de: 'Neu im Wedding — moderne Schnitte, ehrliche Preise' },
    about: {
      en: 'Opened this spring. Scandinavian-inspired cuts and colour without the Mitte markup. Founding-member prices while we build our book.',
      de: 'Diesen Frühling eröffnet. Skandinavisch inspirierte Schnitte und Farbe ohne Mitte-Aufschlag. Gründungspreise, solange wir unser Kundenbuch aufbauen.',
    },
    address: 'Müllerstraße 143, 13353 Berlin',
    district: 'Wedding',
    lat: 52.5468,
    lng: 13.3532,
    gradient: ['#00b4db', '#0083b0'],
    emoji: '❄️',
    languagesSpoken: ['de', 'en'],
    ratingAvg: 4.9,
    ratingCount: 12,
    isNew: true,
    isMobile: false,
    chainId: null,
    tags: ['cut', 'colour', 'affordable'],
    semanticSimilarity: 0.71,
    cancellationRate: 0.0,
    rules: { ...STANDARD_RULES, bookingLeadMin: 30 },
    depositPercent: 0,
    policy: { freeUntilHours: 12, lateFeePercent: 25, noShowFeePercent: 50 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-sn-cut', emoji: '✂️', name: { en: 'Cut & Finish', de: 'Schnitt & Styling' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 4400, vatRateBps: 1900, dynamicPricing: true, popular: true },
      { id: 'svc-sn-wcb', emoji: '🚿', name: { en: 'Wash, Cut & Blow-dry', de: 'Waschen, Schneiden & Föhnen' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 5400, vatRateBps: 1900, resource: 'basin', dynamicPricing: true },
      { id: 'svc-sn-colour', emoji: '🎨', name: { en: 'Full Colour', de: 'Komplettfärbung' }, durationMin: 35, processingGapMin: 35, finishMin: 25, basePriceCents: 8900, vatRateBps: 1900, dynamicPricing: true, requiresPatchTest: true, resource: 'colour' },
      { id: 'svc-sn-student', emoji: '🎓', name: { en: 'Student Cut (with ID)', de: 'Studierendenschnitt (mit Ausweis)' }, durationMin: 40, processingGapMin: 0, finishMin: 0, basePriceCents: 3500, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-sn-ida', name: 'Ida', role: { en: 'Founder & Stylist', de: 'Gründerin & Stylistin' }, tier: 'senior', shifts: week([{ startMin: h(9), endMin: h(18) }], [1, 2, 3, 4, 5, 6]) },
      { id: 'st-sn-max', name: 'Max', role: { en: 'Stylist', de: 'Stylist' }, tier: 'stylist', shifts: week([{ startMin: h(10), endMin: h(19) }], [1, 3, 5, 6]) },
    ],
    pricingRules: [
      { id: 'pr-sn-new', kind: 'new_customer', name: 'Founding offer: first visit −10 %', adjustKind: 'percent', adjustValue: -10, priority: 11, stackable: false },
    ],
    reviews: [
      { author: 'Robin', rating: 5, text: { en: 'Found my new regular place. Ida listens first, cuts second.', de: 'Mein neuer Stammladen. Ida hört erst zu und schneidet dann.' }, service: 'Cut & Finish', date: '2026-07-26' },
    ],
  },
  {
    id: 'shop-sanfte-stunde',
    slug: 'sanfte-stunde-spa',
    name: 'Sanfte Stunde Spa',
    category: 'spa',
    tagline: { en: 'Massage, facials and an hour that belongs to you', de: 'Massage, Facials und eine Stunde, die dir gehört' },
    about: {
      en: 'A quiet floor in Charlottenburg: deep-tissue and relaxation massage, facials, and wellness coaching. Phones stay in the locker; the world stays outside.',
      de: 'Eine ruhige Etage in Charlottenburg: Tiefengewebs- und Entspannungsmassage, Facials und Wellness-Coaching. Handys bleiben im Schließfach; die Welt bleibt draußen.',
    },
    address: 'Kantstraße 24, 10623 Berlin',
    district: 'Charlottenburg',
    lat: 52.506,
    lng: 13.3224,
    gradient: ['#134e5e', '#71b280'],
    emoji: '💆',
    languagesSpoken: ['de', 'en'],
    ratingAvg: 4.9,
    ratingCount: 203,
    isNew: false,
    isMobile: false,
    chainId: null,
    tags: ['massage', 'spa', 'wellness', 'facial', 'relax'],
    semanticSimilarity: 0.52,
    cancellationRate: 0.02,
    rules: { ...STANDARD_RULES, slotGranularityMin: 30, bufferAfterMin: 15 },
    depositPercent: 20,
    policy: { freeUntilHours: 24, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-ss-deep', emoji: '💪', name: { en: 'Deep Tissue Massage (60 min)', de: 'Tiefengewebsmassage (60 Min.)' }, durationMin: 60, processingGapMin: 0, finishMin: 10, basePriceCents: 8900, vatRateBps: 1900, dynamicPricing: true, popular: true },
      { id: 'svc-ss-relax', emoji: '🌊', name: { en: 'Relaxation Massage (90 min)', de: 'Entspannungsmassage (90 Min.)' }, durationMin: 90, processingGapMin: 0, finishMin: 10, basePriceCents: 11900, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-ss-facial', emoji: '🧖', name: { en: 'Signature Facial', de: 'Signature Facial' }, durationMin: 60, processingGapMin: 0, finishMin: 5, basePriceCents: 9500, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-ss-hotstone', emoji: '🪨', name: { en: 'Hot Stone Ritual', de: 'Hot-Stone-Ritual' }, durationMin: 75, processingGapMin: 0, finishMin: 10, basePriceCents: 10900, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-ss-coach', emoji: '🌱', name: { en: 'Wellness Coaching Session', de: 'Wellness-Coaching' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 6500, vatRateBps: 1900, dynamicPricing: false, consultationFirst: true },
    ],
    staff: [
      { id: 'st-ss-heike', name: 'Heike', role: { en: 'Massage Therapist', de: 'Massagetherapeutin' }, tier: 'senior', shifts: week([{ startMin: h(10), endMin: h(19) }], [1, 2, 3, 4, 5]) },
      { id: 'st-ss-tomas', name: 'Tomás', role: { en: 'Spa Therapist', de: 'Spa-Therapeut' }, tier: 'stylist', shifts: { ...week([{ startMin: h(11), endMin: h(20) }], [2, 3, 4, 5]), 6: [{ startMin: h(10), endMin: h(16) }] } },
      { id: 'st-ss-annika', name: 'Annika', role: { en: 'Wellness Coach', de: 'Wellness-Coach' }, tier: 'stylist', shifts: week([{ startMin: h(9), endMin: h(15) }], [1, 3, 5]) },
    ],
    pricingRules: [
      { id: 'pr-ss-morning', kind: 'time_of_day', name: 'Quiet mornings −10 %', dows: [1, 2, 3], minuteOfDayFrom: h(10), minuteOfDayTo: h(12), adjustKind: 'percent', adjustValue: -10, priority: 8, stackable: false },
    ],
    reviews: [
      { author: 'Sibel', rating: 5, text: { en: 'The only hour of my week where nobody can reach me. Heike’s hands are magic.', de: 'Die einzige Stunde der Woche, in der mich niemand erreicht. Heikes Hände sind Magie.' }, service: 'Deep Tissue Massage (60 min)', date: '2026-08-02' },
    ],
  },
  {
    id: 'shop-blendwerk',
    slug: 'blendwerk-makeup',
    name: 'Blendwerk Makeup Artistry',
    category: 'makeup',
    tagline: { en: 'Weddings, shoots and big nights — faces done properly', de: 'Hochzeiten, Shootings und große Abende — Gesichter, richtig gemacht' },
    about: {
      en: 'A makeup studio for the days photographs outlive: bridal trials with a written colour plan, event makeup, and lessons that teach your own face. On-location work is quoted at the trial.',
      de: 'Ein Make-up-Studio für die Tage, die Fotos überdauern: Braut-Probetermine mit schriftlichem Farbplan, Event-Make-up und Kurse für das eigene Gesicht. Vor-Ort-Einsätze werden beim Probetermin angeboten.',
    },
    address: 'Boxhagener Straße 31, 10245 Berlin',
    district: 'Friedrichshain',
    lat: 52.5099,
    lng: 13.4601,
    gradient: ['#b24592', '#f15f79'],
    emoji: '💄',
    languagesSpoken: ['de', 'en', 'pl'],
    ratingAvg: 4.8,
    ratingCount: 88,
    isNew: false,
    isMobile: false,
    chainId: null,
    tags: ['makeup', 'weddings', 'events', 'bridal', 'lessons'],
    semanticSimilarity: 0.47,
    cancellationRate: 0.03,
    rules: { ...STANDARD_RULES, slotGranularityMin: 30, bookingLeadMin: 120 },
    depositPercent: 30,
    policy: { freeUntilHours: 48, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-bw-bridal-trial', emoji: '👰', name: { en: 'Bridal Trial (with colour plan)', de: 'Braut-Probetermin (mit Farbplan)' }, durationMin: 90, processingGapMin: 0, finishMin: 0, basePriceCents: 12900, vatRateBps: 1900, dynamicPricing: false, consultationFirst: true, popular: true },
      { id: 'svc-bw-bridal-day', emoji: '💍', name: { en: 'Wedding-day Makeup', de: 'Hochzeits-Make-up' }, durationMin: 75, processingGapMin: 0, finishMin: 0, basePriceCents: 18900, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-bw-event', emoji: '🥂', name: { en: 'Event Makeup', de: 'Event-Make-up' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 8900, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-bw-lesson', emoji: '🎓', name: { en: 'Makeup Lesson (1:1)', de: 'Make-up-Kurs (1:1)' }, durationMin: 90, processingGapMin: 0, finishMin: 0, basePriceCents: 11900, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-bw-lashes', emoji: '👁️', name: { en: 'Strip Lashes & Touch-up', de: 'Wimpernband & Auffrischung' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 3900, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-bw-alina', name: 'Alina', role: { en: 'Makeup Artist & Founder', de: 'Make-up-Artistin & Gründerin' }, tier: 'senior', shifts: { ...week([{ startMin: h(10), endMin: h(18) }], [2, 3, 4, 5]), 6: [{ startMin: h(8), endMin: h(16) }] } },
      { id: 'st-bw-june', name: 'June', role: { en: 'Makeup Artist', de: 'Make-up-Artistin' }, tier: 'stylist', shifts: { ...week([{ startMin: h(11), endMin: h(19) }], [3, 4, 5]), 6: [{ startMin: h(8), endMin: h(16) }], 7: [{ startMin: h(9), endMin: h(14) }] } },
    ],
    pricingRules: [
      { id: 'pr-bw-wknd', kind: 'day_of_week', name: 'Weekend events +10 %', dows: [6, 7], adjustKind: 'percent', adjustValue: 10, priority: 9, stackable: false },
    ],
    reviews: [
      { author: 'Verena', rating: 5, text: { en: 'The trial alone was worth it — I got a written plan my day-of artist could follow to the letter.', de: 'Allein der Probetermin war es wert — ich bekam einen schriftlichen Plan, dem die Artistin am Tag genau folgen konnte.' }, service: 'Bridal Trial (with colour plan)', date: '2026-06-28' },
    ],
  },
  {
    id: 'shop-schwarzwerk',
    slug: 'schwarzwerk-tattoo',
    name: 'Schwarzwerk Tattoo & Piercing',
    category: 'tattoo',
    tagline: { en: 'Fine-line tattoos and precise piercing, 18+', de: 'Fine-Line-Tattoos und präzises Piercing, ab 18' },
    about: {
      en: 'A licensed studio in Kreuzberg: fine-line and blackwork tattoos, professional piercing with titanium jewellery, and a consultation before every first needle. Hygiene certificate on the wall, not in a drawer.',
      de: 'Ein lizenziertes Studio in Kreuzberg: Fine-Line- und Blackwork-Tattoos, professionelles Piercing mit Titanschmuck und ein Beratungsgespräch vor jeder ersten Nadel. Das Hygienezertifikat hängt an der Wand, nicht in der Schublade.',
    },
    address: 'Wiener Straße 14, 10999 Berlin',
    district: 'Kreuzberg',
    lat: 52.4979,
    lng: 13.4291,
    gradient: ['#232526', '#414345'],
    emoji: '🖋️',
    languagesSpoken: ['de', 'en', 'es'],
    ratingAvg: 4.9,
    ratingCount: 167,
    isNew: false,
    isMobile: false,
    chainId: null,
    tags: ['tattoo', 'piercing', 'fine-line', 'blackwork'],
    semanticSimilarity: 0.35,
    cancellationRate: 0.05,
    rules: { ...STANDARD_RULES, slotGranularityMin: 30, bookingLeadMin: 240, bufferAfterMin: 20 },
    depositPercent: 30,
    policy: { freeUntilHours: 72, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-sw-consult', emoji: '💬', name: { en: 'Design Consultation', de: 'Design-Beratung' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 2000, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-sw-small', emoji: '🖋️', name: { en: 'Small Tattoo Session (up to 2h)', de: 'Kleine Tattoo-Session (bis 2 Std.)' }, durationMin: 120, processingGapMin: 0, finishMin: 15, basePriceCents: 22000, vatRateBps: 1900, dynamicPricing: false, adultsOnly: true, consultationFirst: true, popular: true },
      { id: 'svc-sw-flash', emoji: '⚡', name: { en: 'Flash Tattoo (from the wall)', de: 'Flash-Tattoo (von der Wand)' }, durationMin: 60, processingGapMin: 0, finishMin: 15, basePriceCents: 9900, vatRateBps: 1900, dynamicPricing: false, adultsOnly: true },
      { id: 'svc-sw-pierce', emoji: '✨', name: { en: 'Piercing (incl. titanium jewellery)', de: 'Piercing (inkl. Titanschmuck)' }, durationMin: 30, processingGapMin: 0, finishMin: 10, basePriceCents: 5500, vatRateBps: 1900, dynamicPricing: false, adultsOnly: true },
      { id: 'svc-sw-jewel', emoji: '💎', name: { en: 'Jewellery Change & Check', de: 'Schmuckwechsel & Kontrolle' }, durationMin: 15, processingGapMin: 0, finishMin: 0, basePriceCents: 1500, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-sw-marek', name: 'Marek', role: { en: 'Tattoo Artist', de: 'Tätowierer' }, tier: 'senior', shifts: week([{ startMin: h(12), endMin: h(20) }], [2, 3, 4, 5, 6]) },
      { id: 'st-sw-lou', name: 'Lou', role: { en: 'Piercer', de: 'Piercer:in' }, tier: 'stylist', shifts: { ...week([{ startMin: h(12), endMin: h(19) }], [3, 4, 5]), 6: [{ startMin: h(11), endMin: h(17) }] } },
    ],
    pricingRules: [],
    reviews: [
      { author: 'Deniz', rating: 5, text: { en: 'Marek talked me OUT of a bigger piece first session. That is how you earn trust.', de: 'Marek hat mir in der ersten Session von einem größeren Motiv abgeraten. So verdient man Vertrauen.' }, service: 'Small Tattoo Session (up to 2h)', date: '2026-07-11' },
    ],
  },
  {
    id: 'shop-mobile-physio',
    slug: 'mobilephysio-berlin',
    name: 'MobilePhysio Berlin',
    category: 'physio',
    tagline: { en: 'Physio, sports massage and training — at your door', de: 'Physio, Sportmassage und Training — bei dir zu Hause' },
    about: {
      en: 'Licensed physiotherapists and certified trainers who come to you: home visits inside the S-Bahn ring, office visits for teams. Bring a mat; we bring everything else.',
      de: 'Lizenzierte Physiotherapeut:innen und zertifizierte Trainer:innen, die zu dir kommen: Hausbesuche im S-Bahn-Ring, Bürobesuche für Teams. Du stellst die Matte; wir bringen den Rest.',
    },
    address: 'Mobile — serves inner Berlin',
    district: 'Citywide',
    lat: 52.51,
    lng: 13.42,
    gradient: ['#0f2027', '#2c5364'],
    emoji: '🤸',
    languagesSpoken: ['de', 'en'],
    ratingAvg: 4.8,
    ratingCount: 59,
    isNew: true,
    isMobile: true,
    chainId: null,
    tags: ['physio', 'training', 'massage', 'home visit', 'office'],
    semanticSimilarity: 0.41,
    cancellationRate: 0.03,
    rules: { ...STANDARD_RULES, slotGranularityMin: 30, bookingLeadMin: 240, bufferAfterMin: 0 },
    depositPercent: 30,
    policy: { freeUntilHours: 24, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-mp-physio', emoji: '🦴', name: { en: 'Physiotherapy Session (60 min)', de: 'Physiotherapie (60 Min.)' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 9900, vatRateBps: 1900, dynamicPricing: false, popular: true, consultationFirst: true },
      { id: 'svc-mp-sport', emoji: '🏃', name: { en: 'Sports Massage (45 min)', de: 'Sportmassage (45 Min.)' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 7500, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-mp-pt', emoji: '🏋️', name: { en: 'Personal Training (60 min)', de: 'Personal Training (60 Min.)' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 8500, vatRateBps: 1900, dynamicPricing: true },
      { id: 'svc-mp-office', emoji: '🪑', name: { en: 'Office Chair Massage (20 min)', de: 'Büro-Stuhlmassage (20 Min.)' }, durationMin: 20, processingGapMin: 0, finishMin: 0, basePriceCents: 3500, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-mp-jonas', name: 'Jonas', role: { en: 'Physiotherapist', de: 'Physiotherapeut' }, tier: 'senior', shifts: week([{ startMin: h(8), endMin: h(18) }], [1, 2, 3, 4, 5]) },
      { id: 'st-mp-carla', name: 'Carla', role: { en: 'Personal Trainer', de: 'Personal Trainerin' }, tier: 'stylist', shifts: { ...week([{ startMin: h(7), endMin: h(15) }], [1, 3, 5]), 6: [{ startMin: h(9), endMin: h(13) }] } },
    ],
    pricingRules: [
      { id: 'pr-mp-early', kind: 'time_of_day', name: 'Before-work sessions +10 %', dows: [1, 2, 3, 4, 5], minuteOfDayFrom: h(7), minuteOfDayTo: h(9), adjustKind: 'percent', adjustValue: 10, priority: 8, stackable: false },
    ],
    reviews: [
      { author: 'Ole', rating: 5, text: { en: 'Jonas fixed in four home visits what two years of “just stretch more” did not.', de: 'Jonas hat in vier Hausbesuchen repariert, was zwei Jahre „einfach mehr dehnen“ nicht geschafft haben.' }, service: 'Physiotherapy Session (60 min)', date: '2026-08-19' },
    ],
  },
  {
    id: 'shop-kleine-schere',
    slug: 'kleine-schere',
    name: 'Kleine Schere',
    category: 'kids',
    tagline: { en: 'Haircuts for small people — patience included', de: 'Haarschnitte für kleine Menschen — Geduld inklusive' },
    about: {
      en: 'A salon built at child height: race-car chairs, a film corner, staff who have seen every kind of wiggle, and a certificate for the very first cut. Parents get their trim while the kids watch cartoons.',
      de: 'Ein Salon auf Kinderhöhe: Rennauto-Stühle, eine Filmecke, ein Team, das jedes Zappeln kennt, und eine Urkunde für den allerersten Schnitt. Eltern bekommen ihren Schnitt, während die Kinder Trickfilme schauen.',
    },
    address: 'Stargarder Straße 63, 10437 Berlin',
    district: 'Prenzlauer Berg',
    lat: 52.5449,
    lng: 13.4218,
    gradient: ['#f7971e', '#ffd200'],
    emoji: '🧒',
    languagesSpoken: ['de', 'en', 'fr'],
    ratingAvg: 4.7,
    ratingCount: 96,
    isNew: false,
    isMobile: false,
    kidsFriendly: true,
    chainId: null,
    tags: ['kids', 'family', 'first haircut', 'patient'],
    semanticSimilarity: 0.38,
    cancellationRate: 0.06,
    rules: { ...STANDARD_RULES, slotGranularityMin: 15, bufferAfterMin: 10, bookingLeadMin: 30 },
    depositPercent: 0,
    policy: { freeUntilHours: 4, lateFeePercent: 0, noShowFeePercent: 50 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-ks-kids', emoji: '🧒', name: { en: 'Kids Cut (up to 12)', de: 'Kinderschnitt (bis 12)' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 2400, vatRateBps: 1900, dynamicPricing: false, popular: true },
      { id: 'svc-ks-first', emoji: '🎉', name: { en: 'First Haircut (with certificate)', de: 'Erster Haarschnitt (mit Urkunde)' }, durationMin: 30, processingGapMin: 0, finishMin: 10, basePriceCents: 2900, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-ks-teen', emoji: '🎧', name: { en: 'Teen Cut (13–17)', de: 'Teenie-Schnitt (13–17)' }, durationMin: 40, processingGapMin: 0, finishMin: 0, basePriceCents: 3200, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-ks-combo', emoji: '👨‍👧', name: { en: 'Parent + Kid Combo', de: 'Eltern-Kind-Kombi' }, durationMin: 60, processingGapMin: 0, finishMin: 0, basePriceCents: 5900, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-ks-paula', name: 'Paula', role: { en: 'Kids Stylist', de: 'Kinder-Stylistin' }, tier: 'senior', shifts: { ...week([{ startMin: h(9), endMin: h(17) }], [2, 3, 4, 5]), 6: [{ startMin: h(9), endMin: h(15) }] } },
      { id: 'st-ks-milan', name: 'Milan', role: { en: 'Stylist', de: 'Stylist' }, tier: 'stylist', shifts: { ...week([{ startMin: h(10), endMin: h(18) }], [3, 4, 5]), 6: [{ startMin: h(9), endMin: h(15) }] } },
    ],
    pricingRules: [
      { id: 'pr-ks-morning', kind: 'time_of_day', name: 'Kita mornings −15 %', dows: [2, 3, 4], minuteOfDayFrom: h(9), minuteOfDayTo: h(11), adjustKind: 'percent', adjustValue: -15, priority: 8, stackable: false },
    ],
    reviews: [
      { author: 'Nadja', rating: 5, text: { en: 'First haircut without a single tear — the certificate is on our fridge.', de: 'Erster Haarschnitt ohne eine einzige Träne — die Urkunde hängt am Kühlschrank.' }, service: 'First Haircut (with certificate)', date: '2026-07-30' },
    ],
  },
  {
    id: 'shop-eclat',
    slug: 'eclat-concierge',
    name: 'Éclat Concierge',
    category: 'hair',
    tagline: { en: 'Private-suite beauty, planned around your calendar', de: 'Beauty in der Privatsuite, geplant um deinen Kalender' },
    about: {
      en: 'One client at a time in a private suite: a dedicated concierge coordinates hair, makeup and styling around your schedule — fittings, premieres, board days. Discretion is the house style.',
      de: 'Ein Gast zur Zeit in einer Privatsuite: eine persönliche Concierge koordiniert Haare, Make-up und Styling um deinen Kalender — Anproben, Premieren, Vorstandstage. Diskretion ist der Stil des Hauses.',
    },
    address: 'Behrenstraße 27, 10117 Berlin',
    district: 'Mitte',
    lat: 52.5155,
    lng: 13.389,
    gradient: ['#41295a', '#2f0743'],
    emoji: '👑',
    languagesSpoken: ['de', 'en', 'fr'],
    ratingAvg: 5.0,
    ratingCount: 31,
    isNew: false,
    isMobile: false,
    premium: true,
    chainId: null,
    tags: ['vip', 'concierge', 'premium', 'private suite', 'events'],
    semanticSimilarity: 0.29,
    cancellationRate: 0.01,
    rules: { ...STANDARD_RULES, slotGranularityMin: 30, bookingLeadMin: 720, bufferAfterMin: 30 },
    depositPercent: 50,
    policy: { freeUntilHours: 72, lateFeePercent: 50, noShowFeePercent: 100 },
    timezone: 'Europe/Berlin',
    services: [
      { id: 'svc-ec-signature', emoji: '👑', name: { en: 'Signature Transformation (suite)', de: 'Signature Transformation (Suite)' }, durationMin: 180, processingGapMin: 0, finishMin: 20, basePriceCents: 59000, vatRateBps: 1900, dynamicPricing: false, consultationFirst: true, popular: true },
      { id: 'svc-ec-event', emoji: '🎭', name: { en: 'Event Prep (hair + makeup, suite)', de: 'Event-Vorbereitung (Haare + Make-up, Suite)' }, durationMin: 120, processingGapMin: 0, finishMin: 15, basePriceCents: 34000, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-ec-express', emoji: '⏱️', name: { en: 'Express Blowout & Finish', de: 'Express-Blowout & Finish' }, durationMin: 45, processingGapMin: 0, finishMin: 0, basePriceCents: 12000, vatRateBps: 1900, dynamicPricing: false },
      { id: 'svc-ec-consult', emoji: '📋', name: { en: 'Concierge Planning Call', de: 'Concierge-Planungsgespräch' }, durationMin: 30, processingGapMin: 0, finishMin: 0, basePriceCents: 0, vatRateBps: 1900, dynamicPricing: false },
    ],
    staff: [
      { id: 'st-ec-margaux', name: 'Margaux', role: { en: 'Creative Director', de: 'Kreativdirektorin' }, tier: 'senior', shifts: week([{ startMin: h(9), endMin: h(19) }], [1, 2, 3, 4, 5]) },
      { id: 'st-ec-viktor', name: 'Viktor', role: { en: 'Concierge Stylist', de: 'Concierge-Stylist' }, tier: 'senior', shifts: { ...week([{ startMin: h(10), endMin: h(20) }], [2, 3, 4, 5]), 6: [{ startMin: h(10), endMin: h(18) }] } },
    ],
    pricingRules: [],
    reviews: [
      { author: 'C. M.', rating: 5, text: { en: 'They moved my appointment twice around a delayed flight without being asked. That is the service.', de: 'Sie haben meinen Termin zweimal um einen verspäteten Flug herum verschoben, ohne dass ich fragen musste. Das ist der Service.' }, service: 'Event Prep (hair + makeup, suite)', date: '2026-08-21' },
    ],
  },
];

export const CATEGORIES = [
  { id: 'hair', emoji: '💇', label: { en: 'Hair', de: 'Haare' } },
  { id: 'barber', emoji: '💈', label: { en: 'Barber', de: 'Barbier' } },
  { id: 'nails', emoji: '💅', label: { en: 'Nails', de: 'Nägel' } },
  { id: 'brows', emoji: '👁️', label: { en: 'Brows & Lashes', de: 'Brauen & Wimpern' } },
  { id: 'spa', emoji: '💆', label: { en: 'Massage & Spa', de: 'Massage & Spa' } },
  { id: 'makeup', emoji: '💄', label: { en: 'Makeup', de: 'Make-up' } },
  { id: 'tattoo', emoji: '🖋️', label: { en: 'Tattoo & Piercing', de: 'Tattoo & Piercing' } },
  { id: 'physio', emoji: '🤸', label: { en: 'Physio & Training', de: 'Physio & Training' } },
  { id: 'kids', emoji: '🧒', label: { en: 'Kids', de: 'Kinder' } },
  { id: 'mobile', emoji: '🚗', label: { en: 'At home', de: 'Zu Hause' } },
] as const;

// ---- vouchers -------------------------------------------------------------

export interface Voucher {
  code: string;
  label: LocalText;
  kind: 'percent' | 'fixed_cents';
  value: number;
  minSubtotalCents: number;
}

export const VOUCHERS: Voucher[] = [
  { code: 'WELCOME10', label: { en: '10 % welcome discount', de: '10 % Willkommensrabatt' }, kind: 'percent', value: 10, minSubtotalCents: 0 },
  { code: 'STYLE15', label: { en: '15 % off from €80', de: '15 % Rabatt ab 80 €' }, kind: 'percent', value: 15, minSubtotalCents: 8000 },
  { code: 'FRIENDS5', label: { en: '€5 off — friend referral', de: '5 € Rabatt — Freundschaftswerbung' }, kind: 'fixed_cents', value: 500, minSubtotalCents: 2000 },
];

/** Loyalty: 1 point per euro spent; 100 points = €1 when redeeming. */
export const LOYALTY_EARN_PER_EURO = 1;
export const LOYALTY_POINTS_PER_EURO_REDEEMED = 100;
