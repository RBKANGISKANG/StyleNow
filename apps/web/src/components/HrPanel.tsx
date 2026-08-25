'use client';
/**
 * HR overview for one shop: per-employee contract data, rostered vs booked
 * hours, utilisation, revenue and absences. Absences feed straight back into
 * availability — the days they cover disappear from every booking surface.
 *
 * Lives on its own page (/dashboard/hr) rather than in the dashboard scroll:
 * this is a lot of detail and it is read at a different moment than the day's
 * calendar.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money } from '@/lib/format';
import { todayIso, addDays } from '@/core/time';
import {
  apiHrOverview,
  apiAddAbsence,
  apiDeleteAbsence,
  apiPatchStaff,
  type HrRow,
  type AbsenceKind,
} from '@/lib/api';
import { useConfirm } from './ConfirmDialog';

const ABSENCE_KINDS: AbsenceKind[] = ['vacation', 'sick', 'training', 'other'];

export type HrPeriod = 'week' | 'month' | 'next30';

export function HrPanel({
  shopId,
  locations,
  onChanged,
}: {
  shopId: string;
  locations: Array<{ id: string; label: string }>;
  onChanged: (msg: string) => void;
}) {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState<HrPeriod>('week');
  const [rows, setRows] = useState<HrRow[] | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  const [draft, setDraft] = useState<{ from: string; to: string; kind: AbsenceKind; note: string }>({
    from: todayIso(),
    to: todayIso(),
    kind: 'vacation',
    note: '',
  });

  const range = useMemo(() => {
    const today = todayIso();
    if (period === 'next30') return { from: today, to: addDays(today, 29) };
    if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: addDays(`${today.slice(0, 8)}01`, 30) };
    // this week: Monday → Sunday
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
    const monday = addDays(today, 1 - dow);
    return { from: monday, to: addDays(monday, 6) };
  }, [period]);

  const load = useCallback(() => {
    if (!shopId) return;
    void apiHrOverview(shopId, range.from, range.to).then(setRows);
  }, [shopId, range.from, range.to]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  const hours = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} m` : ''}`;
  const kindLabel = (k: AbsenceKind) => t(`hr_${k}` as MsgKey);

  return (
    <div className="panel">
      {dialog}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="seg">
          {(['week', 'month', 'next30'] as const).map((p) => (
            <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>
              {p === 'week' ? t('hr_this_week') : p === 'month' ? t('hr_this_month') : t('hr_next_month')}
            </button>
          ))}
        </div>
        <span style={{ fontSize: '0.76rem', color: 'var(--ink-soft)' }}>
          {range.from} → {range.to}
        </span>
      </div>
      <p style={{ fontSize: '0.76rem', color: 'var(--ink-soft)', marginBottom: 10 }}>💡 {t('hr_hint')}</p>

      <details className="hr-how">
        <summary>{t('hr_how_title')}</summary>
        <ol>
          {(['hr_how_1', 'hr_how_2', 'hr_how_3', 'hr_how_4', 'hr_how_5', 'hr_how_6'] as const).map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ol>
      </details>

      {rows === null ? (
        <div className="spinner" />
      ) : (
        rows.map((r) => (
          <div key={r.staffId} className="hr-card">
            <div className="hr-head">
              <div className="avatar" style={{ background: 'var(--teal)', margin: 0, width: 40, height: 40, fontSize: '1rem' }}>
                {r.name[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ fontWeight: 800 }}>{r.name}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
                  {r.role[lang]} · {r.tier === 'senior' ? t('team_senior') : t('team_stylist')}
                  {r.locationId && ` · 📍 ${locations.find((l) => l.id === r.locationId)?.label ?? ''}`}
                </div>
              </div>
              <div className="hr-kpis">
                <div className="hr-kpi">
                  <span className="k">{t('hr_scheduled')}</span>
                  <span className="v">{hours(r.scheduledMin)}</span>
                </div>
                <div className="hr-kpi">
                  <span className="k">{t('hr_booked')}</span>
                  <span className="v">{hours(r.bookedMin)}</span>
                </div>
                <div className="hr-kpi">
                  <span className="k">{t('hr_util')}</span>
                  <span className="v">{r.utilisationPct} %</span>
                </div>
                <div className="hr-kpi">
                  <span className="k">{t('hr_revenue')}</span>
                  <span className="v">{money(r.revenueCents, lang)}</span>
                </div>
                <div className="hr-kpi">
                  <span className="k">{t('hr_absent')}</span>
                  <span className="v">{r.absentDays}</span>
                </div>
              </div>
            </div>

            <div className="hr-bar">
              <div style={{ width: `${Math.min(r.utilisationPct, 100)}%` }} />
            </div>

            <div className="hr-fields">
              <label>
                <span>{t('hr_contact')}</span>
                <input
                  className="input"
                  defaultValue={r.email}
                  key={`e-${r.staffId}-${r.email}`}
                  placeholder="email@salon.de"
                  onBlur={(e) => {
                    if (e.target.value.trim() !== r.email) {
                      void apiPatchStaff(shopId, r.staffId, { email: e.target.value.trim() }).then(() => onChanged('💾 ' + t('team_saved')));
                    }
                  }}
                />
              </label>
              <label>
                <span>&nbsp;</span>
                <input
                  className="input"
                  defaultValue={r.phone}
                  key={`p-${r.staffId}-${r.phone}`}
                  placeholder="+49 …"
                  onBlur={(e) => {
                    if (e.target.value.trim() !== r.phone) {
                      void apiPatchStaff(shopId, r.staffId, { phone: e.target.value.trim() }).then(() => onChanged('💾 ' + t('team_saved')));
                    }
                  }}
                />
              </label>
              <label>
                <span>{t('hr_since')}</span>
                <input
                  className="input"
                  type="date"
                  defaultValue={r.employedSince}
                  key={`d-${r.staffId}-${r.employedSince}`}
                  onBlur={(e) => {
                    if (e.target.value !== r.employedSince) {
                      void apiPatchStaff(shopId, r.staffId, { employedSince: e.target.value }).then(() => onChanged('💾 ' + t('team_saved')));
                    }
                  }}
                />
              </label>
              <label>
                <span>{t('hr_weekly')}</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={60}
                  defaultValue={r.weeklyHours || ''}
                  key={`w-${r.staffId}-${r.weeklyHours}`}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== r.weeklyHours) {
                      void apiPatchStaff(shopId, r.staffId, { weeklyHours: v }).then(() => onChanged('💾 ' + t('team_saved')));
                    }
                  }}
                />
              </label>
              <label style={{ flexBasis: '100%' }}>
                <span>{t('hr_note')}</span>
                <input
                  className="input"
                  defaultValue={r.notes}
                  key={`n-${r.staffId}-${r.notes}`}
                  onBlur={(e) => {
                    if (e.target.value !== r.notes) {
                      void apiPatchStaff(shopId, r.staffId, { notes: e.target.value }).then(() => onChanged('💾 ' + t('team_saved')));
                    }
                  }}
                />
              </label>
            </div>

            <div style={{ marginTop: 10 }}>
              <strong style={{ fontSize: '0.82rem' }}>🌴 {t('hr_absences')}</strong>
              {r.absences.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '4px 0' }}>{t('hr_none')}</p>
              ) : (
                r.absences.map((a) => (
                  <div key={a.id} className="hr-abs">
                    <span className={`st-badge ${a.kind === 'sick' ? 'st-no_show' : 'st-completed'}`}>{kindLabel(a.kind)}</span>
                    <span style={{ fontSize: '0.82rem' }}>
                      {a.from} → {a.to}
                      {a.note ? ` · ${a.note}` : ''}
                    </span>
                    <button
                      className="btn btn-ghost sm"
                      style={{ color: 'var(--danger)', marginLeft: 'auto' }}
                      onClick={() =>
                        ask({
                          title: t('del_abs_title'),
                          body: t('del_abs_body'),
                          consequences: [`${r.name} · ${kindLabel(a.kind)} · ${a.from} → ${a.to}`],
                          confirmLabel: t('del_abs_confirm'),
                          run: () =>
                            apiDeleteAbsence(shopId, r.staffId, a.id).then(() => {
                              load();
                              onChanged('🗑 ' + t('hr_absence_removed'));
                            }),
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}

              {openFor === r.staffId ? (
                <div className="hr-abs-form">
                  <label className="chip">
                    {t('hr_kind')}
                    <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AbsenceKind })}>
                      {ABSENCE_KINDS.map((k) => (
                        <option key={k} value={k}>{kindLabel(k)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="chip">
                    {t('hr_from')}
                    <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} style={{ border: 'none', background: 'transparent', outline: 'none', fontWeight: 600 }} />
                  </label>
                  <label className="chip">
                    {t('hr_to')}
                    <input type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} style={{ border: 'none', background: 'transparent', outline: 'none', fontWeight: 600 }} />
                  </label>
                  <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder={t('hr_note')} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                  <button className="btn btn-ghost sm" onClick={() => setOpenFor(null)}>✕</button>
                  <button
                    className="btn btn-primary sm"
                    onClick={() => {
                      void apiAddAbsence(shopId, r.staffId, {
                        from: draft.from,
                        to: draft.to < draft.from ? draft.from : draft.to,
                        kind: draft.kind,
                        note: draft.note.trim() || undefined,
                      }).then(() => {
                        setOpenFor(null);
                        setDraft({ from: todayIso(), to: todayIso(), kind: 'vacation', note: '' });
                        load();
                        onChanged('✅ ' + t('hr_absence_added'));
                      });
                    }}
                  >
                    {t('hr_save_absence')}
                  </button>
                </div>
              ) : (
                <button className="btn btn-soft sm" style={{ marginTop: 6 }} onClick={() => setOpenFor(r.staffId)}>
                  {t('hr_add_absence')}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
