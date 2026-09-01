'use client';
/**
 * Help — the questions people actually have, each answered with a link to the
 * screen where the answer lives. A FAQ that ends every answer with "contact
 * support" is a maze; this one ends each answer with the button.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { InfoPage } from '@/components/InfoPage';

interface QA { q: string; a: string; href?: string; cta?: string }

const C: Record<'en' | 'de', { title: string; lead: string; cus: string; biz: string; qs: QA[]; bqs: QA[] }> = {
  en: {
    title: 'Help & FAQ',
    lead: 'Short answers, each with the button that does the thing.',
    cus: 'For customers',
    biz: 'For salons',
    qs: [
      { q: 'How do I book?', a: 'Pick a salon, a service and a free time. The seat is held while you confirm — nobody can take it out from under you.', href: '/', cta: 'Explore salons' },
      { q: 'Can I move an appointment?', a: 'Yes — on My bookings, every upcoming appointment has a Move button while cancellation is still free. Same stylist, same price.', href: '/bookings', cta: 'My bookings' },
      { q: 'What does cancelling cost?', a: 'Each salon sets its own window and fees, shown before you pay and frozen onto your booking. Inside the free window it costs nothing.', href: '/bookings', cta: 'My bookings' },
      { q: 'The day is fully booked — now what?', a: 'Join the waiting list. If a slot opens, the salon can offer you an exact time; it appears on your bookings page and in the bell.', href: '/', cta: 'Find a salon' },
      { q: 'What is a Prime booking?', a: 'Extra capacity at a premium: any time inside opening hours, even when the grid is full, with the surcharge shown openly.' },
      { q: 'How do I talk to my salon?', a: 'Every salon you have booked with has a message thread — times, questions, running late.', href: '/messages', cta: 'Messages' },
      { q: 'Where is my receipt?', a: 'On every confirmed or completed booking — print it, save it as PDF, or email it to yourself.', href: '/bookings', cta: 'My bookings' },
      { q: 'Can I get an E-Rechnung (e-invoice)?', a: 'Yes. If you booked as a business, open the receipt and expand "E-Rechnung for businesses" — it downloads the same invoice as structured XRechnung XML that bookkeeping software can ingest. Private customers don’t need it; the normal receipt is the valid document. (The 2025 German e-invoicing mandate covers B2B, not consumer receipts.)', href: '/bookings', cta: 'My bookings' },
      { q: 'My data?', a: 'Export or delete everything yourself in Account. The privacy page explains what is stored and where.', href: '/privacy', cta: 'Privacy' },
    ],
    bqs: [
      { q: 'How do I get my salon on StyleNow?', a: 'Register as a partner — legal details, services, team. Your page goes live on approval.', href: '/partner', cta: 'Partner registration' },
      { q: 'Where do I run my day?', a: 'The dashboard: calendar, customers, messages, revenue, team, HR and shop settings — including photos and receipt details.', href: '/dashboard', cta: 'Open dashboard' },
      { q: 'Can my team see their own schedules?', a: 'My day shows each employee their chair, their week and their time off — and lets them request holidays, which you approve in HR.', href: '/my-day', cta: 'My day' },
    ],
  },
  de: {
    title: 'Hilfe & FAQ',
    lead: 'Kurze Antworten — jede mit dem Knopf, der es tut.',
    cus: 'Für Kundinnen und Kunden',
    biz: 'Für Salons',
    qs: [
      { q: 'Wie buche ich?', a: 'Salon, Leistung und freie Zeit wählen. Der Platz wird gehalten, während du bestätigst — niemand kann ihn dir wegschnappen.', href: '/', cta: 'Salons entdecken' },
      { q: 'Kann ich einen Termin verschieben?', a: 'Ja — unter Meine Buchungen hat jeder kommende Termin einen Verschieben-Knopf, solange die Stornierung kostenlos ist. Gleiche Person, gleicher Preis.', href: '/bookings', cta: 'Meine Buchungen' },
      { q: 'Was kostet Stornieren?', a: 'Jeder Salon bestimmt Fenster und Gebühren selbst — angezeigt vor der Zahlung, eingefroren in deiner Buchung. Im kostenlosen Fenster: nichts.', href: '/bookings', cta: 'Meine Buchungen' },
      { q: 'Der Tag ist ausgebucht — und jetzt?', a: 'Auf die Warteliste. Wird etwas frei, kann der Salon dir eine konkrete Zeit anbieten; sie erscheint bei deinen Buchungen und in der Glocke.', href: '/', cta: 'Salon finden' },
      { q: 'Was ist eine Prime-Buchung?', a: 'Zusatzkapazität mit Aufschlag: jede Zeit innerhalb der Öffnungszeiten, auch wenn das Raster voll ist — der Aufpreis steht offen dabei.' },
      { q: 'Wie erreiche ich meinen Salon?', a: 'Jeder Salon, bei dem du gebucht hast, hat einen Nachrichten-Verlauf — Zeiten, Fragen, Verspätung.', href: '/messages', cta: 'Nachrichten' },
      { q: 'Wo ist mein Beleg?', a: 'An jeder bestätigten oder abgeschlossenen Buchung — drucken, als PDF sichern oder dir selbst mailen.', href: '/bookings', cta: 'Meine Buchungen' },
      { q: 'Bekomme ich eine E-Rechnung?', a: 'Ja. Wenn du als Unternehmen gebucht hast, öffne den Beleg und klappe „E-Rechnung für Unternehmen" auf — dieselbe Rechnung als strukturiertes XRechnung-XML, das Buchhaltungssoftware verarbeiten kann. Privat brauchst du das nicht; der normale Beleg ist das gültige Dokument. (Die E-Rechnungspflicht seit 2025 gilt für B2B, nicht für Verbraucherbelege.)', href: '/bookings', cta: 'Meine Buchungen' },
      { q: 'Meine Daten?', a: 'Exportiere oder lösche alles selbst im Konto-Bereich. Die Datenschutzseite erklärt, was wo liegt.', href: '/privacy', cta: 'Datenschutz' },
    ],
    bqs: [
      { q: 'Wie kommt mein Salon auf StyleNow?', a: 'Als Partner registrieren — Firmendaten, Leistungen, Team. Mit der Freigabe ist deine Seite online.', href: '/partner', cta: 'Partner-Registrierung' },
      { q: 'Wo verwalte ich meinen Tag?', a: 'Im Dashboard: Kalender, Kundschaft, Nachrichten, Umsatz, Team, HR und Shop-Einstellungen — inklusive Fotos und Belegangaben.', href: '/dashboard', cta: 'Dashboard öffnen' },
      { q: 'Sieht mein Team die eigenen Pläne?', a: 'Mein Tag zeigt jeder Person ihren Stuhl, ihre Woche und ihre Abwesenheiten — und Urlaub lässt sich dort beantragen, du genehmigst in HR.', href: '/my-day', cta: 'Mein Tag' },
    ],
  },
};

function QAList({ items }: { items: QA[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq-list">
      {items.map((x, i) => (
        <div className={`faq-item${open === i ? ' open' : ''}`} key={i}>
          <button className="faq-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            {x.q}
            <span className="faq-chev">{open === i ? '−' : '+'}</span>
          </button>
          {open === i && (
            <div className="faq-a">
              <p>{x.a}</p>
              {x.href && x.cta && <Link href={x.href} className="btn btn-soft sm">{x.cta}</Link>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function HelpPage() {
  const { lang } = useI18n();
  const c = C[lang];
  return (
    <InfoPage
      title={c.title}
      lead={c.lead}
      sections={[
        { heading: c.cus, body: <QAList items={c.qs} /> },
        { heading: c.biz, body: <QAList items={c.bqs} /> },
      ]}
    />
  );
}
