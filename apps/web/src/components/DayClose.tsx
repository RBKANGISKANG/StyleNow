'use client';
/**
 * Tagesabschluss — the daily closing sheet.
 *
 * At the end of the day a German salon reconciles the till: what came in,
 * through which methods, the VAT inside it, tips owed to staff, fees kept
 * from late cancellations, refunds that went back out. This renders exactly
 * that, derived live from the day's bookings, in the same printable sheet
 * dress as the Beleg — the print button produces the paper the folder or the
 * tax adviser wants, and the numbers can never disagree with the calendar
 * because they are computed from it on open.
 */
import { useEffect, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, dateOf, timeOf } from '@/lib/format';
import { apiDayClose, type DayCloseReport } from '@/lib/api';

const METHOD_ICON: Record<string, string> = {
  card: '💳', paypal: '🅿️', apple_pay: '', google_pay: '🇬', sepa: '🏦', at_salon: '🏪',
};

export function DayClose({ shopId, iso, onClose }: { shopId: string; iso: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [report, setReport] = useState<DayCloseReport | null>(null);

  useEffect(() => {
    let alive = true;
    void apiDayClose(shopId, iso).then((r) => {
      if (alive) setReport(r);
    });
    return () => {
      alive = false;
    };
  }, [shopId, iso]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // reuse the Beleg's print isolation — only the sheet prints
    document.body.classList.add('rc-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      document.body.classList.remove('rc-open');
    };
  }, [onClose]);

  return (
    <div className="rc-backdrop" onClick={onClose}>
      <div className="rc-sheet" role="dialog" aria-modal="true" aria-label={t('zb_title')} onClick={(e) => e.stopPropagation()}>
        {report === null ? (
          <div className="spinner" />
        ) : (
          <>
            <header className="rc-head">
              <div>
                <h2>{t('zb_title')}</h2>
                <span className="rc-ref">{dateOf(Date.parse(`${report.iso}T12:00:00Z`), lang)} · {report.iso}</span>
              </div>
              <div className="rc-issuer">
                <strong>{report.shopName}</strong>
                <span>{report.shopAddress}</span>
                <span>{t('zb_generated')}: {timeOf(report.generatedAt, lang)}</span>
              </div>
            </header>

            <div className="rc-meta">
              <div>
                <span className="k">{t('zb_completed')}</span>
                <span>{report.completedCount}</span>
              </div>
              <div>
                <span className="k">{t('zb_noshows')}</span>
                <span>{report.noShowCount}</span>
              </div>
              <div>
                <span className="k">{t('zb_cancelled')}</span>
                <span>{report.cancelledCount}</span>
              </div>
            </div>

            <table className="rc-lines">
              <tbody>
                <tr>
                  <td>{t('zb_gross')}</td>
                  <td className="num">{money(report.grossCents, lang)}</td>
                </tr>
                <tr className="rc-sub">
                  <td>{t('rc_vat')}</td>
                  <td className="num">{money(report.vatCents, lang)}</td>
                </tr>
                <tr className="rc-sub">
                  <td>{t('zb_tips')}</td>
                  <td className="num">{money(report.tipsCents, lang)}</td>
                </tr>
                {report.feesCents > 0 && (
                  <tr className="rc-sub">
                    <td>{t('zb_fees')}</td>
                    <td className="num">{money(report.feesCents, lang)}</td>
                  </tr>
                )}
                {report.refundedCents > 0 && (
                  <tr className="rc-sub rc-refund">
                    <td>{t('zb_refunded')}</td>
                    <td className="num">−{money(report.refundedCents, lang)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="rc-total">
                  <td>{t('zb_net_take')}</td>
                  <td className="num">
                    {money(report.grossCents + report.tipsCents + report.feesCents - report.refundedCents, lang)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {report.byMethod.length > 0 && (
              <>
                <p className="rc-note" style={{ marginBottom: 4 }}>{t('zb_by_method')}</p>
                <table className="rc-lines">
                  <tbody>
                    {report.byMethod.map((m) => (
                      <tr key={m.method} className="rc-sub">
                        <td>
                          {METHOD_ICON[m.method]} {t(`pm_${m.method}` as MsgKey)} · {m.count}×
                        </td>
                        <td className="num">{money(m.cents, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <p className="rc-note">{t('zb_note')}</p>

            <footer className="rc-actions">
              <button className="btn btn-primary" onClick={() => window.print()}>
                🖨 {t('rc_print')}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>
                {t('rc_close')}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
