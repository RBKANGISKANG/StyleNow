'use client';
/**
 * The customer moves their own appointment.
 *
 * "Can you do Saturday instead?" was the most common message in any salon
 * thread, and until now the app's only answers were cancel-and-rebook (lose
 * the slot, maybe pay a fee) or wait for a reply. This picks a new time
 * directly: same shop, same services, same seat guarantees as booking, and
 * the price stays what was agreed.
 *
 * It is only offered while cancellation is still free — past that point,
 * moving would be fee-dodging with extra steps, so the button gives way to
 * the message thread where a human can decide.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { timeOf, weekdayShort, dayNum, monthShort } from '@/lib/format';
import { apiAvailability, apiMoveMyBooking, type ApiSlot } from '@/lib/api';
import { todayIso } from '@/core/time';

function nextDays(n: number): string[] {
  const out: string[] = [];
  const start = new Date(`${todayIso()}T12:00:00`);
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + i * 864e5);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function MoveBooking({
  shopId,
  bookingId,
  serviceIds,
  staffId,
  currentStartsAt,
  onDone,
  onClose,
}: {
  shopId: string;
  bookingId: string;
  serviceIds: string[];
  /** Moving keeps your stylist, so only their free times are offered — a slot
   *  another stylist could take would be accepted by nobody. */
  staffId: string;
  currentStartsAt: number;
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const days = useMemo(() => nextDays(14), []);
  const [date, setDate] = useState(days[0]);
  const [slots, setSlots] = useState<ApiSlot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSlots(null);
    void apiAvailability(shopId, serviceIds, date, staffId).then((rows) => {
      if (alive) setSlots(rows);
    });
    return () => {
      alive = false;
    };
    // serviceIds is a fresh array each render; the booking's identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, date, bookingId]);

  const pick = async (startsAt: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await apiMoveMyBooking(shopId, bookingId, startsAt);
    setBusy(false);
    if (res.ok) {
      onDone(t('mv_done', { time: timeOf(startsAt, lang) }));
      return;
    }
    if (res.code === 'slot_taken') {
      // Someone got there first — show what is really left now.
      setError(t('mv_taken'));
      setSlots(await apiAvailability(shopId, serviceIds, date, staffId));
    } else if (res.code === 'too_late') {
      setError(t('mv_too_late'));
    } else {
      setError(t('mv_failed'));
    }
  };

  return (
    <div className="mv-panel">
      <div className="mv-head">
        <strong>{t('mv_title')}</strong>
        <span>{t('mv_sub')}</span>
      </div>

      <div className="mv-days">
        {days.map((d, i) => (
          <span key={d} style={{ display: 'contents' }}>
            {(i === 0 || d.slice(5, 7) !== days[i - 1].slice(5, 7)) && (
              <span className="month-label">{monthShort(d, lang)}</span>
            )}
            <button className={`date-pill ${d === date ? 'sel' : ''}`} onClick={() => setDate(d)}>
              <div className="dow">{weekdayShort(d, lang)}</div>
              <div className="num">{dayNum(d)}</div>
            </button>
          </span>
        ))}
      </div>

      {error && <div className="alert">⚠️ {error}</div>}

      {slots === null ? (
        <div className="spinner" />
      ) : slots.length === 0 ? (
        <p className="mv-none">{t('mv_none')}</p>
      ) : (
        <div className="slot-grid">
          {slots.map((s) => (
            <button
              key={s.start}
              className={`slot-chip${s.start === currentStartsAt ? ' sel' : ''}`}
              disabled={busy || s.start === currentStartsAt}
              onClick={() => void pick(s.start)}
            >
              {timeOf(s.start, lang)}
            </button>
          ))}
        </div>
      )}

      <div className="mv-foot">
        <button className="btn btn-soft sm" onClick={onClose}>
          {t('mv_keep')}
        </button>
        <span className="mv-price-note">{t('mv_price_note')}</span>
      </div>
    </div>
  );
}
