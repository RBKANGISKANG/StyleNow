'use client';
/**
 * Shop dashboard: live day calendar per stylist, booking management,
 * service & price editing, and the pricing-rule switches that drive the
 * consumer side's smart prices.
 */
import Link from 'next/link';
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
  apiClaimShop,
  apiReleaseShop,
  apiRecordExitFeedback,
  apiAddService,
  apiArchiveService,
  apiAddPricingRule,
  apiDeletePricingRule,
  apiAddStaff,
  apiPatchStaff,
  apiArchiveStaff,
  apiAddLocation,
  apiPatchLocation,
  apiDeleteLocation,
} from '@/lib/api';
import { useOwnedShops } from '@/lib/owned-shops';
import { fileToLogoDataUrl } from '@/lib/image';
import { RevenueChart } from '@/components/RevenueChart';
import { CategoryPicker } from '@/components/CategoryPicker';
import { useConfirm } from '@/components/ConfirmDialog';
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
      categoryId?: string;
    }>;
    pricingRules: Array<{ id: string; name: string; enabled: boolean }>;
    locations: Array<{ id: string; label: string; street: string; zip: string; city: string; district: string }>;
  };
  isoDate: string;
  occupancyPct: number;
  revenueCents: number;
  bookingCount: number;
  staffRows: Array<{
    staffId: string;
    name: string;
    role: { en: string; de: string };
    tier: 'senior' | 'stylist';
    locationId: string | null;
    shifts: Partial<Record<number, Array<{ startMin: number; endMin: number }>>>;
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
  // Operators only ever see shops connected to their account (or, signed out,
  // to this device) — never another company's calendar. Shared with the HR
  // page so both screens stay on the same shop.
  const { ownerKey, ownedIds, myShops, shopId, setShopId, refresh } = useOwnedShops(shops);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');

  // Same two-month horizon the customer side books against.
  const days = useMemo(() => Array.from({ length: 62 }, (_, i) => addDays(todayIso(), i)), []);
  const [date, setDate] = useState(days[0]);
  const [data, setData] = useState<Overview | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nbOpen, setNbOpen] = useState(false);
  const [nbPrefill, setNbPrefill] = useState<{ staffId: string | null; minute?: number } | null>(null);
  const [moveFor, setMoveFor] = useState<Overview['bookings'][number] | null>(null);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    if (!shopId) setData(null);
  }, [shopId]);

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
    patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean; categoryId?: string },
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
                  void apiClaimShop(e.target.value, ownerKey).then(refresh);
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
            if (!ownerKey || !data) return;
            const shopName = data.shop.name;
            const upcoming = data.bookings.filter(
              (b) => b.startsAt > Date.now() && ['confirmed', 'pending_payment'].includes(b.status),
            ).length;
            ask({
              title: t('co_del_title', { name: shopName }),
              body: t('co_del_body'),
              consequences: [
                ...(upcoming > 0 ? [t('co_del_open', { n: String(upcoming) })] : []),
                t('co_del_c1'),
                t('co_del_c2'),
                t('co_del_c3'),
              ],
              questions: [
                {
                  id: 'reason',
                  label: t('co_del_q_reason'),
                  required: true,
                  options: [
                    t('co_del_r_closed'),
                    t('co_del_r_moved'),
                    t('co_del_r_duplicate'),
                    t('co_del_r_temp'),
                    t('cd_reason_other'),
                  ],
                },
                { id: 'handover', label: t('co_del_q_handover'), placeholder: t('co_del_handover_ph') },
              ],
              typeToConfirm: shopName,
              confirmLabel: t('co_del_confirm'),
              run: async (answers) => {
                await apiRecordExitFeedback('shop', shopId, answers);
                await apiReleaseShop(shopId);
                refresh();
              },
            });
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

          <section className="section">
            <h2>{t('revenue_7d')}</h2>
            <RevenueChart data={data.week} />
          </section>

          <section className="section">
            <h2>👥 {t('team_title')}</h2>
            <TeamManager
              shopId={shopId}
              rows={data.staffRows}
              locations={data.shop.locations}
              onChanged={(msg) => {
                setToast(msg);
                void load();
              }}
            />
          </section>

          <section className="section">
            {/* HR is a screenful of its own — contracts, hours, absences. It
                lives on /dashboard/hr so this page stays about today. */}
            <Link href="/dashboard/hr" className="panel link-card">
              <span className="lc-ico">🧾</span>
              <span className="lc-text">
                <strong>{t('hr_title')}</strong>
                <span>{t('hr_page_teaser')}</span>
              </span>
              <span className="lc-go">{t('hr_open')} →</span>
            </Link>
          </section>

          <section className="section">
            <h2>📍 {t('loc_title')}</h2>
            <LocationManager
              shopId={shopId}
              locations={data.shop.locations}
              onChanged={(msg) => {
                setToast(msg);
                void load();
              }}
            />
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
                    <th>{t('svc_category')}</th>
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
                        <CategoryPicker
                          compact
                          value={s.categoryId ?? null}
                          onChange={(categoryId) => void patchService(s.id, { categoryId })}
                        />
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
                          onClick={() =>
                            ask({
                              title: t('del_service_title', { name: s.name[lang] }),
                              body: t('del_service_body'),
                              consequences: [t('del_service_c1'), t('del_service_c2')],
                              confirmLabel: t('del_service_confirm'),
                              run: () =>
                                apiArchiveService(shopId, s.id).then(() => {
                                  setToast('🗄 ' + t('svc_archived'));
                                  void load();
                                }),
                            })
                          }
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
                      onClick={() =>
                        ask({
                          title: t('del_rule_title', { name: r.name }),
                          body: t('del_rule_body'),
                          confirmLabel: t('del_rule_confirm'),
                          run: () =>
                            apiDeletePricingRule(shopId, r.id).then(() => {
                              setToast('🗑 ' + t('rule_deleted'));
                              void load();
                            }),
                        })
                      }
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
      {dialog}
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
  const [categoryId, setCategoryId] = useState<string | null>(null);

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
        <CategoryPicker value={categoryId} onChange={setCategoryId} />
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
              categoryId: categoryId ?? undefined,
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

