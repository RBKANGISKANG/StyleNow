'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShareShop } from '@/components/ShareShop';
import { NextOpenings } from '@/components/NextOpenings';
import { ShopGallery } from '@/components/ShopGallery';
import { HoursTable, OpenBadge, useShopHours } from '@/components/ShopHours';
import { useI18n } from '@/lib/i18n';
import { money, weekdayShort } from '@/lib/format';
import { apiShopReviews, apiShopLogo, apiShopPhotos, apiShopServices, apiShopAnnouncement, apiShopTrust, apiDayForecast } from '@/lib/api';
import { Heart } from '@/components/Heart';
import { Glyph, Icon } from '@/components/Icon';
import { ShopMap } from '@/components/ShopMap';
import { useStudio } from '@/lib/design';
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
  lat: number;
  lng: number;
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
  // The shop's own cover photo, if they have uploaded one. Until then the
  // gradient stands in — a marked placeholder, not a pretence.
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  // The shop can add or archive services at any time — always show the live menu.
  const [services, setServices] = useState(shop.services);
  const hours = useShopHours(shop.id);
  const studio = useStudio();
  const fav = favs.includes(shop.id);

  // Recently viewed, for the explore page's memory strip.
  useEffect(() => {
    try {
      const seen: string[] = JSON.parse(localStorage.getItem('sn-seen') ?? '[]');
      localStorage.setItem('sn-seen', JSON.stringify([shop.slug, ...seen.filter((x) => x !== shop.slug)].slice(0, 6)));
    } catch {
      // private mode — no memory, no harm
    }
  }, [shop.slug]);

  useEffect(() => {
    void apiShopReviews(shop.id).then(setLiveReviews);
    void apiShopLogo(shop.id).then(setLogoUrl);
    void apiShopPhotos(shop.id).then((ps) => setCoverUrl(ps[0]?.dataUrl ?? null));
    void apiShopServices(shop.id).then((live) => {
      if (Array.isArray(live) && live.length) setServices(live as ShopData['services']);
    });
  }, [shop.id]);

  return (
    <div>
      {/* The identity — logo, name, rating, whether we are open — is the same in
          both looks; only where it sits differs. Classic keeps it inside the
          gradient; studio lifts it onto a card overlapping the cover, so the
          band above can eventually carry a photograph. */}
      {(() => {
        const identity = (
          <>
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
              <span>
                <Glyph name="star" emoji="★" size={14} /> {shop.ratingAvg.toFixed(1)} ({shop.ratingCount})
              </span>
              <span>
                <Glyph name="pin" emoji="📍" size={14} /> {shop.district}
              </span>
              <span>
                <Glyph name="globe" emoji="🗣" size={14} />{' '}
                {shop.languagesSpoken.map((l) => l.toUpperCase()).join(' · ')}
              </span>
              {shop.isMobile && (
                <span>
                  <Glyph name="repeat" emoji="🚗" size={14} /> {t('mobile_badge')}
                </span>
              )}
              {shop.isNew && (
                <span>
                  <Glyph name="sparkle" emoji="✨" size={14} /> {t('new_badge')}
                </span>
              )}
              <OpenBadge hours={hours} />
            </div>
            <div style={{ marginTop: 12 }}>
              <ShareShop name={shop.name} slug={shop.slug} />
            </div>
          </>
        );

        const cover = (
          <section
            className={`shop-hero${studio ? ' cover' : ''}${coverUrl ? ' shot' : ''}`}
            style={
              coverUrl
                ? // The scrim keeps white text legible over an unknown photograph;
                  // without it every light-coloured salon interior loses the name.
                  {
                    backgroundImage: `linear-gradient(180deg, rgba(24,16,28,0.42), rgba(24,16,28,0.62)), url(${coverUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : { background: `linear-gradient(130deg, ${shop.gradient[0]}, ${shop.gradient[1]})` }
            }
          >
            <button className="fav-btn" aria-label="favourite" onClick={() => toggleFav(shop.id)}>
              <Heart on={fav} size={20} />
            </button>
            {studio ? (
              coverUrl ? null : (
                <span className="cover-mark">
                  <Icon name="image" size={13} strokeWidth={2} /> {t('cover_placeholder')}
                </span>
              )
            ) : (
              identity
            )}
          </section>
        );

        if (!studio) return cover;
        return (
          <>
            {cover}
            <section className="shop-id">{identity}</section>
          </>
        );
      })()}

      <NextOpenings shopId={shop.id} slug={shop.slug} services={services} />

      <ShopGallery shopId={shop.id} />

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

      {/* the demand curve customers can plan by, and the banner the shop set */}
      <ShopPulse shopId={shop.id} />

      <section className="section">
        <div className="gc-promo">
          <span style={{ fontSize: '1.5rem' }} aria-hidden>🎁</span>
          <span style={{ flex: 1 }}>
            <strong>{t('gc_promo_title')}</strong>
            <span className="gc-promo-sub">{t('gc_promo_sub')}</span>
          </span>
          <Link className="btn btn-soft sm" href={`/shops/${shop.slug}/gift`}>
            {t('gc_promo_cta')}
          </Link>
        </div>
      </section>

      <HoursTable hours={hours} />

      <section className="section">
        <h2>{t('about')}</h2>
        <div className="panel">
          <p style={{ fontSize: '0.93rem' }}>{shop.about[lang]}</p>
          <p style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
            <Glyph name="pin" emoji="📍" size={13} /> {t('free_until', { h: shop.policy.freeUntilHours })}
          </p>
        </div>
        {/* The address moves into the map, where it is next to the thing that
            answers what an address is really for. */}
        <div className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 14 }}>
          <ShopMap name={shop.name} address={shop.address} lat={shop.lat} lng={shop.lng} />
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

/**
 * The shop's live pulse for customers: an announcement if the shop set one,
 * trust numbers nobody can edit (all derived from real bookings), and a
 * seven-day busy-ness forecast — so "when should I come?" answers itself.
 */
function ShopPulse({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [announcement, setAnnouncement] = useState('');
  const [trust, setTrust] = useState<Awaited<ReturnType<typeof apiShopTrust>> | null>(null);
  const [forecast, setForecast] = useState<Array<{ iso: string; pct: number }>>([]);

  useEffect(() => {
    void apiShopAnnouncement(shopId).then(setAnnouncement);
    void apiShopTrust(shopId).then(setTrust);
    void apiDayForecast(shopId).then(setForecast);
  }, [shopId]);

  const open = forecast.filter((d) => d.pct >= 0);
  const quietest = open.length > 1 ? open.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;

  return (
    <>
      {announcement && <div className="shop-banner">📣 {announcement}</div>}

      {trust && (trust.completed90 > 0 || trust.reviewCount > 0) && (
        <div className="trust-strip">
          {trust.completed90 > 0 && <span>✂️ {t('tr_visits', { n: String(trust.completed90) })}</span>}
          {trust.repeatPct !== null && <span>🔁 {t('tr_repeat', { pct: String(trust.repeatPct) })}</span>}
          {trust.avgRating !== null && (
            <span>★ {trust.avgRating.toFixed(1)} · {t('tr_reviews', { n: String(trust.reviewCount) })}</span>
          )}
          <em>{t('tr_derived')}</em>
        </div>
      )}

      {open.length > 0 && (
        <section className="section">
          <h2>{t('fc_title')}</h2>
          <div className="panel">
            <div className="fc-bars">
              {forecast.map((d) => (
                <div key={d.iso} className="fc-day" title={d.pct >= 0 ? `${d.pct}%` : t('fc_closed')}>
                  <div className="fc-bar">
                    {d.pct >= 0 ? (
                      <div className={`fc-fill${d.pct >= 66 ? ' hot' : d.pct <= 33 ? ' cool' : ''}`} style={{ height: `${Math.max(d.pct, 6)}%` }} />
                    ) : (
                      <span className="fc-x">—</span>
                    )}
                  </div>
                  <span className="fc-dow">{weekdayShort(d.iso, lang)}</span>
                </div>
              ))}
            </div>
            {quietest && (
              <p className="fc-hint">
                💡 {t('fc_hint', { day: weekdayShort(quietest.iso, lang) })}
              </p>
            )}
          </div>
        </section>
      )}
    </>
  );
}
