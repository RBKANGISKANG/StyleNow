'use client';
/**
 * AGB — the terms, in the shape the product actually enforces.
 *
 * Everything stated here is something the software really does: the hold
 * window, the policy snapshot at booking time, the fee rules on cancelling
 * and moving. Terms that promise what the code does not enforce are the
 * legal version of a broken button.
 */
import { useI18n } from '@/lib/i18n';
import { InfoPage } from '@/components/InfoPage';

const C = {
  en: {
    title: 'Terms of use',
    lead: 'The short version: the platform arranges the appointment, the salon delivers it, and every rule you are held to was shown before you paid.',
    s: [
      ['1. Who you contract with', 'StyleNow operates a booking platform. The service contract for an appointment is between you and the salon named on the booking; the salon is also who issues your receipt. Platform use is free for customers.'],
      ['2. Booking', 'When you pick a time, the seat is held for a few minutes while you confirm ("seat before money"). A booking exists once you complete the confirmation step and receive a reference number. Prices shown include VAT; deposits, where a salon requires one, are stated before payment.'],
      ['3. Cancelling and moving', 'Each salon sets its own cancellation policy — the free-cancellation window, late-cancellation and no-show fees. The policy in force is the one shown at booking, and it is frozen onto your booking from that moment; a salon changing its rules later does not change your booking. Within the free window you can cancel or move the appointment yourself; after it, fees may apply as stated.'],
      ['4. Prices', 'Salons may price differently by time and demand. Every deviation from a base price is itemised on the price you accept and on your receipt. Prime flexible bookings carry their surcharge openly.'],
      ['5. Conduct', 'Reviews must relate to a real visit. Salons answer reviews publicly under their own name. Repeated no-shows may lead a salon to require deposits.'],
      ['6. Accounts and termination', 'You can delete your account yourself at any time in the Account tab; salons can disconnect their shop themselves. Statutory retention duties on issued receipts remain with the salon.'],
      ['7. Demo notice', 'This deployment is a demonstration. No real payments are collected and no real appointments are created.'],
    ],
  },
  de: {
    title: 'Nutzungsbedingungen (AGB)',
    lead: 'Die Kurzfassung: Die Plattform vermittelt den Termin, der Salon erbringt ihn, und jede Regel, an der du gemessen wirst, stand vor der Zahlung fest.',
    s: [
      ['1. Mit wem du den Vertrag schließt', 'StyleNow betreibt eine Buchungsplattform. Der Dienstleistungsvertrag über einen Termin kommt zwischen dir und dem auf der Buchung genannten Salon zustande; der Salon stellt auch deinen Beleg aus. Die Nutzung der Plattform ist für Kundinnen und Kunden kostenlos.'],
      ['2. Buchung', 'Wählst du eine Zeit, wird der Platz für einige Minuten gehalten, während du bestätigst („erst der Platz, dann das Geld"). Eine Buchung besteht, sobald du den Bestätigungsschritt abschließt und eine Referenznummer erhältst. Angezeigte Preise enthalten die USt; Anzahlungen, wo ein Salon sie verlangt, stehen vor der Zahlung fest.'],
      ['3. Stornieren und Verschieben', 'Jeder Salon bestimmt seine eigenen Stornoregeln — kostenloses Stornofenster, Gebühren für späte Absagen und Nichterscheinen. Es gilt die bei der Buchung angezeigte Regelung, und sie wird in diesem Moment in deiner Buchung eingefroren; ändert ein Salon später seine Regeln, ändert das deine Buchung nicht. Im kostenlosen Fenster kannst du selbst stornieren oder verschieben; danach können die genannten Gebühren anfallen.'],
      ['4. Preise', 'Salons dürfen nach Zeit und Nachfrage unterschiedlich bepreisen. Jede Abweichung vom Grundpreis wird auf dem akzeptierten Preis und auf deinem Beleg einzeln ausgewiesen. Prime-Flexbuchungen tragen ihren Aufschlag offen.'],
      ['5. Verhalten', 'Bewertungen müssen sich auf einen echten Besuch beziehen. Salons antworten öffentlich unter eigenem Namen. Wiederholtes Nichterscheinen kann dazu führen, dass ein Salon Anzahlungen verlangt.'],
      ['6. Konten und Beendigung', 'Du kannst dein Konto jederzeit selbst im Konto-Bereich löschen; Salons können ihren Shop selbst trennen. Gesetzliche Aufbewahrungspflichten für ausgestellte Belege bleiben beim Salon.'],
      ['7. Demo-Hinweis', 'Diese Installation ist eine Demonstration. Es werden keine echten Zahlungen eingezogen und keine echten Termine vereinbart.'],
    ],
  },
};

export default function TermsPage() {
  const { lang } = useI18n();
  const c = C[lang];
  return (
    <InfoPage
      title={c.title}
      lead={c.lead}
      sections={c.s.map(([h, p]) => ({ heading: h, body: <p>{p}</p> }))}
    />
  );
}
