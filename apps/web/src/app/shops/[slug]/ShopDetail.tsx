'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { money } from '@/lib/format';
import { apiShopReviews, apiShopLogo, apiShopServices } from '@/lib/api';
import { Heart } from '@/components/Heart';
import { useFavourites } from '@/lib/favs';

interface LiveReview {
  author: string;
  rating: number;
  text: string;
  date: string;
  serviceNames: Array<{ en: string; de: string }>;
  reply: { text: string; at: string } | null;
}

const AVATAR_COLORS = ['#f0566e', '#12a594', '#8b6cf0', '#f6a53c'];

export interface ShopData {
  id: string;
  slug: string;
  name: string;
  category: string;
  tagline: { en: string; de: string };
  about: { en: string; de: string };
  address: string;
  district: string;
  gradient: [string, string];
  emoji: string;
  languagesSpoken: string[];
  ratingAvg: number;
  ratingCount: number;
  isNew: boolean;
  isMobile: boolean;
  depositPercent: number;
  policy: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  services: Array<{
    id: string;
    emoji: string;
    name: { en: string; de: string };
    durationMin: number;
    processingGapMin: number;
    finishMin: number;
    basePriceCents: number;
    dynamicPricing: boolean;
    popular: boolean;
  }>;
  staff: Array<{ id: string; name: string; role: { en: string; de: string }; tier: string }>;
  reviews: Array<{ author: string; rating: number; text: { en: string; de: string }; service: string; date: string }>;
}

export function ShopDetail({ shop }: { shop: ShopData }) {
  const { t, lang } = useI18n();
  const [favs, toggleFav] = useFavourites();
  const [liveReviews, setLiveReviews] = useState<LiveReview[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // The shop can add or archive services at any time — always show the live menu.
  const [services, setServices] = useState(shop.services);
  const fav = favs.includes(shop.id);

  useEffect(() => {
    void apiShopReviews(shop.id).then(setLiveReviews);
    void apiShopLogo(shop.id).then(setLogoUrl);
    void apiShopServices(shop.id).then((live) => {
      if (Array.isArray(live) && live.length) setServices(live as ShopData['services']);
    });
  }, [shop.id]);

  return (
    <div>
      <section
        className="shop-hero"
        style={{ background: `linear-gradient(130deg, ${shop.gradient[0]}, ${shop.gradient[1]})` }}
      >
        <button className="fav-btn" aria-label="favourite" onClick={() => toggleFav(shop.id)}>
          <Heart on={fav} size={20} />
        </button>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="shop-logo-hero" />
          ) : (
            <span>{shop.emoji}</span>
          )}
          {shop.name}
        </h1>
        <p className="sub">{shop.tagline[lang]}</p>
        <div className="meta-row">
          <span>★ {shop.ratingAvg.toFixed(1)} ({shop.ratingCount})</span>
          <span>📍 {shop.district}</span>
          <span>🗣 {shop.languagesSpoken.map((l) => l.toUpperCase()).join(' · ')}</span>
          {shop.isMobile && <span>🚗 {t('mobile_badge')}</span>}
          {shop.isNew && <span>✨ {t('new_badge')}</span>}
        </div>
      </section>

      <section className="section">
        <h2>{t('services')}</h2>
        <div className="svc-list">
          {services.map((s) => {
            const totalMin = s.durationMin + s.processingGapMin + s.finishMin;
            return (
              <div className="svc-row" key={s.id}>
                <div className="svc-ico">{s.emoji}</div>
                <div className="svc-info">
                  <div className="name">
                    {s.name[lang]}
                    {s.popular && <span className="mini-badge pop">{t('popular')}</span>}
                    {s.dynamicPricing && <span className="mini-badge">{t('dynamic_badge')}</span>}
                  </div>
                  <div className="meta">
                    {totalMin} {t('min')}
                    {s.processingGapMin > 0 && ` · ${t('incl_processing', { m: s.processingGapMin })}`}
                  </div>
                </div>
                <div className="svc-price">{money(s.basePriceCents, lang)}</div>
                <Link className="btn btn-primary sm" href={`/shops/${shop.slug}/book?service=${s.id}`}>
                  {t('book')}
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <h2>{t('about')}</h2>
        <div className="panel">
          <p style={{ fontSize: '0.93rem' }}>{shop.about[lang]}</p>
          <p style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
            📍 {shop.address} · {t('free_until', { h: shop.policy.freeUntilHours })}
          </p>
        </div>
      </section>

      <section className="section">
        <h2>{t('team')}</h2>
        <div className="team-grid">
          {shop.staff.map((s, i) => (
            <div className="team-card" key={s.id}>
              <div className="avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                {s.name[0]}
              </div>
              <div className="name">{s.name}</div>
              <div className="role">{s.role[lang]}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{t('reviews')}</h2>
        {liveReviews.map((r, i) => (
          <div className="review-card" key={`live-${i}`}>
            <div className="review-head">
              <span className="who">{r.author}</span>
              <span className="rating">
                <span className="star">{'★'.repeat(r.rating)}</span>
              </span>
            </div>
            {r.text && <p>“{r.text}”</p>}
            <div className="svc">
              {r.serviceNames.map((n) => n[lang]).join(', ')} · {r.date}
            </div>
            {/* How a shop answers a review says as much as the rating does. */}
            {r.reply && (
              <div className="rv-reply">
                <strong>↩ {shop.name}</strong>
                <p>{r.reply.text}</p>
              </div>
            )}
          </div>
        ))}
        {shop.reviews.map((r, i) => (
          <div className="review-card" key={i}>
            <div className="review-head">
              <span className="who">{r.author}</span>
              <span className="rating">
                <span className="star">{'★'.repeat(r.rating)}</span>
              </span>
            </div>
            <p>“{r.text[lang]}”</p>
            <div className="svc">
              {r.service} · {r.date}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
