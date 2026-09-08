'use client';
/**
 * The last-minute deal board: today's and tomorrow's dead gaps, marketplace-
 * wide, at the discount the pricing rules already give them. Nothing here is
 * invented for the page — the board just goes looking for what the booking
 * grid would show anyway, and puts the best of it in one place.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { money, timeOf } from '@/lib/format';
import { apiLastMinuteDeals } from '@/lib/api';
import type { Deal } from '@/core/store';
import { todayIso } from '@/core/time';

export default function DealsPage() {
  const { t, lang } = useI18n();
  const [deals, setDeals] = useState<Deal[] | null>(null);

  useEffect(() => {
    void apiLastMinuteDeals().then(setDeals);
  }, []);

  return (
    <div>
      <div className="page-title">
        <h1>⚡ {t('dl_title')}</h1>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0 0 14px' }}>{t('dl_hint')}</p>
      {deals === null ? (
        <div className="spinner" />
      ) : deals.length === 0 ? (
        <div className="empty">
          <div className="big">⚡</div>
          <p>{t('dl_empty')}</p>
        </div>
      ) : (
        deals.map((d) => (
          <Link
            key={`${d.shopId}-${d.start}`}
            className="nb-card"
            href={`/shops/${d.slug}/book?service=${d.serviceId}&date=${d.iso}&at=${d.start}`}
          >
            <span className="nb-emoji">{d.emoji}</span>
            <span className="nb-main">
              <b>{d.shopName}</b>
              <span>
                {d.serviceName[lang]} · {d.district} · {d.iso === todayIso() ? t('today') : t('nu_tomorrow')}{' '}
                {timeOf(d.start, lang)}
              </span>
            </span>
            <span className="nb-side">
              <s style={{ opacity: 0.6 }}>{money(d.basePriceCents, lang)}</s>
              <b style={{ color: 'var(--teal)' }}>{money(d.priceCents, lang)} · −{d.offPct}%</b>
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
