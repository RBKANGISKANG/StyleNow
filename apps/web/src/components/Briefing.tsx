'use client';
/**
 * "What needs you today" — the first thing a shop sees when it opens the
 * dashboard.
 *
 * A back office full of tabs is only useful if you know which tab to open.
 * This reads the data that already exists and says the three or four things
 * that actually want a decision this morning: people waiting for a slot that
 * has since opened, reviews nobody answered, tomorrow standing half empty,
 * customers who have not been back in a while.
 *
 * It renders nothing when there is nothing to say. A briefing that always has
 * items is a to-do list nobody reads.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money } from '@/lib/format';
import {
  apiShopWaitlist,
  apiShopReviewsForOwner,
  apiShopCalendar,
  apiShopCustomers,
} from '@/lib/api';
import { todayIso, addDays } from '@/core/time';

interface Item {
  key: string;
  icon: string;
  text: string;
  href: string;
  cta: string;
  tone: 'urgent' | 'normal';
}

export function Briefing({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    const today = todayIso();

    void Promise.all([
      apiShopWaitlist(shopId, today),
      apiShopReviewsForOwner(shopId),
      apiShopCalendar(shopId, today, addDays(today, 6)),
      apiShopCustomers(shopId),
    ]).then(([waiting, reviews, week, customers]) => {
      if (!alive) return;
      const out: Item[] = [];

      // Someone asked to be told when a day frees up — and it has.
      const callable = waiting.filter((w) => w.freeSlots > 0);
      if (callable.length > 0) {
        out.push({
          key: 'waitlist',
          icon: '⏳',
          text: t('bf_waitlist', { n: String(callable.length) }),
          href: '/dashboard',
          cta: t('bf_see'),
          tone: 'urgent',
        });
      }

      const unanswered = reviews.filter((r) => !r.reply);
      if (unanswered.length > 0) {
        out.push({
          key: 'reviews',
          icon: '⭐',
          text: t('bf_reviews', { n: String(unanswered.length) }),
          href: '/dashboard/customers',
          cta: t('rv_reply'),
          tone: unanswered.some((r) => r.rating <= 3) ? 'urgent' : 'normal',
        });
      }

      // Tomorrow is the last day you can still fill.
      const tomorrow = week.find((d) => d.iso === addDays(today, 1));
      if (tomorrow && tomorrow.staffOn > 0 && !tomorrow.closed && tomorrow.occupancyPct < 50) {
        out.push({
          key: 'tomorrow',
          icon: '📉',
          text: t('bf_quiet', { pct: String(tomorrow.occupancyPct) }),
          href: '/dashboard',
          cta: t('bf_see'),
          tone: 'normal',
        });
      }

      // Regulars who have drifted: been in more than once, nothing booked, and
      // it has been longer than their usual gap.
      const now = Date.now();
      const lapsed = customers.filter(
        (c) => c.visits >= 2 && c.nextVisit === null && c.lastVisit !== null && now - c.lastVisit > 70 * 864e5,
      );
      if (lapsed.length > 0) {
        out.push({
          key: 'lapsed',
          icon: '💬',
          text: t('bf_lapsed', { n: String(lapsed.length) }),
          href: '/dashboard/customers',
          cta: t('bf_see'),
          tone: 'normal',
        });
      }

      // Money already on the books for the week — the one line that is good news.
      const booked = week.reduce((sum, d) => sum + d.revenueCents, 0);
      if (out.length > 0 && booked > 0) {
        out.push({
          key: 'week',
          icon: '📈',
          text: t('bf_week', { value: money(booked, lang) }),
          href: '/dashboard/revenue',
          cta: t('bf_see'),
          tone: 'normal',
        });
      }

      setItems(out);
    });

    return () => {
      alive = false;
    };
  }, [shopId, t, lang]);

  if (!items || items.length === 0) return null;

  return (
    <section className="section">
      <h2>☀️ {t('bf_title')}</h2>
      <div className="bf-list">
        {items.map((i) => (
          <Link key={i.key} href={i.href} className={`bf-item ${i.tone}`}>
            <span className="bf-ico">{i.icon}</span>
            <span className="bf-text">{i.text}</span>
            <span className="bf-cta">{i.cta} →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
