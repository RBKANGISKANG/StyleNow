'use client';
/**
 * Datenschutzerklärung — written from what this app actually does, not from a
 * template. The demo's honest data story is unusually good: almost everything
 * lives in the visitor's own browser, and the GDPR rights pages usually only
 * promise (export, deletion) are working buttons in the Account tab.
 */
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { InfoPage } from '@/components/InfoPage';

const C = {
  en: {
    title: 'Privacy (GDPR)',
    lead: 'What data this platform touches, where it lives, and the rights you can exercise yourself — written to match what the software actually does.',
    s: [
      ['Controller', 'The service provider named in the imprint. For the service you book, the salon is its own controller of the booking data it needs (name, contact, appointment, receipt) — it is your contractual partner.'],
      ['What we store, and where', 'Bookings, waitlist entries, messages with salons, preferences (language, design, favourites) and a random device identifier are stored in your own browser (localStorage). If the platform is connected to its database (Supabase), bookings and salon configuration are additionally stored there so they survive across devices. There is no advertising tracking and no analytics service on these pages.'],
      ['Account data', 'An account is optional. If you create one we process your email address and the profile details you enter, to keep your bookings and preferences attached to you rather than to one browser.'],
      ['Messages and photos', 'Messages between you and a salon are visible to both sides of the conversation. Photos a salon uploads are published on its page by the salon’s own decision.'],
      ['External services', 'Fonts are loaded from Google Fonts, and maps load tiles from OpenStreetMap — your browser contacts those servers and transmits your IP address when those elements load. Directions links open Google Maps. Browser notifications only exist if you explicitly grant the permission, and you can revoke it in your browser at any time.'],
      ['Legal bases', 'Processing for booking and running appointments: performance of a contract (Art. 6(1)(b) GDPR). Optional features you switch on — personalisation, notifications: consent (Art. 6(1)(a)), revocable at any time. Receipts and their retention by salons: legal obligation (Art. 6(1)(c)).'],
    ],
    rights_h: 'Your rights — self-service',
    rights: 'Access (Art. 15), rectification (Art. 16), erasure (Art. 17), portability (Art. 20), objection (Art. 21): the Account tab has a working data export and a full account deletion — no email required, no waiting. You also have the right to complain to a supervisory authority; for Berlin that is the Berliner Beauftragte für Datenschutz und Informationsfreiheit.',
    account: 'Open Account (export & deletion)',
  },
  de: {
    title: 'Datenschutz (DSGVO)',
    lead: 'Welche Daten diese Plattform berührt, wo sie liegen, und welche Rechte du selbst ausüben kannst — geschrieben nach dem, was die Software wirklich tut.',
    s: [
      ['Verantwortlicher', 'Der im Impressum genannte Diensteanbieter. Für die gebuchte Dienstleistung ist der Salon eigener Verantwortlicher der Buchungsdaten, die er braucht (Name, Kontakt, Termin, Beleg) — er ist dein Vertragspartner.'],
      ['Was wir speichern, und wo', 'Buchungen, Wartelisten-Einträge, Nachrichten mit Salons, Einstellungen (Sprache, Design, Favoriten) und eine zufällige Geräte-Kennung liegen in deinem eigenen Browser (localStorage). Ist die Plattform mit ihrer Datenbank (Supabase) verbunden, werden Buchungen und Salon-Konfiguration zusätzlich dort gespeichert, damit sie geräteübergreifend erhalten bleiben. Es gibt kein Werbe-Tracking und keinen Analysedienst auf diesen Seiten.'],
      ['Kontodaten', 'Ein Konto ist optional. Legst du eines an, verarbeiten wir deine E-Mail-Adresse und die von dir eingegebenen Profildaten, damit Buchungen und Einstellungen an dir hängen statt an einem Browser.'],
      ['Nachrichten und Fotos', 'Nachrichten zwischen dir und einem Salon sehen beide Seiten des Gesprächs. Fotos, die ein Salon hochlädt, veröffentlicht der Salon auf seiner Seite in eigener Entscheidung.'],
      ['Externe Dienste', 'Schriften werden von Google Fonts geladen, Karten laden Kacheln von OpenStreetMap — dein Browser kontaktiert diese Server und übermittelt dabei deine IP-Adresse. Routen-Links öffnen Google Maps. Browser-Mitteilungen gibt es nur, wenn du die Berechtigung ausdrücklich erteilst; du kannst sie jederzeit im Browser widerrufen.'],
      ['Rechtsgrundlagen', 'Verarbeitung für Buchung und Terminabwicklung: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO). Optionale Funktionen, die du einschaltest — Personalisierung, Mitteilungen: Einwilligung (Art. 6 Abs. 1 lit. a), jederzeit widerruflich. Belege und ihre Aufbewahrung durch Salons: rechtliche Verpflichtung (Art. 6 Abs. 1 lit. c).'],
    ],
    rights_h: 'Deine Rechte — Selbstbedienung',
    rights: 'Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Übertragbarkeit (Art. 20), Widerspruch (Art. 21): Im Konto-Bereich gibt es einen funktionierenden Datenexport und eine vollständige Kontolöschung — ohne E-Mail, ohne Wartezeit. Außerdem hast du das Recht auf Beschwerde bei einer Aufsichtsbehörde; für Berlin ist das die Berliner Beauftragte für Datenschutz und Informationsfreiheit.',
    account: 'Konto öffnen (Export & Löschung)',
  },
};

export default function PrivacyPage() {
  const { lang } = useI18n();
  const c = C[lang];
  return (
    <InfoPage
      title={c.title}
      lead={c.lead}
      sections={[
        ...c.s.map(([h, p]) => ({ heading: h, body: <p>{p}</p> })),
        {
          heading: c.rights_h,
          body: (
            <>
              <p>{c.rights}</p>
              <Link href="/account" className="btn btn-soft" style={{ marginTop: 10 }}>
                {c.account}
              </Link>
            </>
          ),
        },
      ]}
    />
  );
}
