'use client';
/**
 * StyleNow is not a German fiscal cash register (no TSE, KassenSichV). Every
 * place that looks like a register — the cash book, the daily summary, a
 * receipt — says so plainly, so a salon never relies on it at the tax office.
 * Online payments through Stripe are not affected.
 */
import { useI18n } from '@/lib/i18n';

export function FiscalNote({ variant }: { variant: 'drawer' | 'summary' | 'receipt' }) {
  const { t } = useI18n();
  const text = variant === 'drawer' ? t('fn_drawer') : variant === 'summary' ? t('fn_summary') : t('fn_receipt');
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
      <span>{text}</span>
    </div>
  );
}
