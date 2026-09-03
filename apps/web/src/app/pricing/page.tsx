'use client';
/**
 * How prices work — the whole truth on one page.
 *
 * Dynamic pricing is the product's most opaque mechanic, and opacity is where
 * distrust grows. This page states every rule that can ever touch a price —
 * surcharges, discounts, Prime, deposits, the hold, cancellation fees, tips,
 * vouchers, points — in plain language, with the platform's actual numbers
 * pulled from the engine so the page can never drift from the code.
 */
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { InfoPage } from '@/components/InfoPage';
import { money } from '@/lib/format';
import { PRIME_PERCENT, PRIME_MIN_CENTS, GIFT_MIN_CENTS, GIFT_MAX_CENTS } from '@/core/store';
import { LOYALTY_EARN_PER_EURO, LOYALTY_POINTS_PER_EURO_REDEEMED } from '@/core/seed';

const C = {
  en: {
    title: 'How prices work',
    lead: 'Every euro on this platform can be explained. This page is the explanation — the same rules the checkout applies, in plain words.',
    s: (lang: 'en' | 'de') => [
      {
        heading: 'The base price includes everything',
        body: 'The price on a service is the price: VAT included, no booking fee, nothing added at checkout. If a salon charges a travel fee for mobile visits, it is its own named line, shown before you pay.',
      },
      {
        heading: 'Why the same haircut can cost different amounts',
        body: 'Salons may price hours, not just services: a quiet Tuesday morning gets a discount (tagged Saver, e.g. "Last-minute −20 %"), a packed Saturday gets a surcharge (tagged Peak, e.g. "Saturday +10 %"). Wherever this happens, the tag names the rule and shows the base price next to the adjusted one — a price you can’t explain is a price you can’t trust. Salons that don’t use dynamic pricing simply show one price.',
      },
      {
        heading: 'Prime flexible appointments',
        body: `Prime is extra capacity outside the normal grid — any time the doors are open, squeezed in for people whose day doesn’t bend. It costs the base price plus ${PRIME_PERCENT} % (at least ${money(PRIME_MIN_CENTS, lang)}), always labeled before you book.`,
      },
      {
        heading: 'The hold: seat before money',
        body: 'When you pick a time, the seat is held for a few minutes while you confirm — nobody else can buy it meanwhile. If you don’t finish, the hold quietly expires and the seat goes back on sale. Nothing is charged for an expired hold, and any loyalty points you had applied come back.',
      },
      {
        heading: 'Deposits and cancellation',
        body: 'Deposits, free-cancellation windows and late fees are each salon’s own policy, shown before you pay and frozen into your booking — a later policy change can’t touch it. Cancel inside the free window: full refund, automatically. Cancel late or no-show: the salon may keep the stated fee, the rest is refunded. If the salon cancels on you, you always get everything back.',
      },
      {
        heading: 'Vouchers, gift cards and points',
        body: `One voucher field at checkout takes marketing codes and gift cards alike. Gift cards (${money(GIFT_MIN_CENTS, lang)}–${money(GIFT_MAX_CENTS, lang)}) redeem partially and keep their balance. Loyalty: ${LOYALTY_EARN_PER_EURO} point per euro on completed visits; ${LOYALTY_POINTS_PER_EURO_REDEEMED} points are worth €1 at checkout.`,
      },
      {
        heading: 'Tips',
        body: 'Tips are voluntary, go to the team, and are never part of the taxable service price — the receipt shows them separately.',
      },
    ],
    cta: 'See it in action — book something →',
  },
  de: {
    title: 'So funktionieren die Preise',
    lead: 'Jeder Euro auf dieser Plattform lässt sich erklären. Diese Seite ist die Erklärung — dieselben Regeln, die die Kasse anwendet, in klaren Worten.',
    s: (lang: 'en' | 'de') => [
      {
        heading: 'Der Grundpreis enthält alles',
        body: 'Der Preis an der Leistung ist der Preis: inklusive USt., ohne Buchungsgebühr, ohne Zuschläge an der Kasse. Berechnet ein mobiler Salon eine Anfahrt, steht sie als eigene, benannte Zeile da — vor der Zahlung.',
      },
      {
        heading: 'Warum derselbe Haarschnitt unterschiedlich kosten kann',
        body: 'Salons können Stunden bepreisen, nicht nur Leistungen: der ruhige Dienstagvormittag wird günstiger (Sparen, z. B. „Last-minute −20 %“), der volle Samstag teurer (Stoßzeit, z. B. „Samstag +10 %“). Wo das passiert, benennt das Etikett die Regel und zeigt den Grundpreis neben dem angepassten — ein Preis ohne Erklärung ist ein Preis ohne Vertrauen. Salons ohne dynamische Preise zeigen schlicht einen Preis.',
      },
      {
        heading: 'Prime-Flextermine',
        body: `Prime ist Zusatzkapazität außerhalb des normalen Rasters — jederzeit innerhalb der Öffnungszeiten, für Menschen, deren Tag sich nicht biegen lässt. Kostet Grundpreis plus ${PRIME_PERCENT} % (mindestens ${money(PRIME_MIN_CENTS, lang)}), immer vor der Buchung ausgewiesen.`,
      },
      {
        heading: 'Die Reservierung: erst der Platz, dann das Geld',
        body: 'Wählst du eine Zeit, ist der Platz einige Minuten reserviert, während du bestätigst — niemand sonst kann ihn kaufen. Wird nichts daraus, verfällt die Reservierung still und der Platz ist wieder frei. Für eine verfallene Reservierung wird nichts berechnet; eingesetzte Punkte kommen zurück.',
      },
      {
        heading: 'Anzahlung und Stornierung',
        body: 'Anzahlungen, kostenlose Stornofristen und Gebühren sind die Regeln des jeweiligen Salons — vor der Zahlung sichtbar und in deiner Buchung eingefroren; eine spätere Regeländerung kann sie nicht mehr ändern. Rechtzeitig storniert: volle Erstattung, automatisch. Zu spät oder nicht erschienen: der Salon darf die ausgewiesene Gebühr behalten, der Rest wird erstattet. Sagt der Salon ab, bekommst du immer alles zurück.',
      },
      {
        heading: 'Gutscheine, Geschenkkarten und Punkte',
        body: `Ein Gutschein-Feld an der Kasse nimmt Aktionscodes und Geschenkgutscheine gleichermaßen. Gutscheine (${money(GIFT_MIN_CENTS, lang)}–${money(GIFT_MAX_CENTS, lang)}) lassen sich teilweise einlösen und behalten ihr Guthaben. Treue: ${LOYALTY_EARN_PER_EURO} Punkt pro Euro bei abgeschlossenen Besuchen; ${LOYALTY_POINTS_PER_EURO_REDEEMED} Punkte sind an der Kasse 1 € wert.`,
      },
      {
        heading: 'Trinkgeld',
        body: 'Trinkgeld ist freiwillig, gehört dem Team und ist nie Teil des steuerpflichtigen Leistungspreises — der Beleg weist es getrennt aus.',
      },
    ],
    cta: 'Live ansehen — etwas buchen →',
  },
};

export default function PricingPage() {
  const { lang } = useI18n();
  const c = C[lang];
  return (
    <InfoPage
      title={c.title}
      lead={c.lead}
      sections={[
        ...c.s(lang).map((x) => ({ heading: x.heading, body: <p>{x.body}</p> })),
        { body: <Link href="/" className="btn btn-primary">{c.cta}</Link> },
      ]}
    />
  );
}
