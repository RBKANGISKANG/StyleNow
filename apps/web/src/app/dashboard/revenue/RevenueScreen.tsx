'use client';
/**
 * Revenue tab — money over a range, and where it came from.
 *
 * It moved off Today for the same reason HR did: a trend is read weekly or
 * monthly, not while you are running the floor, and it wants more room than a
 * seven-day strip at the bottom of the calendar.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money } from '@/lib/format';
import { apiRevenueReport, apiShopGiftCards, type RevenueReport } from '@/lib/api';
import { RevenueChart } from '@/components/RevenueChart';
import { DayClose } from '@/components/DayClose';
import { OperatorShell } from '../shell';
import type { ShopRef } from '@/lib/owned-shops';
import { todayIso, addDays } from '@/core/time';

type Period = 'd7' | 'd30' | 'month' | 'ahead';

const METHOD_ICON: Record<string, string> = {
  card: '💳', paypal: '🅿️', apple_pay: '', google_pay: '🇬', sepa: '🏦', at_salon: '🏪',
};

export function RevenueScreen({ shops }: { shops: ShopRef[] }) {
  return (
    <OperatorShell shops={shops} active="/dashboard/revenue">
      {({ shopId }) => <RevenueTab shopId={shopId} />}
    </OperatorShell>
  );
}

function RevenueTab({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState<Period>('d7');
  const [closeIso, setCloseIso] = useState(todayIso());
  const [closeOpen, setCloseOpen] = useState(false);
  const [gift, setGift] = useState<Awaited<ReturnType<typeof apiShopGiftCards>>>(null);

  useEffect(() => {
    if (shopId) void apiShopGiftCards(shopId).then(setGift);
  }, [shopId]);
  const [report, setReport] = useState<RevenueReport | null>(null);

  const range = useMemo(() => {
    const today = todayIso();
    // 'ahead' is the order book, not takings: what is already on the calendar
    // for the coming month. Everything else looks backwards at realised money.
    if (period === 'ahead') return { from: addDays(today, 1), to: addDays(today, 30) };
    if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
    return { from: addDays(today, period === 'd7' ? -6 : -29), to: today };
  }, [period]);

  const ahead = period === 'ahead';

  useEffect(() => {
    if (!shopId) return;
    setReport(null);
    void apiRevenueReport(shopId, range.from, range.to).then(setReport);
  }, [shopId, range.from, range.to]);

  const periodLabel = (p: Period) =>
    p === 'd7' ? t('rev_7d') : p === 'd30' ? t('rev_30d') : p === 'month' ? t('rev_month') : t('rev_ahead');

  return (
    <>
      <div className="today-bar">
        <div className="seg">
          {(['d7', 'd30', 'month', 'ahead'] as const).map((p) => (
            <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>
              {periodLabel(p)}
            </button>
          ))}
        </div>
        <span style={{ fontSize: '0.76rem', color: 'var(--ink-soft)' }}>
          {range.from} → {range.to}
        </span>
      </div>

      {report === null ? (
        <div className="spinner" />
      ) : (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <div className="lbl">{ahead ? t('rev_ahead_total') : t('rev_total')}</div>
              <div className="val">{money(report.totalCents, lang)}</div>
            </div>
            <div className="stat-tile">
              <div className="lbl">{t('rev_online')}</div>
              <div className="val">{report.bookingCount}</div>
            </div>
            <div className="stat-tile">
              <div className="lbl">{t('avg_ticket')}</div>
              <div className="val">{report.avgTicketCents ? money(report.avgTicketCents, lang) : '—'}</div>
            </div>
            <div className="stat-tile">
              <div className="lbl">{ahead ? t('rev_best_day') : t('rev_walkin')}</div>
              <div className="val">
                {ahead
                  ? report.bestDay && report.bestDay.revenueCents > 0
                    ? money(report.bestDay.revenueCents, lang)
                    : '—'
                  : money(report.walkInCents, lang)}
              </div>
            </div>
          </div>

          <section className="section">
            <h2>{ahead ? t('rev_ahead_trend') : t('rev_trend')}</h2>
            <RevenueChart data={report.days} label={ahead ? t('rev_ahead_trend') : t('rev_trend')} />
          </section>

          <section className="section">
            <h2>{t('rev_by_service')}</h2>
            <div className="panel">
              {report.byService.length === 0 ? (
                <p style={{ color: 'var(--ink-soft)', fontSize: '0.88rem' }}>{t('rev_none')}</p>
              ) : (
                <Ranked
                  rows={report.byService.map((s) => ({
                    key: s.id,
                    label: `${s.emoji} ${s.name[lang]}`,
                    count: s.count,
                    cents: s.revenueCents,
                  }))}
                  countLabel={t('rev_bookings')}
                />
              )}
            </div>
          </section>

          <section className="section">
            <h2>{t('rev_by_staff')}</h2>
            <div className="panel">
              {report.byStaff.length === 0 ? (
                <p style={{ color: 'var(--ink-soft)', fontSize: '0.88rem' }}>{t('rev_none')}</p>
              ) : (
                <Ranked
                  rows={report.byStaff.map((s) => ({
                    key: s.id,
                    label: s.name,
                    count: s.count,
                    cents: s.revenueCents,
                  }))}
                  countLabel={t('rev_bookings')}
                />
              )}
            </div>
          </section>

          {report.byMethod.length > 0 && (
            <section className="section">
              <h2>{t('rev_by_method')}</h2>
              <div className="panel">
                <Ranked
                  rows={report.byMethod.map((m) => ({
                    key: m.method,
                    label: `${METHOD_ICON[m.method] ?? '💳'} ${t(`pm_${m.method}` as MsgKey)}`,
                    count: m.count,
                    cents: m.revenueCents,
                  }))}
                  countLabel={t('rev_bookings')}
                />
              </div>
            </section>
          )}

          {gift && gift.soldCount > 0 && (
            <section className="section">
              <h2>🎁 {t('gc_shop_title')}</h2>
              <div className="panel" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <div className="hr-kpi">
                  <span className="k">{t('gc_shop_sold')}</span>
                  <span className="v">{gift.soldCount} · {money(gift.soldCents, lang)}</span>
                </div>
                <div className="hr-kpi">
                  <span className="k">{t('gc_shop_outstanding')}</span>
                  <span className="v">{money(gift.outstandingCents, lang)}</span>
                </div>
                <span style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', flexBasis: '100%' }}>
                  {t('gc_shop_hint')}
                </span>
              </div>
            </section>
          )}

          <section className="section">
            <h2>🧾 {t('zb_title')}</h2>
            <div className="panel" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', flex: 1, minWidth: 220 }}>
                {t('zb_hint')}
              </span>
              <input
                type="date"
                className="input"
                style={{ width: 'auto' }}
                value={closeIso}
                max={todayIso()}
                onChange={(e) => setCloseIso(e.target.value)}
              />
              <button className="btn btn-primary sm" onClick={() => setCloseOpen(true)} disabled={!closeIso}>
                {t('zb_open')}
              </button>
            </div>
          </section>
          {closeOpen && <DayClose shopId={shopId} iso={closeIso} onClose={() => setCloseOpen(false)} />}

          <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)' }}>
            💡 {ahead ? t('rev_ahead_hint') : t('rev_hint')}
          </p>
        </>
      )}
    </>
  );
}

/**
 * A ranked breakdown. Bars here are correct where the trend line was not: this
 * is a comparison between categories, not a movement over time. Length carries
 * the value; the number is always spelled out next to it.
 */
function Ranked({
  rows,
  countLabel,
}: {
  rows: Array<{ key: string; label: string; count: number; cents: number }>;
  countLabel: string;
}) {
  const { lang } = useI18n();
  const max = Math.max(...rows.map((r) => r.cents), 1);
  return (
    <div className="rank-list">
      {rows.map((r) => (
        <div key={r.key} className="rank-row">
          <span className="rank-label">{r.label}</span>
          <span className="rank-track">
            <span className="rank-bar" style={{ width: `${Math.max((r.cents / max) * 100, 2)}%` }} />
          </span>
          <span className="rank-count" title={countLabel}>
            {r.count} ×
          </span>
          <span className="rank-value">{money(r.cents, lang)}</span>
        </div>
      ))}
    </div>
  );
}
