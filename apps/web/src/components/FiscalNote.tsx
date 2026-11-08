'use client';
/**
 * StyleNow is not a fiscal cash register. Where a salon's country requires
 * one, every place that looks like a register — the cash book, the daily
 * summary, a receipt — says so, worded for that country:
 *   DE → KassenSichV / TSE      AT → RKSV / signature unit
 *   other EU → neutral hint (each country has its own register rules)
 *   outside the EU → nothing (no such general requirement)
 * The salon's country decides, not the customer's. Online payments via
 * Stripe are not affected anywhere.
 */
import { useEffect, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { apiShopCountry } from '@/lib/api';

const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

type Variant = 'drawer' | 'summary' | 'receipt';

export function fiscalRegime(country: string): 'de' | 'at' | 'eu' | null {
  const c = country.toUpperCase();
  if (c === 'DE') return 'de';
  if (c === 'AT') return 'at';
  return EU.has(c) ? 'eu' : null;
}

export function FiscalNote({ variant, shopId }: { variant: Variant; shopId: string }) {
  const { t } = useI18n();
  const [country, setCountry] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void apiShopCountry(shopId).then((c) => live && setCountry(c));
    return () => {
      live = false;
    };
  }, [shopId]);
  const regime = country ? fiscalRegime(country) : null;
  if (!regime) return null;
  const key = (regime === 'de' ? `fn_${variant}` : `fn_${regime}_${variant}`) as MsgKey;
  return (
    <div
      role="note"
      className="fiscal-note"
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        fontSize: '0.78rem',
        lineHeight: 1.45,
        padding: '8px 12px',
        margin: '8px 0 12px',
        borderRadius: 10,
        background: 'var(--amber-soft, rgba(245, 166, 35, 0.12))',
        color: 'var(--ink)',
        border: '1px solid rgba(245, 166, 35, 0.45)',
      }}
    >
      <span aria-hidden>⚠️</span>
      <span>{t(key)}</span>
    </div>
  );
}
