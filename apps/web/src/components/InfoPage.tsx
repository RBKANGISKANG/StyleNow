'use client';
/**
 * The shared frame for the site's information pages — about, contact, legal.
 *
 * Every one of these pages is prose in two languages, and the content lives in
 * the page files themselves rather than the shared i18n catalogue: a privacy
 * policy is one document with one author, not forty scattered keys, and
 * keeping each language's full text side by side in one place is what keeps
 * the two versions saying the same thing.
 */
import type { ReactNode } from 'react';

export interface InfoSection {
  heading?: string;
  body: ReactNode;
}

export function InfoPage({
  title,
  lead,
  sections,
  aside,
}: {
  title: string;
  lead?: string;
  sections: InfoSection[];
  aside?: ReactNode;
}) {
  return (
    <div className="info-page">
      <header className="info-head">
        <h1>{title}</h1>
        {lead && <p className="info-lead">{lead}</p>}
      </header>
      {aside}
      {sections.map((s, i) => (
        <section className="info-section" key={i}>
          {s.heading && <h2>{s.heading}</h2>}
          {s.body}
        </section>
      ))}
    </div>
  );
}
