'use client';
/**
 * Today tab — the screen a salon actually runs the day from: how full it is,
 * the live calendar per stylist, and the booking list. Click a free stretch to
 * add an appointment, click a booking to open it.
 *
 * Day / week / month are three windows on the same diary. Adding an
 * appointment works from all three, and both dialogs are modals so you never
 * lose the slot you were looking at.
 *
 * Everything that is set up rather than run — services, team, HR, shop
 * settings — lives on its own tab; see ./shell.tsx.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, timeOf, weekdayShort, dayNum, monthShort } from '@/lib/format';
import {
  apiSetStatus,
  apiAvailability,
  apiShopCreateBooking,
  apiRescheduleBooking,
  apiShopWaitlist,
  type ShopWaitlistRow,
} from '@/lib/api';
import { deviceId } from '@/lib/device';
import { useConfirm } from '@/components/ConfirmDialog';
import { ShopCalendar, CALENDAR_SPANS, spanKey } from '@/components/ShopCalendar';
import { AppointmentDialog, type DialogBooking } from '@/components/AppointmentDialog';
import { Modal } from '@/components/Modal';
import { Briefing } from '@/components/Briefing';
import { DayHeadline, NextUpCard } from '@/components/OperatorToday';
import { CustomerPicker } from '@/components/CustomerPicker';
import { Glyph } from '@/components/Icon';
import { useStudio } from '@/lib/design';
import { useToast } from './toast';
import { OperatorShell, useOverview, type Overview } from './shell';
import type { ShopRef } from '@/lib/owned-shops';
import { todayIso, addDays, isoDateOf } from '@/core/time';

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 20 * 60;
const DAY_SPAN = DAY_END_MIN - DAY_START_MIN;

/** Minute of day in shop time (Europe/Berlin) for positioning calendar blocks. */
function minOfDay(epoch: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(epoch));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

function pct(min: number): string {
  return `${Math.min(Math.max(((min - DAY_START_MIN) / DAY_SPAN) * 100, 0), 100)}%`;
}

export function Dashboard({ shops }: { shops: ShopRef[] }) {
  return (
    <OperatorShell shops={shops} active="/dashboard">
      {({ shopId }) => <TodayTab shopId={shopId} />}
    </OperatorShell>
  );
}

const SPAN_KEY = 'stylenow.today.span';

