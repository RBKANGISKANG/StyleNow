'use client';
/**
 * Today tab — the screen a salon actually runs the day from: how full it is,
 * the live calendar per stylist, and the booking list. Click a free stretch to
 * add an appointment, click a booking to move it.
 *
 * Everything that is set up rather than run — services, team, HR, shop
 * settings — lives on its own tab; see ./shell.tsx.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, timeOf, weekdayShort, dayNum, monthShort } from '@/lib/format';
import {
  apiSetStatus,
  apiAvailability,
  apiShopCreateBooking,
  apiRescheduleBooking,
} from '@/lib/api';
import { deviceId } from '@/lib/device';
import { useConfirm } from '@/components/ConfirmDialog';
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

function TodayTab({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  // Same two-month horizon the customer side books against.
  const days = useMemo(() => Array.from({ length: 62 }, (_, i) => addDays(todayIso(), i)), []);
  const [date, setDate] = useState(days[0]);
  const { data, reload: load } = useOverview(shopId, date);
  const { setToast, toastEl } = useToast();
  const [nbOpen, setNbOpen] = useState(false);
  const [nbPrefill, setNbPrefill] = useState<{ staffId: string | null; minute?: number } | null>(null);
  const [moveFor, setMoveFor] = useState<Overview['bookings'][number] | null>(null);
  const { ask, dialog } = useConfirm();

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

  const avgTicket = data && data.bookingCount > 0 ? Math.round(data.revenueCents / data.bookingCount) : 0;

  return (
    <>
      <div className="today-bar">
        <div className="seg">
          <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>
            🗓 {t('view_calendar')}
          </button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            ☰ {t('view_list')}
          </button>
        </div>
        <span style={{ fontSize: '0.74rem', color: 'var(--ink-soft)' }}>🔒 {t('own_scope')}</span>
      </div>

    <div className="date-strip">
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
    {data === null ? (
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
                      setNbPrefill({ staffId: row.staffId, minute });
                      setNbOpen(true);
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
                            if (bk && ['confirmed', 'pending_payment'].includes(bk.status)) setMoveFor(bk);
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
          <NewBooking
            shopId={shopId}
            date={date}
            services={data.shop.services}
            staff={data.staffRows.map((r) => ({ id: r.staffId, name: r.name }))}
            open={nbOpen}
            setOpen={(v) => {
              setNbOpen(v);
              if (!v) setNbPrefill(null);
            }}
            prefill={nbPrefill}
            onCreated={() => {
              setToast('✅ ' + t('dash_created'));
              void load();
            }}
          />
          {moveFor && (
            <MovePanel
              shopId={shopId}
              booking={moveFor}
              staff={data.staffRows.map((r) => ({ id: r.staffId, name: r.name }))}
              onClose={() => setMoveFor(null)}
              onMoved={() => {
                setMoveFor(null);
                setToast('✅ ' + t('dash_moved'));
                void load();
              }}
            />
          )}
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
                      <td>{b.guestName}</td>
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
                            <button className="btn btn-soft sm" onClick={() => setMoveFor(b)}>
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

      {toastEl}
      {dialog}
    </>
  );
}

function NewBooking({
  shopId,
  date,
  services,
  staff,
  open,
  setOpen,
  prefill,
  onCreated,
}: {
  shopId: string;
  date: string;
  services: Overview['shop']['services'];
  staff: Array<{ id: string; name: string }>;
  open: boolean;
  setOpen: (v: boolean) => void;
  prefill: { staffId: string | null; minute?: number } | null;
  onCreated: () => void;
}) {
  const { t, lang } = useI18n();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Array<{ start: number; priceCents: number }> | null>(null);
  const [startsAt, setStartsAt] = useState<number | null>(null);
  const [customer, setCustomer] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    setServiceId((cur) => (services.some((s) => s.id === cur) ? cur : services[0]?.id ?? ''));
  }, [services]);

  // A click in a stylist's calendar row opens the panel with that stylist set.
  useEffect(() => {
    if (open && prefill) setStaffId(prefill.staffId);
  }, [open, prefill]);

  useEffect(() => {
    if (!open || !serviceId) return;
    setSlots(null);
    setStartsAt(null);
    void apiAvailability(shopId, [serviceId], date, staffId).then((s) => {
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
    const r = await apiShopCreateBooking(shopId, [serviceId], staffId, startsAt, customer.trim());
    setBusy(false);
    if (!r.ok) {
      setConflict(true);
      setStartsAt(null);
      void apiAvailability(shopId, [serviceId], date, staffId).then((s) =>
        setSlots(s.map((x) => ({ start: x.start, priceCents: x.priceCents }))),
      );
      return;
    }
    setCustomer('');
    setStartsAt(null);
    setOpen(false);
    onCreated();
  };

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        {t('dash_new')}
      </button>
    );
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h3 style={{ marginBottom: 0 }}>{t('dash_new_title')}</h3>
        <button className="btn btn-ghost sm" onClick={() => setOpen(false)}>✕</button>
      </div>
      {conflict && <div className="alert" style={{ marginTop: 10 }}>{t('slot_taken_body')}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <label className="chip">
          ✂️
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.emoji} {s.name[lang]} · {money(s.basePriceCents, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="chip">
          👤
          <select value={staffId ?? ''} onChange={(e) => setStaffId(e.target.value || null)}>
            <option value="">{t('any_staff')}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder={`${t('dash_cust_name')} *`}
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          maxLength={60}
        />
      </div>
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
      <button
        className="btn btn-primary"
        style={{ marginTop: 10 }}
        disabled={busy || !startsAt || !customer.trim()}
        onClick={() => void create()}
      >
        {busy ? '…' : t('dash_create')}
      </button>
    </div>
  );
}

function MovePanel({
  shopId,
  booking,
  staff,
  onClose,
  onMoved,
}: {
  shopId: string;
  booking: Overview['bookings'][number];
  staff: Array<{ id: string; name: string }>;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { t, lang } = useI18n();
  const [date, setDate] = useState(isoDateOf(booking.startsAt));
  // Default to the booking's own stylist: a slot that is free for someone
  // else is not necessarily free for this booking's stylist.
  const [staffId, setStaffId] = useState<string>(booking.staffId);
  const [slots, setSlots] = useState<Array<{ start: number; priceCents: number }> | null>(null);
  const [startsAt, setStartsAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const minDate = todayIso();
  const maxDate = addDays(todayIso(), 61);

  useEffect(() => {
    setSlots(null);
    setStartsAt(null);
    void apiAvailability(shopId, booking.serviceIds, date, staffId).then((s) =>
      setSlots(s.map((x) => ({ start: x.start, priceCents: x.priceCents }))),
    );
  }, [shopId, booking.serviceIds, date, staffId]);

  const move = async () => {
    if (!startsAt) return;
    setBusy(true);
    setConflict(false);
    const r = await apiRescheduleBooking(shopId, booking.id, startsAt, staffId);
    setBusy(false);
    if (!r.ok) {
      setConflict(true);
      setStartsAt(null);
      return;
    }
    onMoved();
  };

  return (
    <div className="panel move-panel" style={{ marginTop: 14, border: '2px solid var(--primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h3 style={{ marginBottom: 0 }}>⇄ {t('dash_move_title', { name: booking.guestName })}</h3>
        <button className="btn btn-ghost sm" onClick={onClose}>✕</button>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: 4 }}>
        {booking.serviceNames.join(', ')} · {t('step_time')}: {timeOf(booking.startsAt, lang)}
      </p>
      {conflict && <div className="alert" style={{ marginTop: 10 }}>{t('slot_taken_body')}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <label className="chip">
          📅 {t('dash_pick_date')}
          <input
            type="date"
            value={date}
            min={minDate}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            style={{ border: 'none', background: 'transparent', outline: 'none', fontWeight: 600 }}
          />
        </label>
        <label className="chip">
          👤
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>
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
      <button
        className="btn btn-primary move-submit"
        style={{ marginTop: 12 }}
        disabled={busy || !startsAt}
        onClick={() => void move()}
      >
        {busy ? '…' : `⇄ ${t('dash_move')}`}
      </button>
    </div>
  );
}
