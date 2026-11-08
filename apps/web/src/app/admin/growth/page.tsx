'use client';
/**
 * Platform owner: the three numbers that decide whether StyleNow works, and a
 * 3-year value model. The model is a planning tool, not a valuation — every
 * input is editable and the presets say what they assume.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money } from '@/lib/format';
import { PLATFORM_COMMISSION_PCT, valuationModel, type GrowthMetrics, type ValuationInput } from '@/core/store';
import { adminKey, adminNeedsKey, apiAdminGrowth } from '@/lib/api';

type Preset = 'low' | 'mid' | 'high';
const PRESETS: Record<Preset, { businesses: [number, number, number]; bookings: number; extras: number; costs: [number, number, number]; multiple: number }> = {
  // referrals only, Hamburg first, slow spread
  low: { businesses: [300, 1000, 2500], bookings: 12, extras: 8, costs: [15_000, 120_000, 400_000], multiple: 3 },
  // Hamburg year 1, more German cities year 2, Germany + Austria year 3
  mid: { businesses: [400, 2500, 7000], bookings: 20, extras: 10, costs: [20_000, 350_000, 1_500_000], multiple: 5 },
  // funded: sales teams per city, EU start in year 3
  high: { businesses: [800, 5000, 15000], bookings: 25, extras: 12, costs: [350_000, 2_500_000, 7_000_000], multiple: 8 },
};

function Stat({ label, value, target, ok, hint }: { label: string; value: string; target: string; ok: boolean | null | undefined; hint: string }) {
  return (
    <div className="panel" style={{ flex: '1 1 220px' }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{label}</div>
      <div style={{ fontSize: '2rem', fontWeight: 800, margin: '4px 0' }}>
        {value} {ok === undefined ? '' : ok === null ? '🟠' : ok ? '🟢' : '🔴'}
      </div>
      <div style={{ fontSize: '0.78rem' }}>{target}</div>
      <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', margin: '6px 0 0', lineHeight: 1.5 }}>{hint}</p>
    </div>
  );
}

function Num({ label, value, onChange, step = 1, suffix = '' }: { label: string; value: number; onChange: (n: number) => void; step?: number; suffix?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: '1 1 140px' }}>
      {label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input className="input" type="number" min={0} step={step} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
        {suffix}
      </span>
    </label>
  );
}

export default function GrowthPage() {
  const { t, lang } = useI18n();
  const [g, setG] = useState<GrowthMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>('mid');
  const [inp, setInp] = useState<ValuationInput>(() => {
    const p = PRESETS.mid;
    return { businesses: p.businesses, bookingsPerBusiness: p.bookings, avgPriceCents: 4500, commissionPct: PLATFORM_COMMISSION_PCT, extrasPct: p.extras, costsPerYearCents: p.costs.map((c) => c * 100) as [number, number, number], multiple: p.multiple };
  });

  useEffect(() => {
    if (adminNeedsKey() && !adminKey()) {
      setError('unauthorized');
      return;
    }
    apiAdminGrowth()
      .then((m) => {
        setG(m);
        if (m.avgPriceCents > 0) setInp((x) => ({ ...x, avgPriceCents: m.avgPriceCents }));
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const v = PRESETS[p];
    setInp((x) => ({ ...x, businesses: v.businesses, bookingsPerBusiness: v.bookings, extrasPct: v.extras, costsPerYearCents: v.costs.map((c) => c * 100) as [number, number, number], multiple: v.multiple }));
  };
  const model = useMemo(() => valuationModel(inp), [inp]);
  const eur = (c: number) => money(c, lang);
  const big = (c: number) => (Math.abs(c) >= 1e8 ? `${(c / 1e8).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 1 })} M €` : eur(c));
  const setBiz = (i: number, n: number) => setInp((x) => ({ ...x, businesses: x.businesses.map((v, j) => (j === i ? n : v)) as [number, number, number] }));
  const setCost = (i: number, n: number) => setInp((x) => ({ ...x, costsPerYearCents: x.costsPerYearCents.map((v, j) => (j === i ? n * 100 : v)) as [number, number, number] }));

  if (error) {
    return (
      <main className="container" style={{ padding: '24px 16px' }}>
        <h1>📈 {t('og_title')}</h1>
        <div className="alert">{error === 'unauthorized' ? t('og_need_key') : error}</div>
        <Link className="btn btn-soft" href="/admin">← {t('adm_title')}</Link>
      </main>
    );
  }

  return (
    <main className="container" style={{ padding: '24px 16px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>📈 {t('og_title')}</h1>
        <Link className="btn btn-soft sm" href="/admin">← {t('adm_title')}</Link>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>{t('og_sub')}</p>

      {!g ? (
        <p className="muted">…</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <Stat
              label={t('og_m1')}
              value={String(g.marketplacePerBusiness)}
              target={t('og_m1_target')}
              ok={g.marketplacePerBusiness >= 15 ? true : g.marketplacePerBusiness >= 10 ? null : false}
              hint={t('og_m1_hint', { a: g.distribution.under10, b: g.distribution.from10to20, c: g.distribution.over20 })}
            />
            <Stat
              label={t('og_m2')}
              value={g.retention.eligible ? `${g.retention.pct} %` : '—'}
              target={t('og_m2_target')}
              ok={g.retention.eligible ? (g.retention.pct >= 80 ? true : g.retention.pct >= 60 ? null : false) : undefined}
              hint={t('og_m2_hint', { a: g.retention.active, n: g.retention.eligible })}
            />
            <Stat
              label={t('og_m3')}
              value={g.viral.perUser.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')}
              target={t('og_m3_target')}
              ok={g.viral.perUser >= 1 ? true : g.viral.perUser >= 0.5 ? null : false}
              hint={t('og_m3_hint', { c: g.viral.newCustomersInvited, cn: g.viral.newCustomers, b: g.viral.newBusinessesInvited, bn: g.viral.newBusinesses })}
            />
          </div>

          <div className="panel" style={{ marginTop: 14, overflowX: 'auto' }}>
            <h3>{t('og_months')}</h3>
            <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'right' }}>
                  <th style={{ textAlign: 'left' }}>{t('og_col_month')}</th>
                  <th>{t('og_col_market')}</th>
                  <th>{t('og_col_own')}</th>
                  <th>{t('og_col_newbiz')}</th>
                  <th>{t('og_col_newcust')}</th>
                </tr>
              </thead>
              <tbody>
                {g.months.map((m) => (
                  <tr key={m.month} style={{ textAlign: 'right', borderTop: '1px solid var(--line)' }}>
                    <td style={{ textAlign: 'left', padding: '6px 0' }}>{m.month}</td>
                    <td>{m.marketplace}</td>
                    <td>{m.ownLink}</td>
                    <td>{m.newBusinesses}</td>
                    <td>{m.newCustomers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: 8 }}>{t('og_live', { n: g.liveBusinesses, price: eur(g.avgPriceCents) })}</p>
          </div>
        </>
      )}

      <section className="panel valuation" style={{ marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>💶 {t('og_val_title')}</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>{t('og_val_sub')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
          {(['low', 'mid', 'high'] as Preset[]).map((p) => (
            <button key={p} className={`btn sm ${preset === p ? 'btn-primary' : 'btn-soft'}`} onClick={() => applyPreset(p)}>
              {t(`og_p_${p}` as MsgKey)}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{t(`og_p_${preset}_d` as MsgKey)}</p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          {[0, 1, 2].map((i) => (
            <Num key={i} label={t('og_in_biz', { y: i + 1 })} value={inp.businesses[i]} onChange={(n) => setBiz(i, n)} step={50} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <Num label={t('og_in_bookings')} value={inp.bookingsPerBusiness} onChange={(n) => setInp((x) => ({ ...x, bookingsPerBusiness: n }))} />
          <Num label={t('og_in_price')} value={Math.round(inp.avgPriceCents / 100)} onChange={(n) => setInp((x) => ({ ...x, avgPriceCents: n * 100 }))} suffix="€" />
          <Num label={t('og_in_comm')} value={inp.commissionPct} onChange={(n) => setInp((x) => ({ ...x, commissionPct: n }))} suffix="%" />
          <Num label={t('og_in_extras')} value={inp.extrasPct} onChange={(n) => setInp((x) => ({ ...x, extrasPct: n }))} suffix="%" />
          <Num label={t('og_in_card')} value={inp.cardSharePct ?? 70} onChange={(n) => setInp((x) => ({ ...x, cardSharePct: Math.min(100, n) }))} suffix="%" />
          <Num label={t('og_in_multiple')} value={inp.multiple} onChange={(n) => setInp((x) => ({ ...x, multiple: n }))} step={0.5} suffix="×" />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          {[0, 1, 2].map((i) => (
            <Num key={i} label={t('og_in_costs', { y: i + 1 })} value={Math.round(inp.costsPerYearCents[i] / 100)} onChange={(n) => setCost(i, n)} step={10000} suffix="€" />
          ))}
        </div>

        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table style={{ width: '100%', fontSize: '0.88rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'right' }}>
                <th style={{ textAlign: 'left' }}>{t('og_col_year')}</th>
                <th>{t('og_col_biz')}</th>
                <th>{t('og_col_paying')}</th>
                <th>{t('og_col_gmv')}</th>
                <th>{t('og_col_rev')}</th>
                <th>{t('og_col_gross')}</th>
                <th>{t('og_col_costs')}</th>
                <th>{t('og_col_profit')}</th>
              </tr>
            </thead>
            <tbody>
              {model.years.map((y) => (
                <tr key={y.year} style={{ textAlign: 'right', borderTop: '1px solid var(--line)' }}>
                  <td style={{ textAlign: 'left', padding: '6px 0' }}>{t('og_year_n', { y: y.year })}</td>
                  <td>{y.businessesEnd.toLocaleString()}</td>
                  <td>{y.paying.toLocaleString()}</td>
                  <td style={{ color: 'var(--ink-soft)' }}>{big(y.gmvCents)}</td>
                  <td>{big(y.revenueCents)}</td>
                  <td>{big(y.grossProfitCents)}</td>
                  <td>{big(y.costsCents)}</td>
                  <td style={{ color: y.profitCents < 0 ? 'var(--rose, #c2416b)' : 'inherit', fontWeight: 600 }}>{big(y.profitCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel" style={{ marginTop: 16, background: 'var(--teal-soft)', borderColor: 'var(--teal)' }}>
          <div style={{ fontSize: '0.85rem' }}>{t('og_runrate', { v: big(model.runRateCents) })}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, margin: '6px 0' }} className="gw-value">
            {t('og_value', { v: big(model.valueCents) })}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{t('og_per_biz', { v: eur(model.perBusinessYearCents) })}</div>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: 10, lineHeight: 1.55 }}>{t('og_fine')}</p>
      </section>
    </main>
  );
}