function TodayTab({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const studio = useStudio();
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  // Day is the shift you are running; week and month are the diary you plan in.
  const [span, setSpan] = useState<'day' | 'week' | 'month'>('day');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SPAN_KEY);
      if (saved === 'day' || saved === 'week' || saved === 'month') setSpan(saved);
    } catch {
      // private mode — day it is
    }
  }, []);

  const chooseSpan = (next: 'day' | 'week' | 'month') => {
    setSpan(next);
    try {
      window.localStorage.setItem(SPAN_KEY, next);
    } catch {
      // ignore
    }
  };
  // Two months forward — the horizon the customer side books against — and a
  // fortnight back, because a shop looks at yesterday too, and because the
  // month view can hand you a date that has already been and gone.
  const days = useMemo(() => Array.from({ length: 76 }, (_, i) => addDays(todayIso(), i - 14)), []);
  const [date, setDate] = useState(todayIso());
  const { data, reload: load } = useOverview(shopId, date);
  const { setToast, toastEl } = useToast();
  // Clicking an appointment anywhere opens it; adding one is reachable from
  // every span, not just the day view.
  const [openAppt, setOpenAppt] = useState<DialogBooking | null>(null);
  const [addFor, setAddFor] = useState<{ date: string; staffId: string | null; minute?: number } | null>(null);
  const { ask, dialog } = useConfirm();
  // The strip now starts a fortnight in the past, so bring today into view
  // once — otherwise the shop opens on last week.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const centred = useRef(false);

  useEffect(() => {
    if (centred.current || span !== 'day' || !stripRef.current) return;
    const sel = stripRef.current.querySelector('.date-pill.sel') as HTMLElement | null;
    if (!sel) return;
    stripRef.current.scrollLeft = Math.max(sel.offsetLeft - 12, 0);
    centred.current = true;
  }, [span, data]);

  const setStatus = async (bookingId: string, status: 'completed' | 'no_show') => {
    await apiSetStatus(shopId, bookingId, status);
    setToast(status === 'completed' ? '✅ ' + t('st_completed') : '🚫 ' + t('st_no_show'));
    void load();
  };

  const cancelBooking = async (bookingId: string) => {
    await apiSetStatus(shopId, bookingId, 'cancelled_by_shop');
    setToast('🗑 ' + t('dash_cancelled'));
    void load();
  };

  // Week runs Monday–Sunday around the selected date; month is its calendar
  // month. Both anchor on `date`, so the day you pick is the day you land on.
  const range = useMemo(() => {
    if (span === 'month') {
      const first = `${date.slice(0, 8)}01`;
      const d = new Date(`${first}T12:00:00Z`);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
      return { from: first, to: isoDateOf(last.getTime()) };
    }
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    const monday = addDays(date, 1 - dow);
    return { from: monday, to: addDays(monday, 6) };
  }, [span, date]);

  const avgTicket = data && data.bookingCount > 0 ? Math.round(data.revenueCents / data.bookingCount) : 0;

  return (
    <>
      {studio && span === 'day' && (
        <>
          <DayHeadline shopId={shopId} date={date} data={data} onNew={() => setAddFor({ date, staffId: null })} />
          <NextUpCard
            shopId={shopId}
            date={date}
            data={data}
            onOpen={() => {
              setSpan('day');
              setView('calendar');
            }}
          />
        </>
      )}
      <div className="today-bar">
        <div className="seg">
          {CALENDAR_SPANS.map((sp) => (
            <button key={sp} className={span === sp ? 'on' : ''} onClick={() => chooseSpan(sp)}>
              {t(spanKey(sp))}
            </button>
          ))}
        </div>
        {span === 'day' && (
          <div className="seg">
            <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>
              🗓 {t('view_calendar')}
            </button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
              ☰ {t('view_list')}
            </button>
          </div>
        )}
        {!(studio && span === 'day') && (
          <button className="btn btn-primary sm" onClick={() => setAddFor({ date, staffId: null })}>
            {t('dash_new')}
          </button>
        )}
        <span style={{ fontSize: '0.74rem', color: 'var(--ink-soft)' }}>
          {span === 'day' ? `🔒 ${t('own_scope')}` : `${range.from} → ${range.to}`}
        </span>
      </div>

    <Briefing shopId={shopId} />

    {span === 'day' && (
    <div className="date-strip" ref={stripRef}>
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
    )}

    {span !== 'day' ? (
      <ShopCalendar
        shopId={shopId}
        from={range.from}
        to={range.to}
        span={span}
        onPickDay={(iso) => {
          setDate(iso);
          chooseSpan('day');
        }}
        onAddOn={(iso) => setAddFor({ date: iso, staffId: null })}
        onOpenAppointment={(a) => setOpenAppt(a)}
      />
    ) : data === null ? (
      <div className="spinner" />
    ) : (
      <>
        <div className="stat-row">
          <div className="stat-tile">
            <div className="lbl">{t('occupancy')}</div>
            <div className="val">{data.occupancyPct} %</div>
            <div className="bar">
              <div style={{ width: `${data.occupancyPct}%` }} />
            </div>
          </div>
          <div className="stat-tile">
            <div className="lbl">{t('revenue_today')}</div>
            <div className="val">{money(data.revenueCents, lang)}</div>
          </div>
          <div className="stat-tile">
            <div className="lbl">{t('bookings_today')}</div>
            <div className="val">{data.bookingCount}</div>
          </div>
          <div className="stat-tile">
            <div className="lbl">{t('avg_ticket')}</div>
            <div className="val">{avgTicket ? money(avgTicket, lang) : '—'}</div>
          </div>
        </div>

        <section className="section" style={{ display: view === 'calendar' ? undefined : 'none' }}>
          <h2>{t('calendar')}</h2>
          <p style={{ fontSize: '0.76rem', color: 'var(--ink-soft)', margin: '4px 0 10px' }}>💡 {t('dash_cal_hint')}</p>
          <div className="cal-wrap">
            <div className="cal">
              {data.staffRows.map((row) => (
                <div className="cal-row" key={row.staffId}>
                  <div className="cal-staff">
                    <div className="name">{row.name}</div>
                    <div className="role">{row.role[lang]}</div>
                  </div>
                  <div
                    className="cal-track clickable"
                    onClick={(e) => {
                      if (row.working.length === 0) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const minute = DAY_START_MIN + ((e.clientX - rect.left) / rect.width) * DAY_SPAN;
                      setAddFor({ date, staffId: row.staffId, minute });
                    }}
                  >
                    {row.working.length === 0 && <div className="cal-block off" style={{ left: 0, right: 0 }} />}
                    {row.blocks.map((b, i) => {
                      const left = pct(minOfDay(b.start));
                      const right = pct(minOfDay(b.end));
                      return (
                        <div
                          key={i}
                          className={`cal-block ${
                            b.kind === 'walk_in' ? 'walk' : b.status === 'pending_payment' ? 'pending' : 'booking'
                          }`}
                          style={{ left, width: `calc(${right} - ${left})`, cursor: b.kind === 'booking' ? 'pointer' : 'default' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (b.kind !== 'booking' || !b.bookingId) return;
                            const bk = data.bookings.find((x) => x.id === b.bookingId);
                            if (bk) setOpenAppt(bk);
                          }}
                          title={
                            b.kind === 'walk_in'
                              ? t('walk_in')
                              : `${b.guestName} · ${b.serviceNames?.join(', ')} · ${timeOf(b.start, lang)}`
                          }
                        >
                          {b.kind === 'booking' ? `${b.guestName}` : ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="cal-hours">
                <div />
                <div className="marks">
                  {['08', '10', '12', '14', '16', '18', '20'].map((hh) => (
                    <span key={hh}>{hh}:00</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <h2>{t('list')}</h2>
          {data.bookings.length === 0 ? (
            <div className="empty" style={{ padding: '26px 16px' }}>
              {t('no_bookings_day')}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('step_time')}</th>
                    <th>Guest</th>
                    <th>{t('services')}</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.bookings.map((b) => (
                    <tr key={b.id}>
                      <td style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{b.reference}</td>
                      <td>{timeOf(b.startsAt, lang)}</td>
                      <td>
                        {b.guestName}
                        {b.guestPhone && (
                          <a className="bk-phone" href={`tel:${b.guestPhone.replace(/\s/g, '')}`}>
                            📞 {b.guestPhone}
                          </a>
                        )}
                        {b.guestNote && <span className="bk-note" title={b.guestNote}>💬 {b.guestNote}</span>}
                      </td>
                      <td>
                        {b.serviceNames.join(', ')}
                        <div style={{ fontSize: '0.72rem', color: 'var(--ink-soft)' }}>{b.staffName}</div>
                      </td>
                      <td style={{ fontWeight: 700 }}>{money(b.totalCents, lang)}</td>
                      <td>
                        <span className={`st-badge st-${b.status}`}>{t(`st_${b.status}` as MsgKey)}</span>
                      </td>
                      <td>
                        {['confirmed', 'pending_payment'].includes(b.status) && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {b.status === 'confirmed' && (
                              <button className="btn btn-soft sm" onClick={() => void setStatus(b.id, 'completed')}>
                                ✓ {t('mark_completed')}
                              </button>
                            )}
                            <button className="btn btn-soft sm" onClick={() => setOpenAppt(b)}>
                              ⇄ {t('dash_move')}
                            </button>
                            {b.status === 'confirmed' && (
                              <button className="btn btn-ghost sm" onClick={() => void setStatus(b.id, 'no_show')}>
                                {t('mark_no_show')}
                              </button>
                            )}
                            <button
                              className="btn btn-ghost sm"
                              style={{ color: 'var(--danger)' }}
                              onClick={() =>
                                ask({
                                  title: t('del_booking_title', { name: b.guestName }),
                                  body: t('del_booking_body'),
                                  consequences: [
                                    `${b.serviceNames.join(', ')} · ${timeOf(b.startsAt, lang)} · ${money(b.totalCents, lang)}`,
                                    t('del_booking_c1'),
                                  ],
                                  confirmLabel: t('del_booking_confirm'),
                                  run: () => cancelBooking(b.id),
                                })
                              }
                            >
                              ✕ {t('dash_cancel_bk')}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

    </>
  )}

      <Waitlist shopId={shopId} />

      <AppointmentDialog
        shopId={shopId}
        booking={openAppt}
        staff={(data?.staffRows ?? []).map((r) => ({ id: r.staffId, name: r.name }))}
        onClose={() => setOpenAppt(null)}
        onChanged={(msg) => {
          setToast(msg);
          void load();
        }}
      />

      {addFor && data && (
        <NewBooking
          shopId={shopId}
          services={data.shop.services}
          staff={data.staffRows.map((r) => ({ id: r.staffId, name: r.name }))}
          prefill={addFor}
          onClose={() => setAddFor(null)}
          onCreated={() => {
            setToast('✅ ' + t('dash_created'));
            void load();
          }}
        />
      )}

      {toastEl}
      {dialog}
    </>
  );
}

/**
 * Who is waiting for a seat.
 *
 * The waitlist already existed but only the customer could see it, so a
 * cancellation freed a slot and nobody was told. This is the missing half:
 * the front desk sees who wanted that day, and — the part that turns it into
 * money — whether anything has since opened up for them.
 */
function Waitlist({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<ShopWaitlistRow[] | null>(null);

  useEffect(() => {
    if (!shopId) return;
    void apiShopWaitlist(shopId, todayIso()).then(setRows);
  }, [shopId]);

  if (!rows || rows.length === 0) return null;
  const callable = rows.filter((r) => r.freeSlots > 0).length;

  return (
    <section className="section">
      <h2>
        ⏳ {t('wl_title')}
        {callable > 0 && <span className="cus-tag risk" style={{ marginLeft: 8 }}>{t('wl_callable', { n: String(callable) })}</span>}
      </h2>
      <div className="panel">
        {rows.map((w) => (
          <div key={w.id} className="wl-row">
            <div>
              <strong>{w.isoDate}</strong>
              <span>{w.serviceNames.map((n) => n[lang]).join(', ')}</span>
            </div>
            {w.freeSlots > 0 ? (
              <span className="wl-free">
                ✅ {t('wl_free', { n: String(w.freeSlots) })}
                {w.nextFreeAt !== null && ` · ${timeOf(w.nextFreeAt, lang)}`}
              </span>
            ) : (
              <span className="wl-full">{t('wl_full')}</span>
            )}
          </div>
        ))}
        <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', marginTop: 10 }}>💡 {t('wl_hint')}</p>
      </div>
    </section>
  );
}

/**
 * Adding an appointment, as a dialog rather than a panel.
 *
 * It carries its own date field, which is what makes it reachable from the
 * week and month views: there is no "selected day" to inherit there, and
 * jumping to the day view first only to come back is a detour.
 */
function NewBooking({
  shopId,
  services,
  staff,
  prefill,
  onClose,
  onCreated,
}: {
  shopId: string;
  services: Overview['shop']['services'];
  staff: Array<{ id: string; name: string }>;
  prefill: { date: string; staffId: string | null; minute?: number };
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, lang } = useI18n();
  const [date, setDate] = useState(prefill.date);
  const open = true;
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Array<{ start: number; priceCents: number }> | null>(null);
  const [startsAt, setStartsAt] = useState<number | null>(null);
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  // A day already gone is a recording, not a booking — the dialog offers that
  // day's rostered times instead of nothing, and says which it is doing.
  const isPast = date < todayIso();

  useEffect(() => {
    setServiceId((cur) => (services.some((s) => s.id === cur) ? cur : services[0]?.id ?? ''));
  }, [services]);

  // A click in a stylist's calendar row opens the dialog with that stylist set.
  useEffect(() => {
    setStaffId(prefill.staffId);
    setDate(prefill.date);
  }, [prefill]);

  useEffect(() => {
    if (!open || !serviceId) return;
    setSlots(null);
    setStartsAt(null);
    void apiAvailability(shopId, [serviceId], date, staffId, isPast).then((s) => {
      const mapped = s.map((x) => ({ start: x.start, priceCents: x.priceCents }));
      setSlots(mapped);
      if (prefill?.minute !== undefined && mapped.length > 0) {
        // preselect the slot nearest to where the calendar was clicked
        const nearest = mapped.reduce((best, cur) =>
          Math.abs(minOfDay(cur.start) - prefill.minute!) < Math.abs(minOfDay(best.start) - prefill.minute!) ? cur : best,
        );
        setStartsAt(nearest.start);
      }
    });
  }, [open, shopId, serviceId, staffId, date, prefill]);

  const create = async () => {
    if (!startsAt || !customer.trim()) return;
    setBusy(true);
    setConflict(false);
    const r = await apiShopCreateBooking(shopId, [serviceId], staffId, startsAt, customer.trim(), {
      phone: phone.trim() || undefined,
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setConflict(true);
      setStartsAt(null);
      void apiAvailability(shopId, [serviceId], date, staffId, isPast).then((s) =>
        setSlots(s.map((x) => ({ start: x.start, priceCents: x.priceCents }))),
      );
      return;
    }
    setCustomer('');
    setPhone('');
    setNote('');
    setStartsAt(null);
    onCreated();
    onClose();
  };

  return (
    <Modal open wide onClose={onClose} title={t('dash_new_title')} subtitle={date}>
      {conflict && <div className="alert" style={{ marginBottom: 10 }}>{t('slot_taken_body')}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }}>
        <label className="chip">
          {t('dash_pick_date')}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ border: 'none', background: 'transparent', outline: 'none', fontWeight: 600 }}
          />
        </label>
        {/* No glyph here: each option already carries the service's own emoji,
            so a scissors on the label rendered "✂️ ✂️ Cut & Finish". */}
        <label className="chip">
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.emoji} {s.name[lang]} · {money(s.basePriceCents, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="chip">
          <Glyph name="user" emoji="👤" size={15} />
          <select value={staffId ?? ''} onChange={(e) => setStaffId(e.target.value || null)}>
            <option value="">{t('any_staff')}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <CustomerPicker
          shopId={shopId}
          name={customer}
          onPick={({ name, phone: p }) => {
            setCustomer(name);
            if (p !== undefined) setPhone(p);
          }}
        />
        <input
          className="input"
          style={{ flex: 1, minWidth: 150 }}
          type="tel"
          placeholder={t('your_phone')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={24}
        />
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder={t('your_note')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
        />
      </div>
      {isPast && (
        <div className="backfill-note">
          {t('bf_past_note')}
        </div>
      )}
      {slots === null ? (
        <div className="spinner" />
      ) : slots.length === 0 ? (
        <div className="empty" style={{ padding: '20px 14px' }}>{t('no_slots')}</div>
      ) : (
        <div className="slot-grid">
          {slots.map((s) => (
            <button
              key={s.start}
              className={`slot-chip ${startsAt === s.start ? 'sel' : ''}`}
              onClick={() => setStartsAt(s.start)}
            >
              <div className="t">{timeOf(s.start, lang)}</div>
              <div className="p">{money(s.priceCents, lang)}</div>
            </button>
          ))}
        </div>
      )}
      <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: 10 }}>{t('dash_pay_note')}</p>
      <div className="md-card-foot" style={{ margin: '12px -20px -20px', borderTop: '1px solid var(--line)' }}>
        <button className="btn btn-soft" onClick={onClose}>
          {t('back')}
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || !startsAt || !customer.trim()}
          onClick={() => void create()}
        >
          {busy ? '…' : t('dash_create')}
        </button>
      </div>
    </Modal>
  );
}

