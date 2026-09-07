'use client';
/**
 * Revenue tab — money over a range, and where it came from.
 *
 * It moved off Today for the same reason HR did: a trend is read weekly or
 * monthly, not while you are running the floor, and it wants more room than a
 * seven-day strip at the bottom of the calendar.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money } from '@/lib/format';
import { apiRevenueReport, apiShopGiftCards, apiBookingLedger, apiQuietWindows, apiShopGoal, apiSetShopGoal, apiSellGiftCard, apiDrawerReport, apiAddCashEntry, apiDeleteCashEntry, apiStaffEarnings, apiUtilizationReport, type RevenueReport } from '@/lib/api';
import type { DrawerReport as DrawerReportT, StaffEarningsRow as StaffEarningsRowT, UtilizationReport as UtilizationReportT, CashEntry } from '@/core/store';

type CashKind = CashEntry['kind'];
import { toCsv, eurDe } from '@/lib/csv';
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
  const [quiet, setQuiet] = useState<Awaited<ReturnType<typeof apiQuietWindows>>>([]);
  const [goal, setGoal] = useState(0);
  const [goalDraft, setGoalDraft] = useState('');
  const [soldCode, setSoldCode] = useState('');
  const [sellAmount, setSellAmount] = useState('50');
  const [sellName, setSellName] = useState('');

  useEffect(() => {
    if (!shopId) return;
    void apiShopGiftCards(shopId).then(setGift);
    void apiQuietWindows(shopId).then(setQuiet);
    void apiShopGoal(shopId).then((g) => {
      setGoal(g);
      setGoalDraft(g ? String(g / 100) : '');
    });
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

  // The accountant's file: one row per money-relevant booking in the shown
  // range, in the dialect German Excel actually opens (BOM, ';', "12,34").
  const exportCsv = async () => {
    const rows = await apiBookingLedger(shopId, range.from, range.to);
    const head = lang === 'de'
      ? ['Datum', 'Uhrzeit', 'Beleg-Nr.', 'Status', 'Gast', 'Leistungen', 'Mitarbeiter:in', 'Netto EUR', 'USt EUR', 'Brutto EUR', 'Trinkgeld EUR', 'Gebühr EUR', 'Erstattet EUR', 'Zahlungsart']
      : ['Date', 'Time', 'Reference', 'Status', 'Guest', 'Services', 'Staff', 'Net EUR', 'VAT EUR', 'Gross EUR', 'Tip EUR', 'Fee EUR', 'Refunded EUR', 'Payment'];
    const csv = toCsv([
      head,
      ...rows.map((r) => [
        r.iso, r.time, r.reference, r.status, r.guestName, r.services, r.staffName,
        eurDe(r.netCents), eurDe(r.vatCents), eurDe(r.grossCents), eurDe(r.tipCents),
        eurDe(r.feeCents), eurDe(r.refundedCents), r.paymentLabel,
      ]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `stylenow-ledger-${range.from}-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!shopId) return;
    setReport(null);
    void apiRevenueReport(shopId, range.from, range.to).then(setReport);
  }, [shopId, range.from, range.to]);

  // The goal is monthly regardless of the picked range — one cheap extra read.
  const [monthCents, setMonthCents] = useState<number | null>(null);
  useEffect(() => {
    if (!shopId) return;
    const today = todayIso();
    void apiRevenueReport(shopId, `${today.slice(0, 8)}01`, today).then((r) => setMonthCents(r?.totalCents ?? null));
  }, [shopId]);

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
            <h2>🎯 {t('goal_title')}</h2>
            <div className="panel">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="input"
                  style={{ width: 120 }}
                  inputMode="numeric"
                  placeholder={t('goal_ph')}
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value.replace(/[^\d]/g, ''))}
                />
                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>€ / {t('rev_month')}</span>
                <button
                  className="btn btn-soft sm"
                  onClick={() => {
                    const cents = Math.round(Number(goalDraft || '0') * 100);
                    void apiSetShopGoal(shopId, cents).then(() => setGoal(cents));
                  }}
                >
                  {t('goal_set')}
                </button>
              </div>
              {goal > 0 && monthCents !== null && (
                <>
                  <div className="hr-bar" style={{ marginTop: 10 }}>
                    <div style={{ width: `${Math.min(Math.round((monthCents / goal) * 100), 100)}%` }} />
                  </div>
                  <p style={{ fontSize: '0.8rem', fontWeight: 700, marginTop: 6 }}>
                    {t('goal_progress', { pct: String(Math.round((monthCents / goal) * 100)), goal: money(goal, lang) })}
                  </p>
                </>
              )}
              <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 6 }}>{t('goal_hint')}</p>
            </div>
          </section>

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

          {quiet.length > 0 && (
            <section className="section">
              <h2>🌙 {t('qw_title')}</h2>
              <div className="panel">
                <p style={{ fontSize: '0.82rem', lineHeight: 1.6 }}>
                  {t('qw_body', {
                    a: `${t(`dow_${quiet[0].dow}` as MsgKey)} ${t(`part_${quiet[0].part}` as MsgKey).toLowerCase()}`,
                    b: quiet.length > 1 ? `${t(`dow_${quiet[1].dow}` as MsgKey)} ${t(`part_${quiet[1].part}` as MsgKey).toLowerCase()}` : '—',
                  })}
                </p>
                <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', marginTop: 6 }}>💡 {t('qw_hint')}</p>
              </div>
            </section>
          )}

          <section className="section">
            <h2>🎁 {t('gcs_title')}</h2>
            <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="input" style={{ width: 90 }} inputMode="numeric" value={sellAmount}
                onChange={(e) => setSellAmount(e.target.value.replace(/[^\d]/g, ''))} />
              <span style={{ fontWeight: 700 }}>€</span>
              <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder={t('gcs_name_ph')} value={sellName}
                maxLength={60} onChange={(e) => setSellName(e.target.value)} />
              <button
                className="btn btn-primary sm"
                disabled={!sellAmount || Number(sellAmount) < 10 || Number(sellAmount) > 500}
                onClick={() =>
                  void apiSellGiftCard(shopId, Number(sellAmount) * 100, sellName || undefined).then((card) => {
                    if (card) {
                      setSoldCode(card.code);
                      setSellName('');
                      void apiShopGiftCards(shopId).then(setGift);
                    }
                  })
                }
              >
                {t('gcs_sell')}
              </button>
              {soldCode && (
                <p style={{ flexBasis: '100%', fontSize: '0.85rem', fontWeight: 700 }}>
                  ✅ {t('gcs_sold')}: <span className="gc-row-code">{soldCode}</span>
                </p>
              )}
            </div>
          </section>

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
              <button className="btn btn-soft sm" onClick={() => void exportCsv()}>
                📑 {t('csv_export')}
              </button>
            </div>
          </section>
          {closeOpen && <DayClose shopId={shopId} iso={closeIso} onClose={() => setCloseOpen(false)} />}

          <CashPanel shopId={shopId} />
          <CommissionPanel shopId={shopId} />
          <UtilizationPanel shopId={shopId} />

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

/**
 * "1.000", "1.234,56", "12,50" and "12.50" must all mean what a German till
 * operator means by them. Both separators present → '.' is thousands; a lone
 * ',' is the decimal; a lone '.' is a decimal only with 1–2 digits after it.
 */
