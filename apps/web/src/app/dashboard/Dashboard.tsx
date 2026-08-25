'use client';
/**
 * Shop dashboard: live day calendar per stylist, booking management,
 * service & price editing, and the pricing-rule switches that drive the
 * consumer side's smart prices.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, timeOf, weekdayShort, dayNum, monthShort } from '@/lib/format';
import { apiOverview, apiSetStatus, apiPatchService, apiToggleRule, apiAvailability, apiShopCreateBooking } from '@/lib/api';
import { todayIso, addDays } from '@/core/time';

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

interface Overview {
  shop: {
    id: string;
    name: string;
    emoji: string;
    services: Array<{
      id: string;
      emoji: string;
      name: { en: string; de: string };
      durationMin: number;
      basePriceCents: number;
      dynamicPricing: boolean;
    }>;
    pricingRules: Array<{ id: string; name: string; enabled: boolean }>;
  };
  isoDate: string;
  occupancyPct: number;
  revenueCents: number;
  bookingCount: number;
  staffRows: Array<{
    staffId: string;
    name: string;
    role: { en: string; de: string };
    working: Array<{ start: number; end: number }>;
    blocks: Array<{
      kind: 'booking' | 'walk_in';
      bookingId?: string;
      guestName?: string;
      serviceNames?: string[];
      status?: string;
      start: number;
      end: number;
    }>;
  }>;
  bookings: Array<{
    id: string;
    reference: string;
    guestName: string;
    serviceNames: string[];
    staffName: string;
    startsAt: number;
    status: string;
    totalCents: number;
  }>;
  week: Array<{ iso: string; revenueCents: number }>;
}

export function Dashboard({ shops }: { shops: Array<{ id: string; name: string; emoji: string }> }) {
  const { t, lang } = useI18n();
  // Same two-month horizon the customer side books against.
  const days = useMemo(() => Array.from({ length: 62 }, (_, i) => addDays(todayIso(), i)), []);
  const [shopId, setShopId] = useState(shops[0]?.id ?? '');
  const [date, setDate] = useState(days[0]);
  const [data, setData] = useState<Overview | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const overview = await apiOverview(shopId, date);
    if (overview) setData(overview);
  }, [shopId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const setStatus = async (bookingId: string, status: 'completed' | 'no_show') => {
    await apiSetStatus(shopId, bookingId, status);
    setToast(status === 'completed' ? '✅ ' + t('st_completed') : '🚫 ' + t('st_no_show'));
    void load();
  };

  const patchService = async (
    sid: string,
    patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean },
  ) => {
    await apiPatchService(shopId, sid, patch);
    setToast('💾 OK');
    void load();
  };

  const toggleRule = async (rid: string) => {
    await apiToggleRule(shopId, rid);
    void load();
  };

  const avgTicket = data && data.bookingCount > 0 ? Math.round(data.revenueCents / data.bookingCount) : 0;
  const maxWeek = data ? Math.max(...data.week.map((w) => w.revenueCents), 1) : 1;

  return (
    <div>
      <div className="page-title">
        <h1>💼 {t('dash_title')}</h1>
        <label className="chip">
          {t('dash_pick')}
          <select value={shopId} onChange={(e) => setShopId(e.target.value)}>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.emoji} {s.name}
              </option>
            ))}
          </select>
        </label>
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

          <section className="section">
            <h2>{t('calendar')}</h2>
            <div className="cal-wrap">
              <div className="cal">
                {data.staffRows.map((row) => (
                  <div className="cal-row" key={row.staffId}>
                    <div className="cal-staff">
                      <div className="name">{row.name}</div>
                      <div className="role">{row.role[lang]}</div>
                    </div>
                    <div className="cal-track">
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
                            style={{ left, width: `calc(${right} - ${left})` }}
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
              onCreated={() => {
                setToast('✅ ' + t('dash_created'));
                void load();
              }}
            />
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
                          {b.status === 'confirmed' && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-soft sm" onClick={() => void setStatus(b.id, 'completed')}>
                                ✓ {t('mark_completed')}
                              </button>
                              <button className="btn btn-ghost sm" onClick={() => void setStatus(b.id, 'no_show')}>
                                {t('mark_no_show')}
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

          <section className="section">
            <h2>{t('revenue_7d')}</h2>
            <div className="panel">
              <div className="bars">
                {data.week.map((w) => (
                  <div className="bar-col" key={w.iso}>
                    <div className="bar-v" style={{ height: `${(w.revenueCents / maxWeek) * 100}%` }} />
                    <div className="bar-l">{weekdayShort(w.iso, lang)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="section">
            <h2>{t('svc_manage')}</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>{t('services')}</th>
                    <th>{t('price')}</th>
                    <th>{t('duration')}</th>
                    <th>{t('smart_pricing')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shop.services.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.emoji} <strong>{s.name[lang]}</strong>
                      </td>
                      <td>
                        <div className="svc-edit">
                          <input
                            type="number"
                            min={0}
                            step="0.5"
                            defaultValue={(s.basePriceCents / 100).toFixed(2)}
                            key={`${s.id}-${s.basePriceCents}`}
                            onBlur={(e) => {
                              const cents = Math.round(parseFloat(e.target.value || '0') * 100);
                              if (cents !== s.basePriceCents && cents > 0) {
                                void patchService(s.id, { basePriceCents: cents });
                              }
                            }}
                          />
                          €
                        </div>
                      </td>
                      <td>
                        <div className="svc-edit">
                          <input
                            type="number"
                            min={10}
                            step={5}
                            defaultValue={s.durationMin}
                            key={`${s.id}-d-${s.durationMin}`}
                            onBlur={(e) => {
                              const v = Math.round(Number(e.target.value));
                              if (v !== s.durationMin && v >= 10) void patchService(s.id, { durationMin: v });
                            }}
                          />
                          {t('min')}
                        </div>
                      </td>
                      <td>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={s.dynamicPricing}
                            onChange={(e) => void patchService(s.id, { dynamicPricing: e.target.checked })}
                          />
                          <span className="knob" />
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section">
            <h2>{t('rules_title')}</h2>
            <div className="panel">
              <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 12 }}>{t('rules_hint')}</p>
              {data.shop.pricingRules.length === 0 ? (
                <p style={{ color: 'var(--ink-soft)', fontSize: '0.88rem' }}>—</p>
              ) : (
                data.shop.pricingRules.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 0',
                      borderTop: '1px solid var(--line)',
                    }}
                  >
                    <span style={{ flex: 1, fontWeight: 600, fontSize: '0.9rem' }}>{r.name}</span>
                    <span
                      className={`st-badge ${r.enabled ? 'st-confirmed' : 'st-pending_payment'}`}
                    >
                      {r.enabled ? t('rule_on') : t('rule_off')}
                    </span>
                    <label className="switch">
                      <input type="checkbox" checked={r.enabled} onChange={() => void toggleRule(r.id)} />
                      <span className="knob" />
                    </label>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NewBooking({
  shopId,
  date,
  services,
  staff,
  onCreated,
}: {
  shopId: string;
  date: string;
  services: Overview['shop']['services'];
  staff: Array<{ id: string; name: string }>;
  onCreated: () => void;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    if (!open || !serviceId) return;
    setSlots(null);
    setStartsAt(null);
    void apiAvailability(shopId, [serviceId], date, staffId).then((s) =>
      setSlots(s.map((x) => ({ start: x.start, priceCents: x.priceCents }))),
    );
  }, [open, shopId, serviceId, staffId, date]);

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
