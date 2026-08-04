'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, distance } from '@/lib/format';

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
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      category: category ?? undefined,
      wantsSoon,
      personalisationConsent: personalise,
      budgetCents: budget ?? undefined,
      locale: lang,
    }),
    [search, category, wantsSoon, personalise, budget, lang],
  );

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(query),
      });
      const data = await res.json();
      setCards(data.shops);
    }, 180);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  return (
    <div>
      <section className="hero">
        <div className="loc">📍 {t('all_districts')}</div>
        <h1>{t('hero_title')}</h1>
        <p>{t('hero_sub')}</p>
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
      </div>

      {cards === null ? (
        <div className="spinner" />
      ) : cards.length === 0 ? (
        <div className="empty">
          <div className="big">🪞</div>
          {t('no_results')}
        </div>
      ) : (
        <div className="feed-grid">
          {cards.map((c) => (
            <ShopCard key={c.shopId} card={c} />
          ))}
        </div>
      )}

      <p className="demo-note">{t('demo_note')}</p>
    </div>
  );
}

function ShopCard({ card }: { card: Card }) {
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
