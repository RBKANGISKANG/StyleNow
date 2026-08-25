'use client';
/**
 * Shop dashboard: live day calendar per stylist, booking management,
 * service & price editing, and the pricing-rule switches that drive the
 * consumer side's smart prices.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, timeOf, weekdayShort, dayNum, monthShort } from '@/lib/format';
import {
  apiOverview,
  apiSetStatus,
  apiPatchService,
  apiToggleRule,
  apiAvailability,
  apiShopCreateBooking,
  apiRescheduleBooking,
  apiSetShopLogo,
  apiMyShops,
  apiClaimShop,
  apiReleaseShop,
  apiAddService,
  apiArchiveService,
  apiAddPricingRule,
  apiDeletePricingRule,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { deviceId } from '@/lib/device';
import { fileToLogoDataUrl } from '@/lib/image';
import { RevenueChart } from '@/components/RevenueChart';
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

interface Overview {
  shop: {
    id: string;
    name: string;
    emoji: string;
    logoUrl: string | null;
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
    serviceIds: string[];
    serviceNames: string[];
    staffId: string;
    staffName: string;
    startsAt: number;
    status: string;
    totalCents: number;
  }>;
  week: Array<{ iso: string; revenueCents: number }>;
}

export function Dashboard({ shops }: { shops: Array<{ id: string; name: string; emoji: string }> }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  // Operators only ever see shops connected to their account (or, signed out,
  // to this device) — never another company's calendar.
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [ownedIds, setOwnedIds] = useState<string[] | null>(null);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');

  useEffect(() => {
    const key = user?.email ?? (typeof window === 'undefined' ? '' : deviceId());
    setOwnerKey(key);
    void apiMyShops(key).then(setOwnedIds);
  }, [user]);

  const myShops = shops.filter((s) => (ownedIds ?? []).includes(s.id));
  // Same two-month horizon the customer side books against.
  const days = useMemo(() => Array.from({ length: 62 }, (_, i) => addDays(todayIso(), i)), []);
  const [shopId, setShopId] = useState('');
  const [date, setDate] = useState(days[0]);
  const [data, setData] = useState<Overview | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nbOpen, setNbOpen] = useState(false);
  const [nbPrefill, setNbPrefill] = useState<{ staffId: string | null; minute?: number } | null>(null);
  const [moveFor, setMoveFor] = useState<Overview['bookings'][number] | null>(null);

  // Keep the selection inside the owned set.
  useEffect(() => {
    if (myShops.length === 0) {
      setShopId('');
      setData(null);
      return;
    }
    if (!myShops.some((s) => s.id === shopId)) setShopId(myShops[0].id);
  }, [myShops, shopId]);

  const load = useCallback(async () => {
    if (!shopId) return;
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

  const cancelBooking = async (bookingId: string) => {
    await apiSetStatus(shopId, bookingId, 'cancelled_by_shop');
    setToast('🗑 ' + t('dash_cancelled'));
    void load();
  };

  const uploadLogo = async (file: File) => {
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      await apiSetShopLogo(shopId, dataUrl);
      setToast('✅ ' + t('logo_saved'));
      void load();
    } catch {
      // unreadable image — ignore
    }
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

  if (ownedIds === null) return <div className="spinner" />;

  if (myShops.length === 0) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="page-title">
          <h1>💼 {t('dash_title')}</h1>
        </div>
        <div className="empty">
          <div className="big">🏪</div>
          <h3 style={{ marginBottom: 6 }}>{t('own_none_title')}</h3>
          <p>{t('own_none_body')}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
            <a className="btn btn-primary" href="/partner">{t('partner_nav')} →</a>
            <label className="btn btn-soft" style={{ cursor: 'pointer' }}>
              🔗 {t('own_connect')}
              <select
                style={{ marginLeft: 8, background: 'transparent', border: 'none', outline: 'none', fontWeight: 700 }}
                value=""
                onChange={(e) => {
                  if (!e.target.value || !ownerKey) return;
                  void apiClaimShop(e.target.value, ownerKey).then(() => apiMyShops(ownerKey).then(setOwnedIds));
                }}
              >
                <option value="">…</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-title">
        <h1>💼 {t('dash_title')}</h1>
        <label className="chip">
          {t('dash_pick')}
          <select value={shopId} onChange={(e) => setShopId(e.target.value)}>
            {myShops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.emoji} {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="seg">
          <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>
            🗓 {t('view_calendar')}
          </button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            ☰ {t('view_list')}
          </button>
        </div>
        <button
          className="btn btn-ghost sm"
          onClick={() => {
            if (!ownerKey) return;
            void apiReleaseShop(shopId).then(() => apiMyShops(ownerKey).then(setOwnedIds));
          }}
        >
          {t('own_disconnect')}
        </button>
      </div>
      <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', marginBottom: 8 }}>🔒 {t('own_scope')}</p>

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
                                onClick={() => void cancelBooking(b.id)}
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

          <section className="section">
            <h2>{t('revenue_7d')}</h2>
            <RevenueChart data={data.week} />
          </section>

          <section className="section">
            <h2>{t('logo_title')}</h2>
            <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {data.shop.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.shop.logoUrl} alt="" className="logo-preview" />
              ) : (
                <div className="logo-preview" style={{ display: 'grid', placeItems: 'center', fontSize: '1.6rem' }}>
                  {data.shop.emoji}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 200 }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{t('logo_hint')}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <label className="btn btn-soft sm" style={{ cursor: 'pointer' }}>
                    🖼 {t('logo_upload')}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadLogo(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {data.shop.logoUrl && (
                    <button
                      className="btn btn-ghost sm"
                      onClick={() => {
                        void apiSetShopLogo(shopId, null).then(() => load());
                      }}
                    >
                      {t('logo_remove')}
                    </button>
                  )}
                </div>
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
                    <th />
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
                      <td>
                        <button
                          className="btn btn-ghost sm"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => {
                            void apiArchiveService(shopId, s.id).then(() => {
                              setToast('🗄 ' + t('svc_archived'));
                              void load();
                            });
                          }}
                        >
                          {t('svc_archive')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AddService
              shopId={shopId}
              onAdded={() => {
                setToast('✅ ' + t('svc_added'));
                void load();
              }}
            />
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
                    <button
                      className="btn btn-ghost sm"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => {
                        void apiDeletePricingRule(shopId, r.id).then(() => {
                          setToast('🗑 ' + t('rule_deleted'));
                          void load();
                        });
                      }}
                    >
                      {t('rule_delete')}
                    </button>
                  </div>
                ))
              )}
              <AddRule
                shopId={shopId}
                onAdded={() => {
                  setToast('✅ ' + t('rule_added'));
                  void load();
                }}
              />
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

function AddService({ shopId, onAdded }: { shopId: string; onAdded: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('✨');
  const [price, setPrice] = useState('');
  const [minutes, setMinutes] = useState('45');
  const [gap, setGap] = useState('0');
  const [dyn, setDyn] = useState(false);

  if (!open) {
    return (
      <button className="btn btn-soft sm" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
        {t('svc_add')}
      </button>
    );
  }
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ width: 70 }} value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={2} />
        <input
          className="input"
          style={{ flex: 1, minWidth: 160 }}
          placeholder={t('svc_new_name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
        <input className="input" style={{ width: 96 }} type="number" min={0} step="0.5" placeholder="€" value={price} onChange={(e) => setPrice(e.target.value)} />
        <input className="input" style={{ width: 90 }} type="number" min={5} step={5} placeholder={t('min')} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <input className="input" style={{ width: 110 }} type="number" min={0} step={5} placeholder={`+${t('min')} gap`} value={gap} onChange={(e) => setGap(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
          <span className="switch">
            <input type="checkbox" checked={dyn} onChange={(e) => setDyn(e.target.checked)} />
            <span className="knob" />
          </span>
          {t('smart_pricing')}
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-ghost sm" onClick={() => setOpen(false)}>✕</button>
        <button
          className="btn btn-primary sm"
          disabled={!name.trim() || !(Number(price) > 0)}
          onClick={() => {
            void apiAddService(shopId, {
              name: name.trim(),
              emoji,
              basePriceCents: Math.round(Number(price) * 100),
              durationMin: Number(minutes),
              processingGapMin: Number(gap),
              dynamicPricing: dyn,
            }).then(() => {
              setName('');
              setPrice('');
              setOpen(false);
              onAdded();
            });
          }}
        >
          {t('svc_add')}
        </button>
      </div>
    </div>
  );
}

const RULE_KINDS = ['time_of_day', 'day_of_week', 'last_minute', 'occupancy', 'new_customer', 'seasonal'] as const;
const DOW_KEYS = [1, 2, 3, 4, 5, 6, 7];

function AddRule({ shopId, onAdded }: { shopId: string; onAdded: () => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof RULE_KINDS)[number]>('time_of_day');
  const [adjustKind, setAdjustKind] = useState<'percent' | 'fixed_cents'>('percent');
  const [value, setValue] = useState('-10');
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('12:00');
  const [dows, setDows] = useState<number[]>([]);

  const toMinutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

  if (!open) {
    return (
      <button className="btn btn-soft sm" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
        {t('rule_add')}
      </button>
    );
  }
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '2px dashed var(--line)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder={t('rule_name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
        <label className="chip">
          {t('rule_kind')}
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {RULE_KINDS.map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>
        <label className="chip">
          {t('rule_adjust')}
          <select value={adjustKind} onChange={(e) => setAdjustKind(e.target.value as typeof adjustKind)}>
            <option value="percent">{t('rule_percent')}</option>
            <option value="fixed_cents">{t('rule_fixed')}</option>
          </select>
        </label>
        <input className="input" style={{ width: 100 }} type="number" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      {kind === 'time_of_day' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <input className="input" style={{ width: 120 }} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          –
          <input className="input" style={{ width: 120 }} type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
      {(kind === 'time_of_day' || kind === 'day_of_week') && (
        <div className="filter-row" style={{ marginTop: 8, marginBottom: 0 }}>
          {DOW_KEYS.map((d) => (
            <button
              key={d}
              className={`chip ${dows.includes(d) ? 'on-primary' : ''}`}
              onClick={() => setDows(dows.includes(d) ? dows.filter((x) => x !== d) : [...dows, d])}
            >
              {new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, d)))}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-ghost sm" onClick={() => setOpen(false)}>✕</button>
        <button
          className="btn btn-primary sm"
          disabled={!name.trim() || Number.isNaN(Number(value))}
          onClick={() => {
            const rule: Record<string, unknown> = {
              kind,
              name: name.trim(),
              adjustKind,
              adjustValue: adjustKind === 'percent' ? Number(value) : Math.round(Number(value) * 100),
              priority: 10,
              stackable: false,
            };
            if (dows.length) rule.dows = dows;
            if (kind === 'time_of_day') {
              rule.minuteOfDayFrom = toMinutes(from);
              rule.minuteOfDayTo = toMinutes(to);
            }
            if (kind === 'last_minute') rule.leadHoursMax = 3;
            if (kind === 'occupancy') rule.occupancyMinPct = 80;
            void apiAddPricingRule(shopId, rule).then(() => {
              setName('');
              setOpen(false);
              onAdded();
            });
          }}
        >
          {t('rule_save')}
        </button>
      </div>
    </div>
  );
}
