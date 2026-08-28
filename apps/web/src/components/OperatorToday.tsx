'use client';
/**
 * The two pieces the studio back office leads with: what day this is, and who
 * is about to walk in.
 *
 * The classic Today opens on a row of segmented controls — a set of choices
 * before a single fact. The design board opens on the date, the shape of the
 * day in one line, and the next appointment at display size, because those are
 * what somebody standing behind the desk actually needs in the first second.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { money, timeOf, hhmm } from '@/lib/format';
import { apiShopHours, apiShopCustomers } from '@/lib/api';
import type { Overview } from '@/app/dashboard/shell';
import type { CustomerRow } from '@/core/store';
import { todayIso } from '@/core/time';

/** "9 appointments · 3 stylists on · open until 20:00" */
export function DayHeadline({
  shopId,
  date,
  data,
  onNew,
}: {
  shopId: string;
  date: string;
  data: Overview | null;
  onNew: () => void;
}) {
  const { t, lang } = useI18n();
  const [closesAt, setClosesAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void apiShopHours(shopId).then((h) => {
      if (!alive || !h) return;
      // Only today's status is honest here; on any other date the roster is the
      // better answer and the line below already carries it.
      setClosesAt(date === todayIso() && h.status.open && h.status.closesAtMin !== null ? hhmm(h.status.closesAtMin) : null);
    });
    return () => {
      alive = false;
    };
  }, [shopId, date]);

  const staffOn = data ? data.staffRows.filter((r) => r.working.length > 0).length : 0;
  const parts = data
    ? [
        data.bookingCount === 0
          ? t('dh_appt_none')
          : data.bookingCount === 1
            ? t('dh_appt_one')
            : t('dh_appts', { n: String(data.bookingCount) }),
        staffOn === 1 ? t('dh_staff_one') : t('dh_staff', { n: String(staffOn) }),
        ...(closesAt ? [t('dh_until', { time: closesAt })] : []),
      ]
    : [];

  const full = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: 'Europe/Berlin',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <div className="day-head">
      <div className="day-head-txt">
        <h1>{full}</h1>
        <p>{parts.join(' · ')}</p>
      </div>
      <button className="btn btn-primary" onClick={onNew}>
        <Icon name="plus" size={17} strokeWidth={2.4} />
        {t('dash_new_plain')}
      </button>
    </div>
  );
}

interface Next {
  start: number;
  guestName: string;
  service: string;
  staffName: string;
}

/**
 * The next appointment still to come today, with whatever the shop already
 * knows about the person. Renders nothing on a past or future date, and
 * nothing once the day is done — an empty "next up" card is furniture.
 */
export function NextUpCard({
  shopId,
  date,
  data,
  onOpen,
}: {
  shopId: string;
  date: string;
  data: Overview | null;
  onOpen: () => void;
}) {
  const { t, lang } = useI18n();
  const [people, setPeople] = useState<CustomerRow[]>([]);

  useEffect(() => {
    let alive = true;
    void apiShopCustomers(shopId).then((rows) => {
      if (alive) setPeople(rows);
    });
    return () => {
      alive = false;
    };
  }, [shopId]);

  if (!data || date !== todayIso()) return null;

  const now = Date.now();
  let next: Next | null = null;
  for (const staff of data.staffRows) {
    for (const b of staff.blocks) {
      if (b.start <= now) continue;
      if (next && b.start >= next.start) continue;
      next = {
        start: b.start,
        guestName: b.guestName ?? t('walk_in'),
        service: (b.serviceNames ?? []).join(', '),
        staffName: staff.name,
      };
    }
  }
  if (!next) return null;

  const mins = Math.round((next.start - now) / 60000);
  const who = people.find((p) => p.name === next.guestName) ?? null;

  return (
    <section className="nextup-op" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="nu-when">
        <span className="k">{t('nu_op_next')}</span>
        <span className="nu-time">{timeOf(next.start, lang)}</span>
        <span className="nu-in">{mins < 60 ? t('nu_in_min', { n: String(mins) }) : t('nu_in_h', { n: String(Math.round(mins / 60)) })}</span>
      </div>
      <div className="nu-who">
        <strong>{next.guestName}</strong>
        <span className="nu-svc">
          {next.service}
          {next.service && ' · '}
          {t('nu_with', { name: next.staffName })}
        </span>
        {who && (
          <div className="nu-tags">
            {who.visits > 0 && <span className="nu-tag">{t('nu_visit_n', { n: String(who.visits + 1) })}</span>}
            {who.spentCents > 0 && <span className="nu-tag">{money(who.spentCents, lang)} {t('cus_spent').toLowerCase()}</span>}
            {who.shopNote && <span className="nu-tag warn">{who.shopNote}</span>}
          </div>
        )}
      </div>
      <span className="nu-go">
        {t('nu_op_open')}
        <Icon name="chevron" size={16} strokeWidth={2.4} />
      </span>
    </section>
  );
}

/**
 * People who came back.
 *
 * Occupancy and takings say how the day went; neither says whether the salon is
 * building anything. A second visit inside six weeks is the earliest honest
 * sign that somebody is becoming a regular, which is the number a shop grows on.
 */
export function NewRegulars({ shopId }: { shopId: string }) {
  const { t } = useI18n();
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void apiShopCustomers(shopId).then((rows) => {
      if (!alive) return;
      // Second visit, and it happened this week — "new regulars" is a claim
      // about the last seven days, not about everyone who ever came twice.
      const week = 7 * 864e5;
      setN(rows.filter((r) => r.visits === 2 && r.lastVisit !== null && Date.now() - r.lastVisit < week).length);
    });
    return () => {
      alive = false;
    };
  }, [shopId]);

  if (n === null) return null;
  return (
    <div className="stat-tile">
      <div className="lbl">{t('sr_new_regulars')}</div>
      <div className="val">{n}</div>
      <div className="stat-sub">{t('sr_second_visit')}</div>
    </div>
  );
}
