'use client';
/**
 * My day — the first screen in this product built for the person doing the
 * work rather than the person who owns the shop.
 *
 * A stylist does not want the shop dashboard: they want their own chair, in
 * order, with the next customer at the top and the things they were told about
 * that customer visible before they walk in. Then, because people care how
 * their week is going: their own hours, bookings and takings.
 *
 * They pick their name once and the choice is remembered, so this is a
 * bookmarkable "my shift" page.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, timeOf, weekdayShort, dayNum, monthShort } from '@/lib/format';
import { StaffWeekGrid } from '@/components/StaffWeekGrid';
import { apiOverview, apiHrOverview, apiSetStatus, apiSetCustomerNote, type HrRow } from '@/lib/api';
import { todayIso, addDays } from '@/core/time';
import type { Overview } from '../dashboard/shell';

const PICK_KEY = 'stylenow.myday.staff';

export function MyDay({ shops }: { shops: Array<{ id: string; name: string; emoji: string }> }) {
  const { t, lang } = useI18n();
  const [shopId, setShopId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<Overview | null>(null);
  const [hr, setHr] = useState<HrRow | null>(null);
  const [restored, setRestored] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(todayIso(), i)), []);

  // Remember who you are; nobody wants to pick themselves off a list daily.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PICK_KEY) ?? 'null');
      if (saved?.shopId && saved?.staffId) {
        setShopId(saved.shopId);
        setStaffId(saved.staffId);
      }
    } catch {
      // private mode — you just pick again
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored || !shopId) return;
    try {
      window.localStorage.setItem(PICK_KEY, JSON.stringify({ shopId, staffId }));
    } catch {
      // ignore
    }
  }, [restored, shopId, staffId]);

  const load = useCallback(() => {
    if (!shopId) {
      setData(null);
      return;
    }
    void apiOverview(shopId, date).then((o) => setData(o as Overview | null));
  }, [shopId, date]);

  useEffect(() => {
    load();
  }, [load]);

  // This week's own numbers, Monday to Sunday.
  useEffect(() => {
    if (!shopId || !staffId) {
      setHr(null);
      return;
    }
    const today = todayIso();
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
    const monday = addDays(today, 1 - dow);
    void apiHrOverview(shopId, monday, addDays(monday, 6)).then((rows) =>
      setHr(rows.find((r) => r.staffId === staffId) ?? null),
    );
  }, [shopId, staffId]);

  const me = data?.staffRows.find((r) => r.staffId === staffId) ?? null;
  const myBookings = (data?.bookings ?? [])
    .filter((b) => b.staffId === staffId && !b.status.startsWith('cancelled'))
    .sort((a, b) => a.startsAt - b.startsAt);
  const now = Date.now();
  const nextIdx = myBookings.findIndex((b) => b.startsAt > now);
  const workingMin = (me?.working ?? []).reduce((sum, w) => sum + (w.end - w.start) / 60_000, 0);
  const hours = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} m` : ''}`;

  if (!restored) return <div className="spinner" />;

  return (
    <div>
      <div className="page-title">
        <h1>🪄 {t('md_title')}</h1>
        <label className="chip">
          🏪
          <select
            value={shopId}
            onChange={(e) => {
              setShopId(e.target.value);
              setStaffId('');
            }}
          >
            <option value="">{t('md_pick_shop')}</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.emoji} {s.name}
              </option>
            ))}
          </select>
        </label>
        {data && (
          <label className="chip">
            👤
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">{t('md_pick_me')}</option>
              {data.staffRows.map((r) => (
                <option key={r.staffId} value={r.staffId}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!shopId || !staffId ? (
        <div className="empty">
          <div className="big">🪄</div>
          <h3 style={{ marginBottom: 6 }}>{t('md_choose_title')}</h3>
          <p>{t('md_choose_body')}</p>
        </div>
      ) : (
        <>
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
                  <div className="lbl">{t('md_appointments')}</div>
                  <div className="val">{myBookings.length}</div>
                </div>
                <div className="stat-tile">
                  <div className="lbl">{t('md_on_chair')}</div>
                  <div className="val">{workingMin ? hours(workingMin) : '—'}</div>
                </div>
                <div className="stat-tile">
                  <div className="lbl">{t('md_week_hours')}</div>
                  <div className="val">{hr ? hours(hr.bookedMin) : '—'}</div>
                </div>
                <div className="stat-tile">
                  <div className="lbl">{t('md_week_util')}</div>
                  <div className="val">{hr ? `${hr.utilisationPct} %` : '—'}</div>
                  {hr && (
                    <div className="bar">
                      <div style={{ width: `${Math.min(hr.utilisationPct, 100)}%` }} />
                    </div>
                  )}
                </div>
              </div>

              <section className="section">
                <h2>{t('md_schedule')}</h2>
                {workingMin === 0 ? (
                  <div className="empty">
                    <div className="big">🌴</div>
                    <p>{t('md_off_today')}</p>
                  </div>
                ) : myBookings.length === 0 ? (
                  <div className="empty">
                    <div className="big">☕</div>
                    <p>{t('md_free_day')}</p>
                  </div>
                ) : (
                  <div className="md-list">
                    {myBookings.map((b, i) => {
                      const done = b.startsAt <= now;
                      return (
                        <div key={b.id} className={`md-row ${i === nextIdx ? 'next' : ''} ${done ? 'done' : ''}`}>
                          <div className="md-time">
                            <strong>{timeOf(b.startsAt, lang)}</strong>
                            {i === nextIdx && <span className="md-badge">{t('md_next')}</span>}
                          </div>
                          <div className="md-body">
                            <div className="md-who">{b.guestName}</div>
                            <div className="md-what">{b.serviceNames.join(', ')}</div>
                            {b.guestNote && <div className="md-note">💬 {b.guestNote}</div>}
                          </div>
                          <div className="md-side">
                            <span className={`st-badge st-${b.status}`}>{t(`st_${b.status}` as MsgKey)}</span>
                            <span style={{ fontWeight: 800 }}>{money(b.totalCents, lang)}</span>
                            {b.guestPhone && (
                              <a className="bk-phone" href={`tel:${b.guestPhone.replace(/\s/g, '')}`}>
                                📞 {b.guestPhone}
                              </a>
                            )}
                            {b.status === 'confirmed' && (
                              <div className="md-acts">
                                <button
                                  className="btn btn-soft sm"
                                  onClick={() => {
                                    void apiSetStatus(shopId, b.id, 'completed').then(load);
                                  }}
                                >
                                  ✓ {t('mark_completed')}
                                </button>
                                <button
                                  className="btn btn-ghost sm"
                                  onClick={() => {
                                    void apiSetStatus(shopId, b.id, 'no_show').then(load);
                                  }}
                                >
                                  {t('mark_no_show')}
                                </button>
                              </div>
                            )}
                          </div>

                          {/* What you learn at the chair is worth more than what
                              the booking form captured — and it belongs in the
                              customer's record, not in your head. */}
                          <label className="md-jot">
                            <span>🔒 {t('cus_private_note')}</span>
                            <input
                              className="input"
                              placeholder={t('md_jot_ph')}
                              defaultValue=""
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (!v) return;
                                void apiSetCustomerNote(shopId, b.customerKey, v).then(() => {
                                  e.target.value = '';
                                  setSaved(b.id);
                                  setTimeout(() => setSaved(null), 2200);
                                });
                              }}
                            />
                            {saved === b.id && <em>{t('md_jot_saved')}</em>}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {staffId && (
                <section className="section">
                  <h2>{t('sw_my_title')}</h2>
                  <div className="panel" style={{ padding: 14 }}>
                    <StaffWeekGrid shopId={shopId} staffId={staffId} />
                  </div>
                </section>
              )}

              {hr && (
                <section className="section">
                  <h2>{t('md_my_week')}</h2>
                  <div className="panel md-week">
                    <div>
                      <span className="k">{t('hr_booked')}</span>
                      <span className="v">{hr.bookingCount}</span>
                    </div>
                    <div>
                      <span className="k">{t('hr_scheduled')}</span>
                      <span className="v">{hours(hr.scheduledMin)}</span>
                    </div>
                    <div>
                      <span className="k">{t('hr_revenue')}</span>
                      <span className="v">{money(hr.revenueCents, lang)}</span>
                    </div>
                    <div>
                      <span className="k">{t('hr_absent')}</span>
                      <span className="v">{hr.absentDays}</span>
                    </div>
                  </div>
                  {hr.absences.length > 0 && (
                    <div className="panel" style={{ marginTop: 12 }}>
                      <strong style={{ fontSize: '0.82rem' }}>🌴 {t('hr_absences')}</strong>
                      {hr.absences.map((a) => (
                        <div key={a.id} className="hr-abs">
                          <span className="st-badge st-completed">{t(`hr_${a.kind}` as MsgKey)}</span>
                          <span style={{ fontSize: '0.82rem' }}>
                            {a.from} → {a.to}
                            {a.note ? ` · ${a.note}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', marginTop: 10 }}>
                    💡 {t('md_hint')} <Link href="/dashboard/hr" style={{ fontWeight: 700 }}>{t('tab_hr')} →</Link>
                  </p>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
