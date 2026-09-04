'use client';
/**
 * The real calendar.
 *
 * The 62-day pill strip is fast for "sometime this week", but it hides the
 * shape of the month: which days are closed, which are already packed, where
 * the quiet days with the best choice sit. This is the month at one glance —
 * every cell carries the day's booking heat (pale = quiet, deep = busy,
 * struck = closed or nobody rostered), the horizon is honest (nothing before
 * today, nothing past the booking horizon), and tapping a day hands it to the
 * same slot loader the strip uses. Monday starts the week, because Berlin.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { apiDayLoadRange } from '@/lib/api';
import { todayIso, addDays, dayStart, isoDow } from '@/core/time';

function monthOf(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function firstOf(month: string): string {
  return `${month}-01`;
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function MonthPicker({
  shopId,
  selected,
  horizonDays,
  onPick,
}: {
  shopId: string;
  selected: string;
  /** how many days from today are bookable at all */
  horizonDays: number;
  onPick: (iso: string) => void;
}) {
  const { lang } = useI18n();
  const today = todayIso();
  const lastBookable = addDays(today, horizonDays - 1);
  const [month, setMonth] = useState(monthOf(selected));
  const [load, setLoad] = useState<Map<string, number>>(new Map());

  // the selected day may change from outside (deep links) — follow it
  useEffect(() => {
    setMonth(monthOf(selected));
  }, [selected]);

  useEffect(() => {
    let alive = true;
    void apiDayLoadRange(shopId, firstOf(month), daysInMonth(month)).then((rows) => {
      if (alive) setLoad(new Map(rows.map((r) => [r.iso, r.pct])));
    });
    return () => {
      alive = false;
    };
  }, [shopId, month]);

  const cells = useMemo(() => {
    const first = firstOf(month);
    const lead = isoDow(dayStart(first)) - 1; // Monday-first offset
    const count = daysInMonth(month);
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: count }, (_, i) => addDays(first, i)),
    ];
  }, [month]);

  const monthLabel = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  }).format(dayStart(firstOf(month)) + 12 * 36e5);

  const dowNames = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(
      Date.UTC(2024, 0, i + 1), // 2024-01-01 was a Monday
    ),
  );

  const canPrev = month > monthOf(today);
  const canNext = month < monthOf(lastBookable);

  return (
    <div className="mp">
      <div className="mp-head">
        <button className="btn btn-ghost sm" disabled={!canPrev} onClick={() => setMonth(addMonths(month, -1))} aria-label="‹">
          ‹
        </button>
        <strong>{monthLabel}</strong>
        <button className="btn btn-ghost sm" disabled={!canNext} onClick={() => setMonth(addMonths(month, 1))} aria-label="›">
          ›
        </button>
      </div>
      <div className="mp-grid" role="grid">
        {dowNames.map((d) => (
          <span key={d} className="mp-dow">
            {d}
          </span>
        ))}
        {cells.map((iso, i) =>
          iso === null ? (
            <span key={`x${i}`} />
          ) : (
            (() => {
              const pct = load.get(iso);
              const out = iso < today || iso > lastBookable;
              const closed = pct === -1;
              const heat = pct === undefined || pct < 0 ? '' : pct >= 66 ? ' hot' : pct >= 33 ? ' mid' : ' cool';
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={out || closed}
                  className={`mp-day${heat}${iso === selected ? ' sel' : ''}${iso === today ? ' today' : ''}`}
                  onClick={() => onPick(iso)}
                  aria-label={iso}
                >
                  {closed && !out ? '—' : Number(iso.slice(8, 10))}
                </button>
              );
            })()
          ),
        )}
      </div>
    </div>
  );
}
