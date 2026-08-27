'use client';
/**
 * Real, bookable times on the shop's own page.
 *
 * Until now a customer landing here had to press Book, choose a service,
 * choose a day and only then find out the shop has nothing free until Friday.
 * That is four taps to answer one question — *can I get in?* — and the answer
 * arrives too late to be useful. These are live slots: tapping one lands in the
 * booking flow with that service, day and time already chosen.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money, timeOf, weekdayShort } from '@/lib/format';
import { apiNextOpenings } from '@/lib/api';
import type { Opening } from '@/core/store';
import { todayIso, addDays } from '@/core/time';

interface Svc {
  id: string;
  name: { en: string; de: string };
  popular: boolean;
}

export function NextOpenings({ shopId, slug, services }: { shopId: string; slug: string; services: Svc[] }) {
  const { t, lang } = useI18n();
  // Whatever the shop leads with — the popular service if it named one. A
  // haircut and a full colour have very different availability, so the strip
  // has to say which service it is answering for.
  const service = services.find((s) => s.popular) ?? services[0];
  const [openings, setOpenings] = useState<Opening[] | null>(null);

  useEffect(() => {
    if (!service) return;
    let alive = true;
    void apiNextOpenings(shopId, [service.id], 6).then((o) => {
      if (alive) setOpenings(o);
    });
    return () => {
      alive = false;
    };
  }, [shopId, service]);

  if (!service || openings === null) return null;

  const today = todayIso();
  const dayLabel = (iso: string) =>
    iso === today ? t('no_today') : iso === addDays(today, 1) ? t('no_tomorrow') : weekdayShort(iso, lang);

  return (
    <section className="section">
      <h2>⚡ {t('no_title')}</h2>
      <p className="no-sub">{t('no_sub', { service: service.name[lang] })}</p>
      {openings.length === 0 ? (
        <div className="panel muted">{t('no_none')}</div>
      ) : (
        <div className="no-grid">
          {openings.map((o) => (
            <Link
              key={o.start}
              className="no-slot"
              href={`/shops/${slug}/book?service=${service.id}&date=${o.iso}&at=${o.start}`}
            >
              <span className="no-day">{dayLabel(o.iso)}</span>
              <span className="no-time">{timeOf(o.start, lang)}</span>
              <span className="no-price">{money(o.priceCents, lang)}</span>
            </Link>
          ))}
        </div>
      )}
      <Link className="btn btn-soft sm" href={`/shops/${slug}/book?service=${service.id}`}>
        {t('no_more')} →
      </Link>
    </section>
  );
}
