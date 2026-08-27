'use client';
/**
 * The shop's diary at week and month scale.
 *
 * The day view answers "what is happening now". A week or a month answers
 * "where are the holes" — the question you ask before running an offer,
 * rostering someone off, or taking a holiday yourself. Same bookings, a
 * different unit of time, so the two are views of one thing rather than two
 * separate screens.
 *
 * Both are clickable: pick a day and you land in the day view on that date,
 * because the reason you spotted a hole is that you want to do something
 * about it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, timeOf } from '@/lib/format';
import { apiShopCalendar, type CalendarDay } from '@/lib/api';
import { todayIso } from '@/core/time';

export function ShopCalendar({
  shopId,
  from,
  to,
  span,
  onPickDay,
}: {
  shopId: string;
  from: string;
  to: string;
  span: 'week' | 'month';
  onPickDay: (iso: string) => void;
}) {
  const { t, lang } = useI18n();
  const [days, setDays] = useState<CalendarDay[] | null>(null);

  const load = useCallback(() => {
    if (!shopId) return;
    void apiShopCalendar(shopId, from, to).then(setDays);
  }, [shopId, from, to]);

  useEffect(() => {
    setDays(null);
    load();
  }, [load]);

  const dowLong = useMemo(
    () => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }),
    [lang],
  );
  const today = todayIso();

  if (days === null) return <div className="spinner" />;

  const totals = days.reduce(
    (acc, d) => ({ bookings: acc.bookings + d.bookingCount, revenue: acc.revenue + d.revenueCents }),
    { bookings: 0, revenue: 0 },
  );
  const busiest = days.reduce<CalendarDay | null>(
    (best, d) => (best === null || d.bookingCount > best.bookingCount ? d : best),
    null,
  );
  const quietest = days
    .filter((d) => d.staffOn > 0)
    .reduce<CalendarDay | null>((worst, d) => (worst === null || d.bookingCount < worst.bookingCount ? d : worst), null);

  return (
    <>
      <div className="stat-row">
        <div className="stat-tile">
          <div className="lbl">{t('cal_bookings')}</div>
          <div className="val">{totals.bookings}</div>
        </div>
        <div className="stat-tile">
          <div className="lbl">{t('cal_revenue')}</div>
          <div className="val">{money(totals.revenue, lang)}</div>
        </div>
        <div className="stat-tile">
          <div className="lbl">{t('cal_busiest')}</div>
          <div className="val">
            {busiest && busiest.bookingCount > 0 ? `${Number(busiest.iso.slice(8, 10))}. · ${busiest.bookingCount}` : '—'}
          </div>
        </div>
        <div className="stat-tile">
          <div className="lbl">{t('cal_quietest')}</div>
          <div className="val">
            {quietest ? `${Number(quietest.iso.slice(8, 10))}. · ${quietest.bookingCount}` : '—'}
          </div>
        </div>
      </div>

      {span === 'week' ? (
        <div className="wk-grid">
          {days.map((d) => (
            <button
              key={d.iso}
              className={`wk-col ${d.iso === today ? 'today' : ''} ${d.closed ? 'closed' : ''} ${d.staffOn === 0 ? 'off' : ''}`}
              onClick={() => onPickDay(d.iso)}
            >
              <div className="wk-head">
                <span className="dow">{dowLong.format(new Date(`${d.iso}T12:00:00Z`))}</span>
                <span className="num">{Number(d.iso.slice(8, 10))}</span>
                <span className="sum">
                  {d.closed
                    ? t('cls_closed')
                    : d.staffOn === 0
                      ? t('rc_off')
                      : `${d.bookingCount} · ${money(d.revenueCents, lang)}`}
                </span>
                {!d.closed && d.staffOn > 0 && (
                  <span className="wk-load">
                    <i style={{ width: `${Math.min(d.occupancyPct, 100)}%` }} />
                  </span>
                )}
              </div>
              <div className="wk-body">
                {d.appointments.length === 0 ? (
                  <span className="wk-empty">{d.closed || d.staffOn === 0 ? '' : t('cal_free')}</span>
                ) : (
                  d.appointments.map((a) => (
                    <span
                      key={a.id}
                      className={`wk-appt st-${a.status}`}
                      title={`${timeOf(a.startsAt, lang)} · ${a.guestName} · ${a.serviceNames.join(', ')} · ${a.staffName}`}
                    >
                      <b>{timeOf(a.startsAt, lang)}</b> {a.guestName}
                      <em>{a.staffName}</em>
                    </span>
                  ))
                )}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <MonthGrid days={days} today={today} onPickDay={onPickDay} />
      )}

      <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', marginTop: 12 }}>💡 {t('cal_hint')}</p>
    </>
  );
}

/**
 * A month always starts on a Monday column, so weeks line up vertically and
 * "every Tuesday is dead" is visible as a column rather than something you
 * have to count out.
 */
function MonthGrid({
  days,
  today,
  onPickDay,
}: {
  days: CalendarDay[];
  today: string;
  onPickDay: (iso: string) => void;
}) {
  const { t, lang } = useI18n();
  const dowNarrow = useMemo(
    () => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }),
    [lang],
  );

  if (days.length === 0) return null;
  const firstDow = new Date(`${days[0].iso}T12:00:00Z`).getUTCDay() || 7; // 1..7, Monday first
  const lead = firstDow - 1;
  const headers = Array.from({ length: 7 }, (_, i) => {
    // 2024-01-01 was a Monday — a stable anchor for weekday names.
    const d = new Date(Date.UTC(2024, 0, 1 + i, 12));
    return dowNarrow.format(d);
  });

  return (
    <div className="mo-grid">
      {headers.map((h, i) => (
        <div className="mo-dow" key={i}>
          {h}
        </div>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <div className="mo-pad" key={`pad-${i}`} />
      ))}
      {days.map((d) => (
        <button
          key={d.iso}
          className={`mo-cell ${d.iso === today ? 'today' : ''} ${d.closed ? 'closed' : ''} ${d.staffOn === 0 ? 'off' : ''}`}
          onClick={() => onPickDay(d.iso)}
          title={`${d.iso} · ${d.bookingCount} · ${money(d.revenueCents, lang)}`}
        >
          <span className="num">{Number(d.iso.slice(8, 10))}</span>
          {d.closed ? (
            <span className="tag">{t('cls_closed')}</span>
          ) : d.staffOn === 0 ? (
            <span className="tag dim">—</span>
          ) : (
            <>
              <span className="cnt">{d.bookingCount > 0 ? d.bookingCount : ''}</span>
              <span className="mo-load">
                <i style={{ width: `${Math.min(d.occupancyPct, 100)}%` }} />
              </span>
              <span className="rev">{d.revenueCents > 0 ? money(d.revenueCents, lang) : ''}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

/** Labels shared with the Today tab's span selector. */
export const CALENDAR_SPANS = ['day', 'week', 'month'] as const satisfies ReadonlyArray<string>;
export const spanKey = (s: 'day' | 'week' | 'month'): MsgKey =>
  s === 'day' ? 'cal_day' : s === 'week' ? 'cal_week' : 'cal_month';
