'use client';
/**
 * Opening hours, and whether the shop is open right this minute.
 *
 * A salon page without opening hours is missing the second thing anyone looks
 * for. Nobody types these in: they are the union of the team's rostered shifts,
 * so hiring a Saturday stylist puts Saturday on the page, and a holiday entered
 * in the back office takes today off it — with the reason, because "closed"
 * with no explanation reads like "closed down".
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Glyph } from '@/components/Icon';
import { weekdayName, hhmm } from '@/lib/format';
import { apiShopHours, type ShopHours as Hours } from '@/lib/api';
import { todayIso, isoDow, dayStart } from '@/core/time';

/** One fetch per page — the badge in the hero and the table below share it. */
export function useShopHours(shopId: string): Hours | null {
  const [hours, setHours] = useState<Hours | null>(null);
  useEffect(() => {
    let alive = true;
    void apiShopHours(shopId).then((h) => {
      if (alive) setHours(h);
    });
    return () => {
      alive = false;
    };
  }, [shopId]);
  return hours;
}

export function HoursTable({ hours }: { hours: Hours | null }) {
  const { t, lang } = useI18n();
  if (!hours) return null;
  const todayDow = isoDow(dayStart(todayIso()));

  return (
    <section className="section">
      <h2>
        <Glyph name="clock" emoji="🕐" size={20} /> {t('oh_title')}
      </h2>
      <div className="panel">
        <ul className="oh-list">
          {hours.days.map((d) => (
            <li key={d.dow} className={d.dow === todayDow ? 'is-today' : undefined}>
              <span className="oh-day">
                {weekdayName(d.dow, lang)}
                {d.dow === todayDow && <span className="oh-now">{t('oh_today')}</span>}
              </span>
              <span className={`oh-win${d.windows.length === 0 ? ' shut' : ''}`}>
                {d.windows.length === 0
                  ? t('oh_closed')
                  : d.windows.map((w) => `${hhmm(w.startMin)}–${hhmm(w.endMin)}`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
        {hours.closures.length > 0 && (
          <ul className="oh-closures">
            {hours.closures.map((c) => (
              <li key={c.id}>
                <Glyph name="calendar" emoji="🎄" size={14} /> {t('cl_upcoming', { range: c.from === c.to ? c.from : `${c.from} – ${c.to}`, reason: c.reason })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The one-line "open now / opens Thursday at 09:00" badge for the hero. */
export function OpenBadge({ hours }: { hours: Hours | null }) {
  const { t, lang } = useI18n();
  if (!hours) return null;
  const s = hours.status;

  if (s.open) {
    return (
      <span className="open-badge on">
        {s.closesAtMin === null ? t('st_open') : t('st_open_until', { time: hhmm(s.closesAtMin) })}
      </span>
    );
  }

  // Shut. Say when it opens again — that is the only part worth reading.
  let detail: string;
  if (s.closedReason) detail = t('st_closed_for', { reason: s.closedReason });
  else if (s.nextOpenIso === null || s.nextOpenMin === null) detail = t('st_closed_until_further');
  else if (s.nextOpenIso === todayIso()) detail = t('st_opens_today', { time: hhmm(s.nextOpenMin) });
  else
    detail = t('st_opens_on', {
      day: weekdayName(isoDow(dayStart(s.nextOpenIso)), lang, 'short'),
      time: hhmm(s.nextOpenMin),
    });

  return <span className="open-badge off">{detail}</span>;
}
