'use client';
/**
 * Impressum — §5 DDG requires German sites to say who runs them.
 *
 * This is a demo, and the page says so out loud: the company data is a
 * placeholder in the legally required shape, not an invented registration
 * pretending to be real. A real launch replaces the block below with the
 * operating company's actual details; the structure is already correct.
 */
import { useI18n } from '@/lib/i18n';
import { InfoPage } from '@/components/InfoPage';

const C = {
  en: {
    title: 'Imprint',
    demo: 'Demo notice: StyleNow is a demonstration project. The details below are placeholders in the legally required format (§5 DDG) and do not refer to a real registered company.',
    provider: 'Service provider',
    represented: 'Represented by',
    contact: 'Contact',
    register: 'Commercial register',
    vat: 'VAT identification number',
    responsible: 'Responsible for content (§ 18 Abs. 2 MStV)',
    dispute_h: 'Dispute resolution',
    dispute: 'We are neither obliged nor willing to participate in dispute-resolution proceedings before a consumer arbitration board. Bookings are contracts between you and the salon; the salon named on your booking and receipt is your contractual partner for the service itself.',
  },
  de: {
    title: 'Impressum',
    demo: 'Demo-Hinweis: StyleNow ist ein Demonstrationsprojekt. Die folgenden Angaben sind Platzhalter im gesetzlich vorgesehenen Format (§5 DDG) und bezeichnen kein real eingetragenes Unternehmen.',
    provider: 'Diensteanbieter',
    represented: 'Vertreten durch',
    contact: 'Kontakt',
    register: 'Handelsregister',
    vat: 'Umsatzsteuer-Identifikationsnummer',
    responsible: 'Inhaltlich verantwortlich (§ 18 Abs. 2 MStV)',
    dispute_h: 'Streitbeilegung',
    dispute: 'Zur Teilnahme an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle sind wir weder verpflichtet noch bereit. Buchungen sind Verträge zwischen dir und dem Salon; für die Dienstleistung selbst ist der auf Buchung und Beleg genannte Salon dein Vertragspartner.',
  },
};

export default function ImprintPage() {
  const { lang } = useI18n();
  const c = C[lang];
  return (
    <InfoPage
      title={c.title}
      aside={<div className="alert" style={{ marginBottom: 20 }}>⚠️ {c.demo}</div>}
      sections={[
        {
          heading: c.provider,
          body: (
            <address className="info-address">
              StyleNow Demo UG (haftungsbeschränkt) — Platzhalter<br />
              Musterstraße 1<br />
              10115 Berlin, Deutschland
            </address>
          ),
        },
        { heading: c.represented, body: <p>Max Mustermann (Platzhalter)</p> },
        {
          heading: c.contact,
          body: (
            <p>
              E-Mail: hello@stylenow.example<br />
              Telefon: +49 30 000000-0 (Platzhalter)
            </p>
          ),
        },
        { heading: c.register, body: <p>Amtsgericht Charlottenburg, HRB 000000 B (Platzhalter)</p> },
        { heading: c.vat, body: <p>DE000000000 (Platzhalter)</p> },
        { heading: c.responsible, body: <p>Max Mustermann, Anschrift wie oben (Platzhalter)</p> },
        { heading: c.dispute_h, body: <p>{c.dispute}</p> },
      ]}
    />
  );
}