const WEEK = [1, 2, 3, 4, 5, 6, 7];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

function TeamManager({
  shopId,
  rows,
  locations,
  onChanged,
}: {
  shopId: string;
  rows: Overview['staffRows'];
  locations: Overview['shop']['locations'];
  onChanged: (msg: string) => void;
}) {
  const { t, lang } = useI18n();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [tier, setTier] = useState<'senior' | 'stylist'>('stylist');
  const [locationId, setLocationId] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  return (
    <div className="panel">
      {dialog}
      {err && <div className="alert" style={{ marginBottom: 10 }}>{err}</div>}
      {rows.map((r) => (
        <div key={r.staffId} className="team-row">
          <div className="avatar" style={{ background: 'var(--violet)', margin: 0, width: 40, height: 40, fontSize: '1rem' }}>
            {r.name[0]?.toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <input
              className="input"
              style={{ fontWeight: 700, padding: '7px 12px' }}
              defaultValue={r.name}
              key={`n-${r.staffId}-${r.name}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== r.name) void apiPatchStaff(shopId, r.staffId, { name: v }).then(() => onChanged('💾 ' + t('team_saved')));
              }}
            />
            <input
              className="input"
              style={{ marginTop: 5, padding: '6px 12px', fontSize: '0.8rem' }}
              defaultValue={r.role[lang]}
              key={`r-${r.staffId}-${r.role.en}`}
              placeholder={t('team_role')}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== r.role[lang]) {
                  void apiPatchStaff(shopId, r.staffId, { role: { en: v, de: v } }).then(() => onChanged('💾 ' + t('team_saved')));
                }
              }}
            />
          </div>
          <label className="chip">
            {t('team_tier')}
            <select
              value={r.tier}
              onChange={(e) => void apiPatchStaff(shopId, r.staffId, { tier: e.target.value as 'senior' | 'stylist' }).then(() => onChanged('💾 ' + t('team_saved')))}
            >
              <option value="senior">{t('team_senior')}</option>
              <option value="stylist">{t('team_stylist')}</option>
            </select>
          </label>
          <label className="chip">
            📍
            <select
              value={r.locationId ?? ''}
              onChange={(e) => void apiPatchStaff(shopId, r.staffId, { locationId: e.target.value || undefined }).then(() => onChanged('💾 ' + t('team_saved')))}
            >
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-soft sm" onClick={() => setEditing(editing === r.staffId ? null : r.staffId)}>
            🕘 {t('team_hours')}
          </button>
          <button
            className="btn btn-ghost sm"
            style={{ color: 'var(--danger)' }}
            onClick={() =>
              ask({
                title: t('del_staff_title', { name: r.name }),
                body: t('del_staff_body'),
                consequences: [t('del_staff_c1'), t('del_staff_c2')],
                typeToConfirm: r.name,
                confirmLabel: t('del_staff_confirm'),
                run: () =>
                  apiArchiveStaff(shopId, r.staffId).then((ok) => {
                    if (ok) onChanged('🗑 ' + t('team_removed'));
                    else setErr(t('team_last'));
                  }),
              })
            }
          >
            {t('team_remove')}
          </button>
          {editing === r.staffId && (
            <div className="team-hours">
              {WEEK.map((d) => {
                const shift = r.shifts[d]?.[0];
                const dayName = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short' }).format(
                  new Date(Date.UTC(2024, 0, d)),
                );
                return (
                  <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <span style={{ width: 40, fontWeight: 700, fontSize: '0.8rem' }}>{dayName}</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={Boolean(shift)}
                        onChange={(e) => {
                          const shifts = { ...r.shifts };
                          if (e.target.checked) shifts[d] = [{ startMin: 9 * 60, endMin: 18 * 60 }];
                          else delete shifts[d];
                          void apiPatchStaff(shopId, r.staffId, { shifts }).then(() => onChanged('💾 ' + t('team_saved')));
                        }}
                      />
                      <span className="knob" />
                    </label>
                    {shift ? (
                      <>
                        <input
                          className="input"
                          style={{ width: 108, padding: '6px 10px' }}
                          type="time"
                          defaultValue={hhmm(shift.startMin)}
                          key={`s-${r.staffId}-${d}-${shift.startMin}`}
                          onBlur={(e) => {
                            const shifts = { ...r.shifts, [d]: [{ startMin: toMin(e.target.value), endMin: shift.endMin }] };
                            void apiPatchStaff(shopId, r.staffId, { shifts }).then(() => onChanged('💾 ' + t('team_saved')));
                          }}
                        />
                        –
                        <input
                          className="input"
                          style={{ width: 108, padding: '6px 10px' }}
                          type="time"
                          defaultValue={hhmm(shift.endMin)}
                          key={`e-${r.staffId}-${d}-${shift.endMin}`}
                          onBlur={(e) => {
                            const shifts = { ...r.shifts, [d]: [{ startMin: shift.startMin, endMin: toMin(e.target.value) }] };
                            void apiPatchStaff(shopId, r.staffId, { shifts }).then(() => onChanged('💾 ' + t('team_saved')));
                          }}
                        />
                      </>
                    ) : (
                      <span style={{ color: 'var(--ink-soft)', fontSize: '0.82rem' }}>{t('p_closed')}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder={`${t('team_name')} *`} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder={t('team_role')} value={role} onChange={(e) => setRole(e.target.value)} />
          <label className="chip">
            {t('team_tier')}
            <select value={tier} onChange={(e) => setTier(e.target.value as 'senior' | 'stylist')}>
              <option value="stylist">{t('team_stylist')}</option>
              <option value="senior">{t('team_senior')}</option>
            </select>
          </label>
          <label className="chip">
            📍
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-ghost sm" onClick={() => setAdding(false)}>✕</button>
          <button
            className="btn btn-primary sm"
            disabled={!name.trim()}
            onClick={() => {
              void apiAddStaff(shopId, {
                name: name.trim(),
                role: role.trim() || 'Stylist',
                tier,
                locationId: locationId || undefined,
              }).then(() => {
                setName('');
                setRole('');
                setAdding(false);
                onChanged('✅ ' + t('team_added'));
              });
            }}
          >
            {t('team_add')}
          </button>
        </div>
      ) : (
        <button className="btn btn-soft sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          {t('team_add')}
        </button>
      )}
    </div>
  );
}

function LocationManager({
  shopId,
  locations,
  onChanged,
}: {
  shopId: string;
  locations: Overview['shop']['locations'];
  onChanged: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', street: '', zip: '', city: 'Berlin', district: '' });
  const [err, setErr] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  return (
    <div className="panel">
      {dialog}
      {err && <div className="alert" style={{ marginBottom: 10 }}>{err}</div>}
      {locations.map((l) => (
        <div key={l.id} className="loc-row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 150, fontWeight: 700 }}
            defaultValue={l.label}
            key={`l-${l.id}-${l.label}`}
            placeholder={t('loc_label')}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== l.label) void apiPatchLocation(shopId, l.id, { label: v }).then(() => onChanged('💾 ' + t('team_saved')));
            }}
          />
          <input
            className="input"
            style={{ flex: 2, minWidth: 170 }}
            defaultValue={l.street}
            key={`s-${l.id}-${l.street}`}
            placeholder={t('loc_street')}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== l.street) void apiPatchLocation(shopId, l.id, { street: v }).then(() => onChanged('💾 ' + t('team_saved')));
            }}
          />
          <input
            className="input"
            style={{ width: 100 }}
            defaultValue={l.zip}
            key={`z-${l.id}-${l.zip}`}
            placeholder={t('loc_zip')}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== l.zip) void apiPatchLocation(shopId, l.id, { zip: v }).then(() => onChanged('💾 ' + t('team_saved')));
            }}
          />
          <input
            className="input"
            style={{ width: 140 }}
            defaultValue={l.city}
            key={`c-${l.id}-${l.city}`}
            placeholder={t('loc_city')}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== l.city) void apiPatchLocation(shopId, l.id, { city: v }).then(() => onChanged('💾 ' + t('team_saved')));
            }}
          />
          <button
            className="btn btn-ghost sm"
            style={{ color: 'var(--danger)' }}
            onClick={() =>
              ask({
                title: t('del_loc_title', { name: l.label }),
                body: t('del_loc_body'),
                typeToConfirm: l.label,
                confirmLabel: t('del_loc_confirm'),
                run: () =>
                  apiDeleteLocation(shopId, l.id).then((ok) => {
                    if (ok) onChanged('🗑 ' + t('loc_removed'));
                    else setErr(t('loc_last'));
                  }),
              })
            }
          >
            ✕
          </button>
        </div>
      ))}

      {adding ? (
        <div className="loc-row" style={{ marginTop: 10 }}>
          <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder={`${t('loc_label')} *`} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <input className="input" style={{ flex: 2, minWidth: 160 }} placeholder={`${t('loc_street')} *`} value={draft.street} onChange={(e) => setDraft({ ...draft, street: e.target.value })} />
          <input className="input" style={{ width: 100 }} placeholder={t('loc_zip')} value={draft.zip} onChange={(e) => setDraft({ ...draft, zip: e.target.value })} />
          <input className="input" style={{ width: 140 }} placeholder={`${t('loc_city')} *`} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
          <button className="btn btn-ghost sm" onClick={() => setAdding(false)}>✕</button>
          <button
            className="btn btn-primary sm"
            disabled={!draft.label.trim() || !draft.street.trim() || !draft.city.trim()}
            onClick={() => {
              void apiAddLocation(shopId, draft).then(() => {
                setDraft({ label: '', street: '', zip: '', city: draft.city, district: '' });
                setAdding(false);
                onChanged('✅ ' + t('loc_added'));
              });
            }}
          >
            {t('loc_add')}
          </button>
        </div>
      ) : (
        <button className="btn btn-soft sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          {t('loc_add')}
        </button>
      )}
    </div>
  );
}
