'use client';
/**
 * Contact — routed honestly.
 *
 * A static site cannot send mail, so the "form" builds a mailto and opens the
 * visitor's own mail app with everything pre-filled. And the two questions
 * people actually arrive with — "ask my salon something" and "get my business
 * on here" — are routed to the tools built for them instead of into an inbox.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { InfoPage } from '@/components/InfoPage';

const CONTACT_EMAIL = 'hello@stylenow.example';

const C = {
  en: {
    title: 'Contact us',
    lead: 'Questions about a booking usually belong with your salon — for everything else, we read every message.',
    salon_h: 'A question for your salon?',
    salon_p: 'Times, services, running late — message the salon directly. They answer from their own desk.',
    salon_cta: 'Open messages',
    biz_h: 'You run a salon?',
    biz_p: 'Registration takes a few minutes and your page is live the moment it’s approved.',
    biz_cta: 'Partner registration',
    form_h: 'Everything else',
    ph_subject: 'Subject',
    ph_body: 'Your message…',
    send: 'Open in your mail app',
    note: `This opens your own email app addressed to ${CONTACT_EMAIL} — nothing is sent until you press send there.`,
  },
  de: {
    title: 'Kontakt',
    lead: 'Fragen zu einer Buchung gehören meist zu deinem Salon — für alles andere lesen wir jede Nachricht.',
    salon_h: 'Eine Frage an deinen Salon?',
    salon_p: 'Zeiten, Leistungen, Verspätung — schreib dem Salon direkt. Er antwortet vom eigenen Tresen aus.',
    salon_cta: 'Nachrichten öffnen',
    biz_h: 'Du führst einen Salon?',
    biz_p: 'Die Registrierung dauert ein paar Minuten, und deine Seite ist mit der Freigabe sofort online.',
    biz_cta: 'Partner-Registrierung',
    form_h: 'Alles andere',
    ph_subject: 'Betreff',
    ph_body: 'Deine Nachricht…',
    send: 'In deinem Mail-Programm öffnen',
    note: `Öffnet dein eigenes E-Mail-Programm, adressiert an ${CONTACT_EMAIL} — gesendet wird erst, wenn du dort auf Senden drückst.`,
  },
};

export default function ContactPage() {
  const { lang } = useI18n();
  const c = C[lang];
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <InfoPage
      title={c.title}
      lead={c.lead}
      sections={[
        {
          body: (
            <div className="contact-cards">
              <div className="contact-card">
                <h3>💬 {c.salon_h}</h3>
                <p>{c.salon_p}</p>
                <Link href="/messages" className="btn btn-soft sm">{c.salon_cta}</Link>
              </div>
              <div className="contact-card">
                <h3>💼 {c.biz_h}</h3>
                <p>{c.biz_p}</p>
                <Link href="/partner" className="btn btn-soft sm">{c.biz_cta}</Link>
              </div>
            </div>
          ),
        },
        {
          heading: c.form_h,
          body: (
            <div className="contact-form">
              <input className="input" placeholder={c.ph_subject} value={subject} maxLength={120}
                onChange={(e) => setSubject(e.target.value)} />
              <textarea className="input" rows={5} placeholder={c.ph_body} value={body} maxLength={2000}
                onChange={(e) => setBody(e.target.value)} />
              <a className={`btn btn-primary${subject.trim() || body.trim() ? '' : ' disabled'}`} href={href}>
                ✉️ {c.send}
              </a>
              <p className="info-fine">{c.note}</p>
            </div>
          ),
        },
      ]}
    />
  );
}