function parseEuroCents(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Kassenbuch: the physical drawer, day by day. Float in, expenses and tip
 * payouts out, and — once counted — the Differenz against what the day's
 * bookings say should be in there.
 */
function CashPanel({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [iso, setIso] = useState(todayIso());
  const [report, setReport] = useState<DrawerReportT | null>(null);
  const [kind, setKind] = useState<CashKind>('float');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    if (!shopId) return;
    void apiDrawerReport(shopId, iso).then(setReport);
  }, [shopId, iso]);
  useEffect(load, [load]);

  const KINDS: CashKind[] = ['float', 'expense', 'tip_payout', 'correction', 'count'];
  return (
    <section className="section">
      <h2>💶 {t('cb_title')}</h2>
      <div className="panel">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <input type="date" className="input" style={{ width: 'auto' }} value={iso} max={todayIso()} onChange={(e) => setIso(e.target.value)} />
          <label className="chip">
            <select value={kind} onChange={(e) => setKind(e.target.value as CashKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>{t(`cb_${k}` as MsgKey)}</option>
              ))}
            </select>
          </label>
          <input className="input" style={{ width: 90 }} inputMode="decimal" placeholder="€" value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,-]/g, ''))} />
          <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder={t('cb_note_ph')} value={note}
            maxLength={80} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-primary sm"
            disabled={!amount}
            onClick={() => {
              const cents = parseEuroCents(amount);
              if (cents === null) return;
              void apiAddCashEntry(shopId, iso, { kind, amountCents: cents, note: note || undefined }).then(() => {
                setAmount('');
                setNote('');
                load();
              });
            }}
          >
            ＋
          </button>
        </div>
        {report && (
          <>
            {report.entries.map((e) => (
              <div className="wi-row" key={e.id}>
                <span className="wi-name">{t(`cb_${e.kind}` as MsgKey)}</span>
                <span className="wi-meta">{e.note ?? ''}</span>
                <span style={{ fontWeight: 700 }}>
                  {e.kind === 'expense' || e.kind === 'tip_payout' ? '−' : ''}{money(e.amountCents, lang)}
                </span>
                <button className="btn btn-ghost sm" onClick={() => void apiDeleteCashEntry(shopId, iso, e.id).then(load)}>✕</button>
              </div>
            ))}
            <div className="wi-row" style={{ fontWeight: 800 }}>
              <span className="wi-name">{t('cb_expected')}</span>
              <span className="wi-meta" />
              <span>{money(report.expectedCents, lang)}</span>
            </div>
            {report.differenceCents !== null && (
              <div className="wi-row" style={{ fontWeight: 800, color: report.differenceCents === 0 ? 'var(--teal)' : 'var(--danger)' }}>
                <span className="wi-name">{t('cb_diff')}</span>
                <span className="wi-meta" />
                <span>{report.differenceCents > 0 ? '+' : ''}{money(report.differenceCents, lang)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Provisionsabrechnung: each stylist's completed revenue × their percent. */
function CommissionPanel({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [from, setFrom] = useState(addDays(todayIso(), -27));
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<StaffEarningsRowT[]>([]);

  useEffect(() => {
    if (!shopId || from > to) return;
    void apiStaffEarnings(shopId, from, to).then(setRows);
  }, [shopId, from, to]);

  const exportCsv = () => {
    const data = [
      [t('team_name'), t('cm_bookings'), t('cm_revenue'), t('cm_tips'), '%', t('cm_commission')],
      ...rows.map((r) => [r.name, String(r.bookingCount), eurDe(r.serviceCents), eurDe(r.tipCents), String(r.commissionPercent), eurDe(r.commissionCents)]),
    ];
    const url = URL.createObjectURL(new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `provisionen-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="section">
      <h2>🤝 {t('cm_title')}</h2>
      <div className="panel">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <input type="date" className="input" style={{ width: 'auto' }} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <span>→</span>
          <input type="date" className="input" style={{ width: 'auto' }} value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} />
          <button className="btn btn-soft sm" onClick={exportCsv} disabled={rows.length === 0}>📑 {t('csv_export')}</button>
          <span style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', flexBasis: '100%' }}>{t('cm_hint')}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="dash-table">
            <thead>
              <tr>
                <th>{t('team_name')}</th><th>{t('cm_bookings')}</th><th>{t('cm_revenue')}</th><th>{t('cm_tips')}</th><th>%</th><th>{t('cm_commission')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.staffId}>
                  <td>{r.name}</td>
                  <td>{r.bookingCount}</td>
                  <td>{money(r.serviceCents, lang)}</td>
                  <td>{money(r.tipCents, lang)}</td>
                  <td>{r.commissionPercent > 0 ? `${r.commissionPercent} %` : '—'}</td>
                  <td style={{ fontWeight: 700 }}>{r.commissionPercent > 0 ? money(r.commissionCents, lang) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/**
 * Where the chairs stand empty and what fills them: a weekday × day-part heat
 * grid of booked share, and each service's revenue per chair-hour.
 */
function UtilizationPanel({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<UtilizationReportT | null>(null);

  useEffect(() => {
    if (!shopId) return;
    void apiUtilizationReport(shopId, addDays(todayIso(), -27), todayIso()).then(setData);
  }, [shopId]);

  if (!data || data.services.length === 0) return null;
  const parts = ['morning', 'afternoon', 'evening'] as const;
  const cellFor = (dow: number, part: string) => data.grid.find((g) => g.dow === dow && g.part === part);
  const worst = [...data.grid].filter((g) => g.bookedPct !== null).sort((a, b) => (a.bookedPct ?? 0) - (b.bookedPct ?? 0))[0];
  const top = data.services[0];
  return (
    <section className="section">
      <h2>📊 {t('ut_title')}</h2>
      <div className="panel">
        <div style={{ overflowX: 'auto' }}>
          <table className="dash-table ut-grid">
            <thead>
              <tr>
                <th />
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (<th key={d}>{t(`dow_${d}` as MsgKey).slice(0, 2)}</th>))}
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part}>
                  <td style={{ fontWeight: 700 }}>{t(`qw_${part}` as MsgKey)}</td>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                    const cell = cellFor(d, part);
                    const p = cell?.bookedPct ?? null;
                    return (
                      <td key={d} className={`ut-cell ${p === null ? 'off' : p >= 70 ? 'hot' : p >= 35 ? 'mid' : 'cool'}`}>
                        {p === null ? '—' : `${p}%`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <table className="dash-table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>{t('services')}</th><th>#</th><th>{t('cm_revenue')}</th><th>{t('ut_per_hour')}</th></tr>
          </thead>
          <tbody>
            {data.services.slice(0, 6).map((s) => (
              <tr key={s.serviceId}>
                <td>{s.emoji} {s.name[lang]}</td>
                <td>{s.count}</td>
                <td>{money(s.revenueCents, lang)}</td>
                <td style={{ fontWeight: 700 }}>{money(s.perChairHourCents, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Two honest sentences instead of a dashboard nobody reads. */}
        {top && top.count >= 8 && (
          <p style={{ fontSize: '0.8rem', marginTop: 10 }}>💡 {t('ut_hint_top', { name: top.name[lang] })}</p>
        )}
        {worst && worst.bookedPct !== null && worst.bookedPct < 40 && (
          <p style={{ fontSize: '0.8rem', marginTop: 4 }}>
            💡 {t('ut_hint_quiet', { day: t(`dow_${worst.dow}` as MsgKey), part: t(`qw_${worst.part}` as MsgKey), pct: worst.bookedPct })}
          </p>
        )}
      </div>
    </section>
  );
}
