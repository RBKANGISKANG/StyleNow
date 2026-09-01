'use client';
/**
 * Who this platform is — the page a curious customer or a sceptical salon
 * owner reads before trusting it with an appointment book.
 */
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { InfoPage } from '@/components/InfoPage';

const C = {
  en: {
    title: 'About StyleNow',
    lead: 'One place to find, book and run beauty appointments in Berlin — for the people in the chair and the people behind it.',
    s: [
      {
        heading: 'What we do',
        body: 'StyleNow is a booking marketplace for salons, barbers, nail and brow studios. Customers see live availability and fair, transparent prices — every surcharge and discount is named, never hidden. Salons get a full back office: calendar, team and roster, customers, messages, revenue, receipts.',
      },
      {
        heading: 'How booking works',
        body: 'Seat before money: when you pick a time we hold the seat for a few minutes while you confirm, so two people can never buy the same chair. Prices include VAT. Deposits, cancellation windows and fees are the salon’s own policy and are shown before you pay, not after.',
      },
      {
        heading: 'Fair pricing, explained',
        body: 'Some salons price quiet hours down and peak hours up. Wherever that happens, the price you see carries the reason — "Last-minute −20 %", "Saturday +10 %" — because a price you can’t explain is a price you can’t trust.',
      },
      {
        heading: 'For salons',
        body: 'Your own page with photos, opening hours derived from your real roster, a waiting list that turns cancellations into revenue, messaging with your customers, legally-shaped receipts, and staff who can see their own day and request their own time off.',
      },
    ],
    partner: 'Run a salon? Partner with us →',
  },
  de: {
    title: 'Über StyleNow',
    lead: 'Ein Ort, um Beauty-Termine in Berlin zu finden, zu buchen und zu verwalten — für die Menschen im Stuhl und die dahinter.',
    s: [
      {
        heading: 'Was wir machen',
        body: 'StyleNow ist ein Buchungsmarktplatz für Salons, Barbiere, Nagel- und Brauenstudios. Kundinnen und Kunden sehen echte Verfügbarkeit und faire, transparente Preise — jeder Auf- und Abschlag wird benannt, nie versteckt. Salons bekommen ein komplettes Backoffice: Kalender, Team und Dienstplan, Kundschaft, Nachrichten, Umsatz, Belege.',
      },
      {
        heading: 'So funktioniert Buchen',
        body: 'Erst der Platz, dann das Geld: Wenn du eine Zeit wählst, halten wir den Platz einige Minuten, während du bestätigst — zwei Personen können nie denselben Stuhl kaufen. Preise inklusive USt. Anzahlungen, Stornofristen und Gebühren sind die Regeln des jeweiligen Salons und stehen vor der Zahlung fest, nicht danach.',
      },
      {
        heading: 'Faire Preise, erklärt',
        body: 'Manche Salons machen ruhige Stunden günstiger und Stoßzeiten teurer. Wo das passiert, trägt der Preis den Grund — „Last-minute −20 %", „Samstag +10 %" — denn ein Preis, den man nicht erklären kann, ist ein Preis, dem man nicht traut.',
      },
      {
        heading: 'Für Salons',
        body: 'Eine eigene Seite mit Fotos, Öffnungszeiten direkt aus dem echten Dienstplan, eine Warteliste, die Stornierungen in Umsatz verwandelt, Nachrichten mit deiner Kundschaft, rechtssichere Belege — und ein Team, das den eigenen Tag sieht und Urlaub selbst beantragt.',
      },
    ],
    partner: 'Du führst einen Salon? Partner werden →',
  },
};

export default function AboutPage() {
  const { lang } = useI18n();
  const c = C[lang];
  return (
    <InfoPage
      title={c.title}
      lead={c.lead}
      sections={[
        ...c.s.map((x) => ({ heading: x.heading, body: <p>{x.body}</p> })),
        { body: <Link href="/partner" className="btn btn-primary">{c.partner}</Link> },
      ]}
    />
  );
}
