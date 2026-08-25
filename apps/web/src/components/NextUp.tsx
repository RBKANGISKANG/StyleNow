'use client';
/**
 * The strip at the top of the explore feed that makes the app feel like it
 * knows you.
 *
 * Three states, in priority order — there is only ever one thing worth saying:
 *  1. You have an appointment coming up → count it down, and let you get to it.
 *  2. You came before but nothing is booked → say how long it has been and
 *     offer the same shop again. Rebooking is the single most common thing a
 *     returning customer wants and it took four taps to reach.
 *  3. Neither → say nothing at all. An empty widget is worse than no widget.
 *
 * The loyalty ring rides alongside once there is anything to show: a bare
 * number ("340 points") means nothing; "60 % of the way to €5 off" does.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money, timeOf } from '@/lib/format';
import { apiMyBookings, apiLoyaltyBalance } from '@/lib/api';

/** 100 points = €1, and the first meaningful reward is €5 off. */
const POINTS_PER_EURO = 100;
const REWARD_EUROS = 5;
const REWARD_POINTS = REWARD_EUROS * POINTS_PER_EURO;

interface Upcoming {
  reference: string;
  startsAt: number;
  shopName: string;
  shopEmoji: string;
  shopSlug: string | null;
  services: string;
}

interface LastVisit {
  shopName: string;
  shopEmoji: string;
  shopSlug: string;
  serviceIds: string[];
  daysAgo: number;
}

export function NextUp() {
  const { t, lang } = useI18n();
  const [next, setNext] = useState<Upcoming | null>(null);
  const [last, setLast] = useState<LastVisit | null>(null);
  const [points, setPoints] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([apiMyBookings(), apiLoyaltyBalance()]).then(([bookings, balance]) => {
      if (!alive) return;
      const now = Date.now();
      const upcoming = bookings
        .filter((b) => b.startsAt > now && ['confirmed', 'pending_payment'].includes(b.status))
        .sort((a, b) => a.startsAt - b.startsAt)[0];
      if (upcoming) {
        setNext({
          reference: upcoming.reference,
          startsAt: upcoming.startsAt,
          shopName: upcoming.shop?.name ?? '',
          shopEmoji: upcoming.shop?.emoji ?? '✨',
          shopSlug: upcoming.shop?.slug ?? null,
          services: upcoming.services.map((s) => s.name[lang]).join(', '),
        });
      } else {
        const past = bookings
          .filter((b) => b.startsAt <= now && ['completed', 'confirmed'].includes(b.status) && b.shop)
          .sort((a, b) => b.startsAt - a.startsAt)[0];
        if (past?.shop) {
          setLast({
            shopName: past.shop.name,
            shopEmoji: past.shop.emoji,
            shopSlug: past.shop.slug,
            serviceIds: past.serviceIds,
            daysAgo: Math.max(Math.round((now - past.startsAt) / 86_400_000), 0),
          });
        }
      }
      setPoints(balance);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [lang]);

  // Nothing to say yet, or nothing worth a whole card.
  if (!ready) return null;
  if (!next && !last && points === 0) return null;

  return (
    <div className="nextup">
      {next ? (
        <Link href="/bookings" className="nu-main">
          <span className="nu-ico">{next.shopEmoji}</span>
          <span className="nu-text">
            <strong>{t('nu_next', { when: relativeDay(next.startsAt, t) })}</strong>
            <span>
              {next.shopName} · {next.services} · {timeOf(next.startsAt, lang)}
            </span>
          </span>
          <span className="nu-go">{t('nu_view')} →</span>
        </Link>
      ) : last ? (
        <Link
          href={`/shops/${last.shopSlug}/book?service=${encodeURIComponent(last.serviceIds[0] ?? '')}`}
          className="nu-main"
        >
          <span className="nu-ico">{last.shopEmoji}</span>
          <span className="nu-text">
            <strong>{t('nu_rebook', { days: String(last.daysAgo) })}</strong>
            <span>{t('nu_rebook_sub', { shop: last.shopName })}</span>
          </span>
          <span className="nu-go">{t('nu_rebook_cta')} →</span>
        </Link>
      ) : null}

      {points > 0 && <LoyaltyRing points={points} />}
    </div>
  );
}

/**
 * Progress towards the next reward. A ring rather than a bar because it sits
 * beside text, not above a list — and it is labelled with the number inside,
 * so it never relies on the arc alone.
 */
function LoyaltyRing({ points }: { points: number }) {
  const { t, lang } = useI18n();
  const towards = points % REWARD_POINTS;
  const earned = Math.floor(points / REWARD_POINTS);
  const pct = earned > 0 && towards === 0 ? 100 : Math.round((towards / REWARD_POINTS) * 100);
  const r = 22;
  const c = 2 * Math.PI * r;

  return (
    <div className="nu-loyalty" title={t('loyalty_hint')}>
      <svg viewBox="0 0 56 56" width="52" height="52" role="img" aria-label={`${points} ${t('loyalty_balance')}`}>
        <circle cx="28" cy="28" r={r} className="ring-bg" />
        <circle
          cx="28"
          cy="28"
          r={r}
          className="ring-fg"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform="rotate(-90 28 28)"
        />
        <text x="28" y="32" textAnchor="middle" className="ring-num">
          {points}
        </text>
      </svg>
      <div className="nu-loyalty-text">
        <strong>{t('loyalty_balance')}</strong>
        <span>
          {earned > 0
            ? t('nu_reward_ready', { value: money(earned * REWARD_EUROS * 100, lang) })
            : t('nu_reward_to_go', {
                points: String(REWARD_POINTS - towards),
                value: money(REWARD_EUROS * 100, lang),
              })}
        </span>
      </div>
    </div>
  );
}

/** "today" / "tomorrow" / "in 5 days" — never a bare date for something close. */
function relativeDay(startsAt: number, t: (k: 'nu_today' | 'nu_tomorrow' | 'nu_in_days', v?: Record<string, string>) => string): string {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startsAt - startOfToday.getTime()) / 86_400_000);
  if (days <= 0) return t('nu_today');
  if (days === 1) return t('nu_tomorrow');
  return t('nu_in_days', { days: String(days) });
}
