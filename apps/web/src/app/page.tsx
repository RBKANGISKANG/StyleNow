'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, distance } from '@/lib/format';
import { apiMatch } from '@/lib/api';
import { GetApp } from '@/components/GetApp';
import { Heart } from '@/components/Heart';
import { useFavourites } from '@/lib/favs';
import { resolveLocation } from '@/core/geo';

const CATEGORIES = [
  { id: 'hair', emoji: '💇', en: 'Hair', de: 'Haare' },
  { id: 'barber', emoji: '💈', en: 'Barber', de: 'Barbier' },
  { id: 'nails', emoji: '💅', en: 'Nails', de: 'Nägel' },
  { id: 'brows', emoji: '👁️', en: 'Brows', de: 'Brauen' },
  { id: 'mobile', emoji: '🚗', en: 'At home', de: 'Zu Hause' },
];

const BUDGETS = [3000, 6000, 10000, 20000];

interface Card {
  shopId: string;
  slug: string;
  name: string;
  category: string;
  district: string;
  emoji: string;
  gradient: [string, string];
  tagline: { en: string; de: string };
  ratingAvg: number;
  ratingCount: number;
  priceFromCents: number;
  distanceM: number;
  isNew: boolean;
  isMobile: boolean;
  reasons: string[];
  minutesToFirstSlot: number | null;
}

