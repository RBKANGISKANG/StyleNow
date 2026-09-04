'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NextUp } from '@/components/NextUp';
import Link from 'next/link';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, distance } from '@/lib/format';
import { apiMatch } from '@/lib/api';
import { allShops } from '@/core/store';
import { GetApp } from '@/components/GetApp';
import { FeedMap } from '@/components/FeedMap';
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
  lat: number;
  lng: number;
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
  logoUrl: string | null;
  coverUrl: string | null;
}

const VIEW_KEY = 'stylenow.feed.view';

type View = 'grid' | 'list' | 'map';
const VIEWS: View[] = ['grid', 'list', 'map'];

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
  // Grid, list or map is a taste thing, so it is remembered rather than guessed.
  const [view, setView] = useState<View>('grid');
  // On a phone the filters live in a sheet instead of eating the first screen.
  const [sheetOpen, setSheetOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY) as View | null;
      if (saved && VIEWS.includes(saved)) setView(saved);
    } catch {
      // private mode — grid it is
    }
  }, []);

  const chooseView = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // ignore
    }
  };

  // Rotating to landscape crosses the breakpoint and the sheet stops being a
  // sheet — close it, or the scroll lock below outlives it.
  useEffect(() => {
    if (!sheetOpen) return;
    const mq = window.matchMedia('(min-width: 681px)');
    const onChange = () => mq.matches && setSheetOpen(false);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [sheetOpen]);

  // The sheet is modal on mobile; don't let the page scroll behind it.
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheetOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [sheetOpen]);

  const activeFilters =
    (wantsSoon ? 1 : 0) + (personalise ? 1 : 0) + (favsOnly ? 1 : 0) + (topRated ? 1 : 0) +
    (budget !== null ? 1 : 0) + (radius !== null ? 1 : 0) + (category !== null ? 1 : 0);

  const resetFilters = () => {
    setWantsSoon(false);
    setPersonalise(false);
    setFavsOnly(false);
    setTopRated(false);
    setBudget(null);
    setRadius(null);
    setCategory(null);
  };

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

      <NextUp />
      <RecentlyViewed />

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

      {sheetOpen && <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} />}

      <div className={`filter-row ${sheetOpen ? 'open' : ''}`} role={sheetOpen ? 'dialog' : undefined} aria-modal={sheetOpen || undefined}>
        <div className="sheet-head">
          <strong>{t('f_filters')}</strong>
          <button className="btn btn-ghost sm" onClick={() => setSheetOpen(false)} aria-label={t('f_close')}>✕</button>
        </div>
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

        <div className="sheet-foot">
          <button className="btn btn-soft" onClick={resetFilters} disabled={activeFilters === 0}>
            {t('f_reset')}
          </button>
          <button className="btn btn-primary" onClick={() => setSheetOpen(false)}>
            {t('f_show', { n: String(cards === null ? 0 : (favsOnly ? cards.filter((c) => favs.includes(c.shopId)) : cards).length) })}
          </button>
        </div>
      </div>

      <div className="results-bar">
        <button className="btn-filters" onClick={() => setSheetOpen(true)}>
          ⚙ {t('f_filters')}
          {activeFilters > 0 && <em>{activeFilters}</em>}
        </button>
        <span className="results-count">
          {cards === null
            ? '…'
            : t('f_results', {
                n: String((favsOnly ? cards.filter((c) => favs.includes(c.shopId)) : cards).length),
              })}
        </span>
        <div className="seg view-seg">
          <button className={view === 'grid' ? 'on' : ''} onClick={() => chooseView('grid')} aria-label={t('view_grid')} title={t('view_grid')}>
            <GridIcon />
          </button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => chooseView('list')} aria-label={t('view_list_feed')} title={t('view_list_feed')}>
            <ListIcon />
          </button>
          <button className={view === 'map' ? 'on' : ''} onClick={() => chooseView('map')} aria-label={t('view_map')} title={t('view_map')}>
            <MapIcon />
          </button>
        </div>
      </div>

      {cards === null ? (
        // Skeletons, not a spinner: the feed's shape appears immediately, so
        // the page settles into place instead of popping.
        <div className={view === 'list' ? 'feed-list' : 'feed-grid'}>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="sk-card" key={i} aria-hidden>
              <div className="sk-media" />
              <div className="sk-lines">
                <span className="sk-line w70" />
                <span className="sk-line w45" />
                <span className="sk-line w60" />
              </div>
            </div>
          ))}
        </div>
      ) : (() => {
        const visible = favsOnly ? cards.filter((c) => favs.includes(c.shopId)) : cards;
        return visible.length === 0 ? (
          <div className="empty">
            <div className="big">🪞</div>
            {t('no_results')}
          </div>
        ) : view === 'map' ? (
          <FeedMap pins={visible} />
        ) : (
          <div className={view === 'list' ? 'feed-list' : 'feed-grid'}>
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

/* Emoji glyphs for these read as noise at 16px; two rects and three lines
   say "tiles" and "rows" unmistakably. */
function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
      <rect x="0" y="0" width="7" height="7" rx="1.6" />
      <rect x="9" y="0" width="7" height="7" rx="1.6" />
      <rect x="0" y="9" width="7" height="7" rx="1.6" />
      <rect x="9" y="9" width="7" height="7" rx="1.6" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
      <rect x="0" y="1" width="16" height="3" rx="1.5" />
      <rect x="0" y="6.5" width="16" height="3" rx="1.5" />
      <rect x="0" y="12" width="16" height="3" rx="1.5" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M8 14.5s4.6-4.3 4.6-7.6A4.6 4.6 0 0 0 8 2.4a4.6 4.6 0 0 0-4.6 4.5c0 3.3 4.6 7.6 4.6 7.6Z" strokeLinejoin="round" />
      <circle cx="8" cy="6.9" r="1.8" />
    </svg>
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
      {/* A photograph if the salon has uploaded one; otherwise the gradient and
          their mark, which is a placeholder that at least looks deliberate. */}
      <div
        className={`shop-cover${card.coverUrl ? ' shot' : ''}`}
        style={
          card.coverUrl
            ? { backgroundImage: `url(${card.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : { background: `linear-gradient(135deg, ${card.gradient[0]}, ${card.gradient[1]})` }
        }
      >
        {card.coverUrl ? null : card.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.logoUrl} alt="" className="shop-logo" />
        ) : (
          <span>{card.emoji}</span>
        )}
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

/** The salons you just looked at — the tab you closed too soon. */
function RecentlyViewed() {
  const { t } = useI18n();
  const [slugs, setSlugs] = useState<string[]>([]);
  useEffect(() => {
    try {
      setSlugs(JSON.parse(localStorage.getItem('sn-seen') ?? '[]'));
    } catch {
      // ignore
    }
  }, []);
  const shops = allShops().filter((s) => slugs.includes(s.slug));
  if (shops.length === 0) return null;
  const ordered = slugs.map((sl) => shops.find((s) => s.slug === sl)).filter(Boolean) as typeof shops;
  return (
    <div className="seen-strip">
      <span className="seen-label">{t('seen_title')}:</span>
      {ordered.map((s) => (
        <Link key={s.id} className="chip" href={`/shops/${s.slug}`}>
          {s.emoji} {s.name}
        </Link>
      ))}
    </div>
  );
}
