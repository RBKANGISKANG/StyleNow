'use client';
/**
 * The company portal: a statement of every team gift-card order this
 * account placed — what was paid, which codes were used and what is left.
 * Balances are read live from the cards, never copied.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money } from '@/lib/format';
import { apiCompanyStatement } from '@/lib/api';
import type { CompanyStatement } from '@/core/store';

export default function CompanyPage() {
  const { t, lang } = useI18n();
  const [st, setSt] = useState<CompanyStatement | null>(null);
  useEffect(() => {
    void apiCompanyStatement().then(setSt);
  }, []);
  const day = (ms: number) => new Date(ms).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB');

  const csv = () => {
    if (!st) return;
    const rows = [['order', 'date', 'salon', 'company', 'code', 'value_eur', 'left_eur', 'last_used']];
    for (const b of st.batches)
      for (const c of b.cards)
        rows.push([b.id, new Date(b.createdAt).toISOString().slice(0, 10), b.shopName, b.company, c.code, (c.initialCents / 100).toFixed(2), (c.balanceCents / 100).toFixed(2), c.lastUsedAt ? new Date(c.lastUsedAt).toISOString().slice(0, 10) : '']);
    const body = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stylenow-company-statement.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <div className="page-title">
        <h1>🏢 {t('co_title')}</h1>
        <p className="muted">{t('co_sub')}</p>
      </div>
      {!st ? (
        <p className="muted">…</p>
      ) : st.batches.length === 0 ? (
        <div className="empty">
          <div className="big">🎁</div>
          <p>{t('co_empty')}</p>
          <Link href="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            {t('fav_browse')}
          </Link>
        </div>
      ) : (
        <>
          <div className="hero-stats" style={{ marginBottom: 20 }}>
            <div><b>{st.totals.orders}</b><span>{t('co_orders')}</span></div>
            <div><b>{money(st.totals.paidCents, lang)}</b><span>{t('co_paid')}</span></div>
            <div><b>{money(st.totals.usedCents, lang)}</b><span>{t('co_used')}</span></div>
            <div><b>{money(st.totals.openCents, lang)}</b><span>{t('co_open')} · {st.totals.unusedCards} {t('co_unused')}</span></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }} className="no-print">
            <button className="btn btn-soft sm" onClick={csv}>⬇ {t('co_csv')}</button>
            <button className="btn btn-soft sm" onClick={() => window.print()}>🖨 {t('co_print')}</button>
          </div>
          {st.batches.map((b) => (
            <section key={b.id} className="section">
              <h2 style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <span>{b.company} · {b.shopName}</span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {day(b.createdAt)} · {b.count} × {money(b.amountCents, lang)} · {money(b.paidCents, lang)}
                  {b.discountPct > 0 && ` · ${t('co_discount', { pct: b.discountPct })}`}
                </span>
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      <th>{t('co_code')}</th><th>{t('co_value')}</th><th>{t('co_left')}</th><th>{t('co_last')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.cards.map((c) => (
                      <tr key={c.code} style={{ borderTop: '1px solid var(--line, rgba(127,127,127,.2))' }}>
                        <td style={{ fontFamily: 'ui-monospace, monospace', padding: '6px 0' }}>{c.code}</td>
                        <td>{money(c.initialCents, lang)}</td>
                        <td><b>{money(c.balanceCents, lang)}</b></td>
                        <td className="muted">{c.lastUsedAt ? day(c.lastUsedAt) : t('co_never')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
