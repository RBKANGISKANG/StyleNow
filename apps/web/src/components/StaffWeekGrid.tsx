'use client';
/**
 * One stylist's week on the same axis as the day calendar.
 *
 * The day view answers "who is next"; this answers the week-shaped questions —
 * "how full am I" for the stylist, "which day is nobody buying" for the owner.
 * Both live on the identical 08:00–21:00 ruler as the day calendar, because two
 * calendars with two scales stop being one instrument.
 *
 * The headline is sold-against-rostered, not bookings-per-day: four short cuts
 * and one balayage are the same count and a very different week. And the
 * emptiest day is called out in words, because a row of thin blocks whispers
 * what "Thursday is 6 hours nobody bought" says out loud.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { weekdayShort, dayNum, timeOf } from '@/lib/format';
import { apiStaffWeek, type StaffWeekDayView } from '@/lib/api';
import { todayIso, addDays } from '@/core/time';

/** Same visible day as the operator calendar: 08:00 to 21:00. */
const AXIS_START = 8 * 60;
const AXIS_END = 21 * 60;
const SPAN = AXIS_END - AXIS_START;

const pct = (min: number): string =>
  `${Math.min(Math.max(((min - AXIS_START) / SPAN) * 100, 0), 100)}%`;

export function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay() || 7;
  return addDays(iso, 1 - dow);
}

export function StaffWeekGrid({
  shopId,
  staffId,
  onOpenBooking,
}: {
  shopId: string;
  staffId: string;
  /** Present on the operator side; a stylist's own view just looks. */
  onOpenBooking?: (bookingId: string) => void;
}) {
  const { t, lang } = useI18n();
  const [monday, setMonday] = useState(() => mondayOf(todayIso()));
  const [days, setDays] = useState<StaffWeekDayView[] | null>(null);

  useEffect(() => {
    let alive = true;
    setDays(null);
    void apiStaffWeek(shopId, staffId, monday).then((d) => {
      if (alive) setDays(d);
    });
    return () => {
      alive = false;
    };
  }, [shopId, staffId, monday]);

  const totals = useMemo(() => {
    if (!days) return null;
    const sold = days.reduce((n, d) => n + d.soldMin, 0);
    const rostered = days.reduce((n, d) => n + d.rosteredMin, 0);
    // The emptiest rostered day, but only when the hole is worth a sentence —
    // 90 unsold minutes is a lunch break, not a problem.
    let dead: { iso: string; freeMin: number } | null = null;
    for (const d of days) {
      const free = d.rosteredMin - d.soldMin;
      if (d.rosteredMin > 0 && free >= 180 && (!dead || free > dead.freeMin)) {
        dead = { iso: d.iso, freeMin: free };
      }
    }
    return { sold, rostered, pct: rostered === 0 ? 0 : Math.round((sold / rostered) * 100), dead };
  }, [days]);

  const hours = (min: number): string => {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m === 0 ? `${h} h` : `${h} h ${m}`;
  };

  return (
    <div className="sweek">
      <div className="sweek-bar">
        <button className="btn btn-soft sm" onClick={() => setMonday(addDays(monday, -7))}>
          ←
        </button>
        <strong className="sweek-range">
          {dayNum(monday)}.–{dayNum(addDays(monday, 6))}. {new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${addDays(monday, 6)}T12:00:00Z`))}
        </strong>
        <button className="btn btn-soft sm" onClick={() => setMonday(addDays(monday, 7))}>
          →
        </button>
        {monday !== mondayOf(todayIso()) && (
          <button className="btn btn-ghost sm" onClick={() => setMonday(mondayOf(todayIso()))}>
            {t('sw_this_week')}
          </button>
        )}
        {totals && totals.rostered > 0 && (
          <span className="sweek-head">
            {t('sw_sold', { sold: hours(totals.sold), rostered: hours(totals.rostered), pct: String(totals.pct) })}
          </span>
        )}
      </div>

      {totals?.dead && (
        <p className="sweek-dead">
          {t('sw_dead', { day: weekdayShort(totals.dead.iso, lang), h: hours(totals.dead.freeMin) })}
        </p>
      )}

      {days === null ? (
        <div className="spinner" />
      ) : (
        <div className="sweek-grid">
          <div className="sweek-ruler">
            <span />
            <div className="marks">
              {['08', '10', '12', '14', '16', '18', '20'].map((hh) => (
                <span key={hh}>{hh}</span>
              ))}
            </div>
            <span />
          </div>
          {days.map((d) => {
            const isToday = d.iso === todayIso();
            return (
              <div className={`sweek-row${isToday ? ' today' : ''}`} key={d.iso}>
                <div className="sweek-day">
                  <span className="dw">{weekdayShort(d.iso, lang)}</span>
                  <span className="dn">{dayNum(d.iso)}</span>
                </div>
                <div className="sweek-lane">
                  {d.working.length === 0 && <div className="sweek-off" />}
                  {d.working.map((w, i) => {
                    const left = pct(minOf(w.start));
                    const right = pct(minOf(w.end));
                    return <div className="sweek-shift" key={i} style={{ left, width: `calc(${right} - ${left})` }} />;
                  })}
                  {d.blocks.map((b, i) => {
                    const left = pct(minOf(b.start));
                    const right = pct(minOf(b.end));
                    const cls =
                      b.kind === 'walk_in'
                        ? 'walk'
                        : b.status === 'pending_payment'
                          ? 'pending'
                          : b.prime
                            ? 'prime'
                            : 'booking';
                    return (
                      <div
                        key={i}
                        className={`sweek-block ${cls}`}
                        style={{ left, width: `calc(${right} - ${left})`, cursor: onOpenBooking && b.bookingId ? 'pointer' : undefined }}
                        title={
                          b.kind === 'walk_in'
                            ? t('walk_in')
                            : `${timeOf(b.start, lang)} · ${b.guestName ?? ''} · ${(b.serviceNames ?? []).join(', ')}`
                        }
                        onClick={() => {
                          if (onOpenBooking && b.bookingId) onOpenBooking(b.bookingId);
                        }}
                      />
                    );
                  })}
                </div>
                <div className="sweek-sum">
                  {d.rosteredMin === 0 ? (
                    <span className="off">{t('sw_off')}</span>
                  ) : (
                    <>
                      {hours(d.soldMin)} <em>/ {hours(d.rosteredMin)}</em>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function minOf(epoch: number): number {
  const d = new Date(epoch);
  // Europe/Berlin wall-clock minutes, same convention as the day calendar.
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false });
  const [h, m] = fmt.format(d).split(':').map(Number);
  return h * 60 + m;
}
