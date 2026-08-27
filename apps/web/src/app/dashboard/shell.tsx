'use client';
/**
 * The frame every operator screen sits in.
 *
 * A salon's back office is five different jobs — running today, keeping the
 * menu, managing people, HR, and the shop's own settings — so each gets a tab
 * of its own instead of one endless scroll. The shell owns what all five share:
 * which shops the account may see, which one is selected, and the tab bar.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { apiClaimShop, apiOverview } from '@/lib/api';
import { useOwnedShops, type ShopRef } from '@/lib/owned-shops';
import { todayIso } from '@/core/time';

/** Shape of the dashboard payload, shared by every tab. */
export interface Overview {
  shop: {
    id: string;
    name: string;
    emoji: string;
    logoUrl: string | null;
    services: Array<{
      id: string;
      emoji: string;
      name: { en: string; de: string };
      durationMin: number;
      basePriceCents: number;
      dynamicPricing: boolean;
      categoryId?: string;
    }>;
    pricingRules: Array<{ id: string; name: string; enabled: boolean }>;
    locations: Array<{ id: string; label: string; street: string; zip: string; city: string; district: string }>;
  };
  isoDate: string;
  occupancyPct: number;
  revenueCents: number;
  bookingCount: number;
  staffRows: Array<{
    staffId: string;
    name: string;
    role: { en: string; de: string };
    tier: 'senior' | 'stylist';
    locationId: string | null;
    shifts: Partial<Record<number, Array<{ startMin: number; endMin: number }>>>;
    working: Array<{ start: number; end: number }>;
    blocks: Array<{
      kind: 'booking' | 'walk_in';
      bookingId?: string;
      guestName?: string;
      serviceNames?: string[];
      status?: string;
      start: number;
      end: number;
    }>;
  }>;
  bookings: Array<{
    id: string;
    reference: string;
    guestName: string;
    guestPhone: string;
    guestNote: string;
    customerKey: string;
    serviceIds: string[];
    serviceNames: string[];
    staffId: string;
    staffName: string;
    startsAt: number;
    status: string;
    totalCents: number;
  }>;
  week: Array<{ iso: string; revenueCents: number }>;
}

export const OPERATOR_TABS = [
  { href: '/dashboard', key: 'tab_today', ico: '📅' },
  { href: '/dashboard/revenue', key: 'tab_revenue', ico: '📈' },
  { href: '/dashboard/customers', key: 'tab_customers', ico: '👤' },
  { href: '/dashboard/services', key: 'tab_services', ico: '✂️' },
  { href: '/dashboard/team', key: 'tab_team', ico: '👥' },
  { href: '/dashboard/hr', key: 'tab_hr', ico: '🧾' },
  { href: '/dashboard/shop', key: 'tab_shop', ico: '⚙️' },
] as const satisfies ReadonlyArray<{ href: string; key: MsgKey; ico: string }>;

/** Load one shop-day. Every tab needs it; only Today varies the date. */
export function useOverview(shopId: string, date: string = todayIso()) {
  const [data, setData] = useState<Overview | null>(null);

  const reload = useCallback(async () => {
    if (!shopId) {
      setData(null);
      return;
    }
    const overview = await apiOverview(shopId, date);
    if (overview) setData(overview as Overview);
  }, [shopId, date]);

  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  return { data, reload };
}

export interface OperatorCtx {
  shopId: string;
  ownerKey: string | null;
  myShops: ShopRef[];
  /** re-read the owned set after a claim / disconnect */
  refresh: () => void;
}

/**
 * Renders the gate (loading / no shop connected), the header with the shop
 * picker, and the tab bar — then hands the tab its context.
 */
export function OperatorShell({
  shops,
  active,
  children,
}: {
  shops: ShopRef[];
  /** href of the tab being rendered, so it can mark itself current */
  active: string;
  children: (ctx: OperatorCtx) => ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { ownerKey, ownedIds, myShops, shopId, setShopId, refresh } = useOwnedShops(shops);

  if (ownedIds === null) return <div className="spinner" />;

  if (myShops.length === 0) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="page-title">
          <h1>💼 {t('dash_title')}</h1>
        </div>
        <div className="empty">
          <div className="big">🏪</div>
          <h3 style={{ marginBottom: 6 }}>{t('own_none_title')}</h3>
          <p>{t('own_none_body')}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
            <Link className="btn btn-primary" href="/partner">
              {t('partner_nav')} →
            </Link>
            <label className="btn btn-soft" style={{ cursor: 'pointer' }}>
              🔗 {t('own_connect')}
              <select
                style={{ marginLeft: 8, background: 'transparent', border: 'none', outline: 'none', fontWeight: 700 }}
                value=""
                onChange={(e) => {
                  if (!e.target.value || !ownerKey) return;
                  void apiClaimShop(e.target.value, ownerKey).then(refresh);
                }}
              >
                <option value="">…</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.emoji} {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    );
  }

  const current = myShops.find((s) => s.id === shopId);

  return (
    <div>
      <div className="page-title">
        <h1>
          {current ? `${current.emoji} ${current.name}` : `💼 ${t('dash_title')}`}
        </h1>
        {myShops.length > 1 && (
          <label className="chip">
            {t('dash_pick')}
            <select value={shopId} onChange={(e) => setShopId(e.target.value)}>
              {myShops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji} {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <nav className="op-tabs" aria-label={t('dash_title')}>
        {OPERATOR_TABS.map((tab) => {
          // `active` decides, not the URL: /dashboard prefixes every tab.
          const on = tab.href === active || (active === '' && pathname === tab.href);
          return (
            <Link key={tab.href} href={tab.href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
              <span className="ico">{tab.ico}</span>
              {t(tab.key)}
            </Link>
          );
        })}
      </nav>

      {children({ shopId, ownerKey, myShops, refresh })}
    </div>
  );
}