export default function Explore() {
  const { t, lang } = useI18n();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [wantsSoon, setWantsSoon] = useState(false);
  const [personalise, setPersonalise] = useState(false);
  const [budget, setBudget] = useState<number | null>(null);
  const [favsOnly, setFavsOnly] = useState(false);
  const [favs, toggleFav] = useFavourites();
  const [locInput, setLocInput] = useState('');
  const [loc, setLoc] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [locError, setLocError] = useState(false);
  const [radius, setRadius] = useState<number | null>(null);
  const [topRated, setTopRated] = useState(false);
  const [sortBy, setSortBy] = useState<'match' | 'distance' | 'price' | 'rating'>('match');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyLocation = (value: string) => {
    setLocError(false);
    if (!value.trim()) {
      setLoc(null);
      return;
    }
    const hit = resolveLocation(value);
    if (hit) setLoc(hit);
    else setLocError(true);
  };

  const useMyLocation = () => {
    setLocError(false);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: t('loc_mine') });
        setLocInput('');
      },
      () => setLocError(true),
      { timeout: 8000 },
    );
  };

  const query = useMemo(
    () => ({
      search: search || undefined,
      category: category ?? undefined,
      wantsSoon,
      personalisationConsent: personalise,
      budgetCents: budget ?? undefined,
      locale: lang,
      lat: loc?.lat,
      lng: loc?.lng,
      maxTravelM: radius ?? undefined,
      minRating: topRated ? 4.5 : undefined,
      sortBy,
    }),
    [search, category, wantsSoon, personalise, budget, lang, loc, radius, topRated, sortBy],
  );

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setCards(await apiMatch(query));
    }, 180);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  return (
    <div>
      <section className="hero">
        <div className="loc">📍 {loc ? loc.label : t('all_districts')}</div>
        <h1>{t('hero_title')}</h1>
        <p>{t('hero_sub')}</p>
        <div className="loc-row">
          <input
            className="loc-input"
            placeholder={t('loc_ph')}
            value={locInput}
            onChange={(e) => setLocInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyLocation(locInput)}
            onBlur={() => applyLocation(locInput)}
          />
          <button className="btn btn-hero-ghost" onClick={useMyLocation} title={t('loc_mine')}>
            📍 {t('loc_mine')}
          </button>
        </div>
        {locError && <p style={{ marginTop: 8, fontSize: '0.78rem', fontWeight: 600 }}>⚠️ {t('loc_unknown')}</p>}
      </section>

      <div className="search-row">
        <input
          className="search"
          placeholder={`🔍  ${t('search_ph')}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="cat-row">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={`cat-tile ${category === c.id ? 'active' : ''}`}
            onClick={() => setCategory(category === c.id ? null : c.id)}
          >
            <span className="ico">{c.emoji}</span>
            {lang === 'de' ? c.de : c.en}
          </button>
        ))}
      </div>

      <div className="filter-row">
        <button className={`chip ${wantsSoon ? 'on' : ''}`} onClick={() => setWantsSoon(!wantsSoon)}>
          ⚡ {t('f_soon')}
        </button>
        <button
          className={`chip ${personalise ? 'on-primary' : ''}`}
          onClick={() => setPersonalise(!personalise)}
          title={t('f_personalise_hint')}
        >
          ✨ {t('f_personalise')}
        </button>
        <button className={`chip ${favsOnly ? 'on-primary' : ''}`} onClick={() => setFavsOnly(!favsOnly)}>
          ❤️ {t('fav_only')}{favs.length ? ` (${favs.length})` : ''}
        </button>
        <button className={`chip ${topRated ? 'on' : ''}`} onClick={() => setTopRated(!topRated)}>
          ⭐ {t('top_rated')}
        </button>
        <label className="chip">
          💶 {t('budget')}
          <select value={budget ?? ''} onChange={(e) => setBudget(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('any_budget')}</option>
            {BUDGETS.map((b) => (
              <option key={b} value={b}>
                ≤ {money(b, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="chip">
          🧭 {t('radius_label')}
          <select value={radius ?? ''} onChange={(e) => setRadius(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('radius_any')}</option>
            <option value={1000}>≤ 1 km</option>
            <option value={2000}>≤ 2 km</option>
            <option value={5000}>≤ 5 km</option>
          </select>
        </label>
        <label className="chip">
          ↕️ {t('sort_label')}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="match">{t('sort_match')}</option>
            <option value="distance">{t('sort_distance')}</option>
            <option value="price">{t('sort_price')}</option>
            <option value="rating">{t('sort_rating')}</option>
          </select>
        </label>
      </div>

      {cards === null ? (
        <div className="spinner" />
      ) : (() => {
        const visible = favsOnly ? cards.filter((c) => favs.includes(c.shopId)) : cards;
        return visible.length === 0 ? (
          <div className="empty">
            <div className="big">🪞</div>
            {t('no_results')}
          </div>
        ) : (
          <div className="feed-grid">
            {visible.map((c) => (
              <ShopCard key={c.shopId} card={c} fav={favs.includes(c.shopId)} onFav={() => toggleFav(c.shopId)} />
            ))}
          </div>
        );
      })()}

      <GetApp />

      <p className="demo-note">{t('demo_note')}</p>
    </div>
  );
}

function ShopCard({ card, fav, onFav }: { card: Card; fav: boolean; onFav: () => void }) {
  const { t, lang } = useI18n();
  const reasonLabel = (r: string): string | null => {
    const key = `r_${r}` as MsgKey;
    const label = t(key);
    return label === key ? null : label;
  };
  return (
    <Link href={`/shops/${card.slug}`} className="shop-card">
      <div
        className="shop-cover"
        style={{ background: `linear-gradient(135deg, ${card.gradient[0]}, ${card.gradient[1]})` }}
      >
        <span>{card.emoji}</span>
        <div className="badges">
          {card.isNew && <span className="badge amber">{t('new_badge')}</span>}
          {card.isMobile && <span className="badge teal">{t('mobile_badge')}</span>}
        </div>
        <button
          className="fav-btn"
          aria-label="favourite"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFav();
          }}
        >
          <Heart on={fav} />
        </button>
      </div>
      <div className="shop-body">
        <div className="shop-title">
          <h3>{card.name}</h3>
          <span className="rating">
            <span className="star">★</span> {card.ratingAvg.toFixed(1)}
            <span className="count">({card.ratingCount})</span>
          </span>
        </div>
        <div className="shop-meta">
          {card.district} · {distance(card.distanceM, lang)} {t('away')}
        </div>
        <div className="reason-row">
          {card.reasons.slice(0, 3).map((r) => {
            const label = reasonLabel(r);
            if (!label) return null;
            return (
              <span key={r} className={`reason ${r === 'higher_cancellation_rate' ? 'warn' : ''}`}>
                {label}
              </span>
            );
          })}
        </div>
        <div className="shop-foot">
          <span className="price">
            {t('from')} {money(card.priceFromCents, lang)}
          </span>
          {card.minutesToFirstSlot !== null && (
            <span className="slot">
              {card.minutesToFirstSlot <= 12 * 60
                ? `⚡ ${t('next_free')} ${t('in_min', { m: card.minutesToFirstSlot })}`
                : `${t('next_free')}: ${Math.round(card.minutesToFirstSlot / (24 * 60))}d`}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
