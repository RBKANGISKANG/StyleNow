'use client';
/**
 * "Make it a rhythm" — offered in the one moment it makes sense: right after
 * a booking is confirmed, while the time still feels chosen rather than
 * remembered. The regular is the salon's whole economics and the customer's
 * whole habit; this books the next occurrences of exactly this slot — same
 * stylist, same time — in one gesture.
 *
 * Full dates are reported, never silently shifted: "your Tuesday 14:00 is
 * taken on 6 Oct" is information, and quietly booking 15:30 instead is how a
 * standing appointment loses its meaning. Future visits are paid at the salon
 * — the platform holds seats, not months of money, and the result line says
 * both facts out loud.
 */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { dateOf } from '@/lib/format';
import { apiBookSeries } from '@/lib/api';

const CADENCES = [1, 2, 3, 4, 6] as const;
const COUNTS = [3, 6] as const;

export function BookSeries({ bookingId }: { bookingId: string }) {
  const { t, lang } = useI18n();
  const [everyWeeks, setEveryWeeks] = useState<number>(4);
  const [count, setCount] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ booked: number; skippedDates: number[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    const r = await apiBookSeries(bookingId, everyWeeks, count);
    setBusy(false);
    if (r.ok) setResult({ booked: r.booked, skippedDates: r.skippedDates });
    else setFailed(true);
  };

  if (result) {
    return (
      <div className="series-box done">
        <strong>
          🔁 {result.booked === 1 ? t('sr_booked_one') : t('sr_booked_n', { n: String(result.booked) })}
        </strong>
        <p>{t('sr_booked_sub')}</p>
        {result.skippedDates.length > 0 && (
          <p className="series-skipped">
            ⚠️ {t('sr_skipped', { dates: result.skippedDates.map((d) => dateOf(d, lang)).join(', ') })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="series-box">
      <strong>🔁 {t('sr_title')}</strong>
      <p>{t('sr_sub')}</p>
      <div className="series-controls">
        <label className="chip">
          {t('sr_every')}
          <select value={everyWeeks} onChange={(e) => setEveryWeeks(Number(e.target.value))}>
            {CADENCES.map((w) => (
              <option key={w} value={w}>
                {w === 1 ? t('sr_week_one') : t('sr_weeks', { n: String(w) })}
              </option>
            ))}
          </select>
        </label>
        <label className="chip">
          {t('sr_next')}
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {COUNTS.map((c) => (
              <option key={c} value={c}>
                {t('sr_times', { n: String(c) })}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-soft sm" disabled={busy} onClick={() => void run()}>
          {busy ? '…' : t('sr_go')}
        </button>
      </div>
      {failed && <p className="series-skipped">⚠️ {t('sr_failed')}</p>}
      <p className="series-note">{t('sr_pay_note')}</p>
    </div>
  );
}
