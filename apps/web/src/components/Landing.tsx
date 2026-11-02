'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money } from '@/lib/format';
import { allShops } from '@/core/store';

export function RotatingWord() {
  const { t } = useI18n();
  const words = t('lp_rot').split('|');
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % words.length), 2400);
    return () => clearInterval(id);
  }, [words.length]);
  return (
    <span className="rot" aria-live="off">
      <span key={`${words[i]}-${i}`} className="rot-word">
        {words[i % words.length]}
      </span>
    </span>
  );
}

export function HeroStats() {
  const { t } = useI18n();
  const { count, avg } = useMemo(() => {
    const shops = allShops();
    const reviews = shops.reduce((n, s) => n + s.ratingCount, 0);
    const weighted = shops.reduce((n, s) => n + s.ratingAvg * s.ratingCount, 0);
    return { count: shops.length, avg: reviews ? weighted / reviews : 0 };
  }, []);
  return (
    <div className="hero-stats">
      <div><b>{count}</b><span>{t('lp_shops')}</span></div>
      <div><b>★ {avg.toFixed(1)}</b><span>{t('lp_rating')}</span></div>
      <div><b>60s</b><span>{t('lp_fast')}</span></div>
    </div>
  );
}

/** Popular services from real shops, cycling like a live board. */
export function HeroVisual() {
  const { t, lang } = useI18n();
  const items = useMemo(
    () =>
      allShops()
        .flatMap((s) =>
          s.services
            .filter((v) => v.popular)
            .slice(0, 1)
            .map((v) => ({ slug: s.slug, shop: s.name, emoji: v.emoji, svc: v.name[lang], price: v.basePriceCents, grad: s.gradient, rating: s.ratingAvg, district: s.district })),
        )
        .slice(0, 8),
    [lang],
  );
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % items.length), 3200);
    return () => clearInterval(id);
  }, [items.length]);
  if (!items.length) return null;
  const visible = [0, 1, 2].map((k) => items[(i + k) % items.length]);
  return (
    <div className="hero-visual" aria-hidden>
      <div className="hv-label"><span className="live-dot" /> {t('lp_trending')}</div>
      {visible.map((it, k) => (
        <div key={`${it.slug}-${i}-${k}`} className={`hv-card hv-${k}`}>
          <div className="hv-thumb" style={{ background: `linear-gradient(135deg, ${it.grad[0]}, ${it.grad[1]})` }}>{it.emoji}</div>
          <div className="hv-body">
            <b>{it.svc}</b>
            <span>{it.shop} · {it.district}</span>
          </div>
          <div className="hv-side">
            <b>{money(it.price, lang)}</b>
            <span>★ {it.rating.toFixed(1)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const STEPS = [
  { n: '01', k: 'lp_s1', d: 'lp_s1d', ico: '🔎' },
  { n: '02', k: 'lp_s2', d: 'lp_s2d', ico: '🗓️' },
  { n: '03', k: 'lp_s3', d: 'lp_s3d', ico: '✨' },
] as const;

const WHY = [
  { k: 'lp_w1', d: 'lp_w1d', ico: '💶', tone: 'amber' },
  { k: 'lp_w2', d: 'lp_w2d', ico: '⚡', tone: 'teal' },
  { k: 'lp_w3', d: 'lp_w3d', ico: '💳', tone: 'violet' },
  { k: 'lp_w4', d: 'lp_w4d', ico: '🛡️', tone: 'rose' },
] as const;

export function LandingSections() {
  const { t } = useI18n();
  return (
    <>
      <section className="lp-block reveal">
        <p className="eyebrow">{t('lp_how')}</p>
        <h2 className="lp-h2">{t('lp_how_sub')}</h2>
        <div className="lp-steps">
          {STEPS.map((s) => (
            <div key={s.n} className="lp-step reveal">
              <span className="lp-num">{s.n}</span>
              <span className="lp-ico">{s.ico}</span>
              <h3>{t(s.k)}</h3>
              <p>{t(s.d)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-block reveal">
        <h2 className="lp-h2">{t('lp_why')}</h2>
        <div className="lp-why">
          {WHY.map((w) => (
            <div key={w.k} className={`lp-why-card tone-${w.tone} reveal`}>
              <span className="lp-ico">{w.ico}</span>
              <h3>{t(w.k)}</h3>
              <p>{t(w.d)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-biz reveal">
        <div>
          <h2>{t('lp_biz')}</h2>
          <p>{t('lp_biz_d')}</p>
        </div>
        <Link href="/partner" className="btn lp-biz-cta">
          {t('lp_biz_cta')} →
        </Link>
      </section>
    </>
  );
}
