'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ShareShop } from '@/components/ShareShop';
import { NextOpenings } from '@/components/NextOpenings';
import { ShopGallery } from '@/components/ShopGallery';
import { HoursTable, OpenBadge, useShopHours } from '@/components/ShopHours';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, weekdayShort } from '@/lib/format';
import { apiShopReviews, apiShopLogo, apiShopPhotos, apiShopServices, apiShopAnnouncement, apiShopTrust, apiDayForecast, apiStampStatus, apiPublicQueue, apiPackageOffers, apiBuyPackage, apiMembershipOffer, apiMyMembership, apiJoinMembership, apiLeaveMembership, apiAccessFacts, apiStaffPhotos, apiShopStaffMeta, apiRequestQuote } from '@/lib/api';
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
  tags?: string[];
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
  kidsFriendly: boolean;
  premium: boolean;
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
    adultsOnly: boolean;
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
              {shop.kidsFriendly && <span>🧒 {t('kids_badge')}</span>}
              {shop.premium && <span>👑 {t('premium_badge')}</span>}
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
                    {s.adultsOnly && <span className="mini-badge" title={t('adults_hint')}>18+</span>}
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
        <PackagesPromo shopId={shop.id} />
        <MembershipPromo shopId={shop.id} shopName={shop.name} />
        <QuoteBox shop={shop} />
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
            <TeamCard key={s.id} shopId={shop.id} staff={s} color={AVATAR_COLORS[i % AVATAR_COLORS.length]} />
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{t('reviews')}</h2>
        {/* the countable compliments, shop-wide, before the individual voices */}
        {(() => {
          const counts = new Map<string, number>();
          for (const r of liveReviews) for (const tg of r.tags ?? []) counts.set(tg, (counts.get(tg) ?? 0) + 1);
          const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
          return top.length > 0 ? (
            <div className="addon-row" style={{ marginBottom: 10 }}>
              {top.map(([tg, n]) => (
                <span className="chip" key={tg} style={{ cursor: 'default' }}>
                  {t(`rt_${tg}` as MsgKey)} ×{n}
                </span>
              ))}
            </div>
          ) : null;
        })()}
        {liveReviews.map((r, i) => (
          <div className="review-card" key={`live-${i}`}>
            <div className="review-head">
              <span className="who">{r.author}</span>
              <span className="rating">
                <span className="star">{'★'.repeat(r.rating)}</span>
              </span>
            </div>
            {(r.tags ?? []).length > 0 && (
              <div className="addon-row" style={{ margin: '4px 0' }}>
                {(r.tags ?? []).map((tg) => (
                  <span className="chip sm" key={tg} style={{ cursor: 'default' }}>{t(`rt_${tg}` as MsgKey)}</span>
                ))}
              </div>
            )}
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
  const [queue, setQueue] = useState<{ queued: number; waitMin: number | null }>({ queued: 0, waitMin: null });
  const [access, setAccess] = useState<{ stepFree: boolean; wheelchairWC: boolean; quietCorner: boolean } | null>(null);
  const [forecast, setForecast] = useState<Array<{ iso: string; pct: number }>>([]);
  const [stampSt, setStampSt] = useState<Awaited<ReturnType<typeof apiStampStatus>> | null>(null);

  useEffect(() => {
    void apiShopAnnouncement(shopId).then(setAnnouncement);
    void apiShopTrust(shopId).then(setTrust);
    void apiPublicQueue(shopId).then(setQueue);
    void apiAccessFacts(shopId).then(setAccess);
    void apiDayForecast(shopId).then(setForecast);
    void apiStampStatus(shopId).then(setStampSt);
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
          {/* Reliability cuts both ways: a clean record is worth showing, a
              spotty one is worth knowing — and the sorry-voucher is policy. */}
          <span>
            🛡 {t('rel_title')}:{' '}
            {trust.shopCancels90 === 0 && trust.lateMoves90 === 0
              ? t('rel_clean')
              : t('rel_counts', { n: String(trust.shopCancels90), m: String(trust.lateMoves90) })}
          </span>
          <em>{t('tr_derived')}</em>
        </div>
      )}
      {trust && (trust.completed90 > 0 || trust.reviewCount > 0) && (
        /* the policy customers can rely on — visible, not a hover secret */
        <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', margin: '6px 2px 0' }}>🎁 {t('gw_policy')}</p>
      )}

      {/* Laufkundschaft: if there is a live queue, say so before someone
          walks over for nothing. */}
      {queue.queued > 0 && queue.waitMin !== null && (
        <div className="trust-strip" style={{ marginTop: 8 }}>
          <span>🚶 {t('wi_public', { n: String(queue.queued), min: String(queue.waitMin) })}</span>
        </div>
      )}

      {/* what the premises can honestly promise — before anyone travels */}
      {access && (access.stepFree || access.wheelchairWC || access.quietCorner) && (
        <div className="trust-strip" style={{ marginTop: 8 }}>
          {access.stepFree && <span>♿ {t('af_stepfree')}</span>}
          {access.wheelchairWC && <span>🚻 {t('af_wc')}</span>}
          {access.quietCorner && <span>🤫 {t('af_quiet')}</span>}
        </div>
      )}

      {stampSt?.enabled && (
        <div className="trust-strip" style={{ marginTop: 8 }}>
          <span>💮 {t('stamp_shop_badge', { n: String(stampSt.required) })}</span>
          {(stampSt.stamps > 0 || stampSt.rewardsAvailable > 0) && (
            <span>
              {stampSt.rewardsAvailable > 0
                ? `🎉 ${t('stamp_reward_ready')}`
                : t('stamp_your', { have: String(stampSt.stamps % stampSt.required), need: String(stampSt.required) })}
            </span>
          )}
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

/** The 5er-Karten on sale: money up front, visits whenever — one tap to own. */
/**
 * Custom work starts with a conversation, not a slot: tattoos, bridal looks
 * and concierge days have no fixed price on the menu. The request lands in
 * the ordinary message thread — the one channel a shop already answers —
 * and the reply arrives under "Messages". Only shown for shops that sell
 * consultation-first or 18+ work; everything else has honest menu prices.
 */
function QuoteBox({ shop }: { shop: ShopData }) {
  const { t, lang } = useI18n();
  const quotable = shop.services.filter((s) => s.adultsOnly);
  const [open, setOpen] = useState(false);
  const [svcId, setSvcId] = useState('');
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  if (shop.services.length === 0) return null;
  // "custom work" signal: 18+ services (needle work) or the shop's own
  // consultation-first treatments surfaced via the booking flow.
  const custom = quotable.length > 0 || ['tattoo', 'makeup'].includes(shop.category) || shop.premium;
  if (!custom) return null;
  if (sent) {
    return (
      <div className="panel" style={{ marginTop: 14 }}>
        <p style={{ fontSize: '0.9rem', fontWeight: 700 }}>✅ {t('qr_sent')}</p>
        <Link className="btn btn-soft sm" style={{ marginTop: 8 }} href={`/messages?shop=${shop.id}`}>
          💬 {t('mg_shop_thread')}
        </Link>
      </div>
    );
  }
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3>💬 {t('qr_title')}</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '4px 0 10px', lineHeight: 1.5 }}>{t('qr_hint')}</p>
      {!open ? (
        <button className="btn btn-soft sm" onClick={() => setOpen(true)}>{t('qr_open')}</button>
      ) : (
        <>
          <label className="chip">
            {t('qr_service')}
            <select value={svcId} onChange={(e) => setSvcId(e.target.value)}>
              <option value="">{t('qr_service_any')}</option>
              {shop.services.map((s) => (
                <option key={s.id} value={s.id}>{s.emoji} {s.name[lang]}</option>
              ))}
            </select>
          </label>
          <textarea
            className="input"
            style={{ marginTop: 8, minHeight: 72, resize: 'vertical' }}
            placeholder={t('qr_details_ph')}
            aria-label={t('qr_details_ph')}
            value={details}
            maxLength={500}
            onChange={(e) => setDetails(e.target.value)}
          />
          <button
            className="btn btn-primary sm"
            style={{ marginTop: 8 }}
            disabled={!details.trim()}
            onClick={() => {
              const svc = shop.services.find((s) => s.id === svcId);
              const text = `📋 ${t('qr_prefix')}${svc ? ` — ${svc.name[lang]}` : ''}: ${details.trim()}`;
              void apiRequestQuote(shop.id, text).then((ok) => {
                if (ok) setSent(true);
                else setFailed(true);
              });
            }}
          >
            {t('qr_send')}
          </button>
          {failed && <p className="pm-err" role="alert">{t('qr_failed')}</p>}
        </>
      )}
    </div>
  );
}

function PackagesPromo({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [offers, setOffers] = useState<Array<{ id: string; serviceId: string; count: number; priceCents: number }>>([]);
  const [services, setServices] = useState<Map<string, { name: { en: string; de: string }; basePriceCents: number }>>(new Map());
  const [bought, setBought] = useState<string | null>(null);

  useEffect(() => {
    void apiPackageOffers(shopId).then(setOffers);
    void apiShopServices(shopId).then((live) => {
      if (Array.isArray(live)) {
        setServices(new Map((live as Array<{ id: string; name: { en: string; de: string }; basePriceCents: number }>).map((s) => [s.id, s])));
      }
    });
  }, [shopId]);

  if (offers.length === 0) return null;
  return (
    <>
      {offers.map((o) => {
        const svc = services.get(o.serviceId);
        if (!svc) return null;
        const save = svc.basePriceCents * o.count - o.priceCents;
        return (
          <div className="gc-promo" key={o.id} style={{ marginTop: 8 }}>
            <span style={{ fontSize: '1.5rem' }} aria-hidden>🎟</span>
            <span style={{ flex: 1 }}>
              <strong>{o.count}× {svc.name[lang]} · {money(o.priceCents, lang)}</strong>
              <span className="gc-promo-sub">
                {save > 0 ? t('pk_save', { eur: money(save, lang) }) : t('pk_promo_sub')}
              </span>
            </span>
            {bought === o.id ? (
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--teal)' }}>✅ {t('pk_bought')}</span>
            ) : (
              <button
                className="btn btn-primary sm"
                onClick={() => {
                  void apiBuyPackage(shopId, o.id, { method: 'at_salon', label: 'Im Salon' }).then((pk) => {
                    if (pk) setBought(o.id);
                  });
                }}
              >
                {t('pk_buy')}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

/** The club: join in one tap, the discount applies to every future booking. */
function MembershipPromo({ shopId, shopName }: { shopId: string; shopName: string }) {
  const { t, lang } = useI18n();
  const [offer, setOffer] = useState<{ priceCents: number; discountPct: number } | null>(null);
  const [mine, setMine] = useState<{ since: number } | null>(null);

  const load = useCallback(() => {
    void apiMembershipOffer(shopId).then(setOffer);
    void apiMyMembership(shopId).then(setMine);
  }, [shopId]);
  useEffect(load, [load]);

  if (!offer) return null;
  return (
    <div className="gc-promo" style={{ marginTop: 8 }}>
      <span style={{ fontSize: '1.5rem' }} aria-hidden>💜</span>
      <span style={{ flex: 1 }}>
        <strong>{t('mb_promo_title', { shop: shopName })}</strong>
        <span className="gc-promo-sub">
          {t('mb_promo_sub', { price: money(offer.priceCents, lang), pct: offer.discountPct })}
        </span>
      </span>
      {mine ? (
        <button className="btn btn-ghost sm" onClick={() => void apiLeaveMembership(shopId).then(load)}>
          ✓ {t('mb_member')} · {t('mb_leave')}
        </button>
      ) : (
        <button className="btn btn-primary sm" onClick={() => void apiJoinMembership(shopId).then(load)}>
          {t('mb_join')}
        </button>
      )}
    </div>
  );
}


/** One stylist: name, role, the languages they serve in, and their work. */
function TeamCard({
  shopId,
  staff,
  color,
}: {
  shopId: string;
  staff: { id: string; name: string; role: { en: string; de: string }; tier: string };
  color: string;
}) {
  const { lang } = useI18n();
  const [photos, setPhotos] = useState<Array<{ id: string; dataUrl: string; caption: string }>>([]);
  const [langs, setLangs] = useState<string[]>([]);
  useEffect(() => {
    void apiStaffPhotos(staff.id).then(setPhotos);
    void apiShopStaffMeta(shopId, staff.id).then((l) => setLangs(l));
  }, [shopId, staff.id]);
  return (
    <div className="team-card">
      <div className="avatar" style={{ background: color }}>{staff.name[0]}</div>
      <div className="name">{staff.name}</div>
      <div className="role">{staff.role[lang]}</div>
      {langs.length > 0 && (
        <div className="role" style={{ marginTop: 2 }}>🗣 {langs.map((l) => l.toUpperCase()).join(' · ')}</div>
      )}
      {photos.length > 0 && (
        <div className="tc-shots">
          {photos.slice(0, 3).map((ph) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={ph.id} src={ph.dataUrl} alt={ph.caption} />
          ))}
        </div>
      )}
    </div>
  );
}