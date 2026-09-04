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
  apiApproveAbsence,
  apiDeleteAbsence,
  apiPatchStaff,
  type HrRow,
  type AbsenceKind,
} from '@/lib/api';
import { useConfirm } from './ConfirmDialog';
import { Modal } from './Modal';
import { ConflictGuard } from './ConflictGuard';

const ABSENCE_KINDS: AbsenceKind[] = ['vacation', 'sick', 'training', 'other'];

export type HrPeriod = 'week' | 'month' | 'next30' | 'custom';

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
  // "the data from two given dates" — any from→to the manager types
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(addDays(todayIso(), 13));
  const [rows, setRows] = useState<HrRow[] | null>(null);
  const [editFor, setEditFor] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  const range = useMemo(() => {
    const today = todayIso();
    if (period === 'custom') {
      return { from: customFrom, to: customTo < customFrom ? customFrom : customTo };
    }
    if (period === 'next30') return { from: today, to: addDays(today, 29) };
    if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: addDays(`${today.slice(0, 8)}01`, 30) };
    // this week: Monday → Sunday
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
    const monday = addDays(today, 1 - dow);
    return { from: monday, to: addDays(monday, 6) };
  }, [period, customFrom, customTo]);

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
          {(['week', 'month', 'next30', 'custom'] as const).map((p) => (
            <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>
              {p === 'week' ? t('hr_this_week') : p === 'month' ? t('hr_this_month') : p === 'next30' ? t('hr_next_month') : t('hr_custom')}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <>
            <input type="date" className="input" style={{ width: 'auto' }} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span aria-hidden>→</span>
            <input type="date" className="input" style={{ width: 'auto' }} value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
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
              <button className="btn btn-soft sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEditFor(r.staffId)}>
                ✏️ {t('hr_edit')}
              </button>
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

            <div style={{ marginTop: 10 }}>
              <strong style={{ fontSize: '0.82rem' }}>🌴 {t('hr_absences')}</strong>
              {r.absences.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '4px 0' }}>{t('hr_none')}</p>
              ) : (
                r.absences.map((a) => (
                  <div key={a.id}>
                  <div className={`hr-abs${a.status === 'pending' ? ' pending' : ''}`}>
                    <span className={`st-badge ${a.kind === 'sick' ? 'st-no_show' : 'st-completed'}`}>{kindLabel(a.kind)}</span>
                    <span style={{ fontSize: '0.82rem' }}>
                      {a.from} → {a.to}
                      {a.note ? ` · ${a.note}` : ''}
                    </span>
                    {/* An employee asked from My Day; nothing is blocked until
                        somebody here says yes. Decline is the ✕ next door. */}
                    {a.status === 'pending' && (
                      <>
                        <span className="st-badge st-pending_payment">{t('hr_requested')}</span>
                        <button
                          className="btn btn-primary sm"
                          onClick={() =>
                            void apiApproveAbsence(shopId, r.staffId, a.id).then(() => {
                              load();
                              onChanged('✅ ' + t('hr_approved'));
                            })
                          }
                        >
                          {t('hr_approve')}
                        </button>
                      </>
                    )}
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
                  {/* Whatever was already booked into these days needs a plan —
                      shown for the request BEFORE approving, so the manager
                      sees the cost of the yes, and kept for approved leave
                      until every affected visit is resolved. */}
                  {a.to >= todayIso() && (
                    <ConflictGuard
                      shopId={shopId}
                      staffId={r.staffId}
                      from={a.from}
                      to={a.to}
                      onChanged={(msg) => {
                        load();
                        onChanged(msg);
                      }}
                    />
                  )}
                  </div>
                ))
              )}

            </div>
          </div>
        ))
      )}

      <HrEditDialog
        shopId={shopId}
        row={(rows ?? []).find((r) => r.staffId === editFor) ?? null}
        onClose={() => setEditFor(null)}
        onSaved={(msg) => {
          load();
          onChanged(msg);
        }}
      />
    </div>
  );
}

/**
 * One person's HR record in one popup: contact, contract and a new absence —
 * instead of a card whose every field was a live input.
 */
function HrEditDialog({
  shopId,
  row,
  onClose,
  onSaved,
}: {
  shopId: string;
  row: HrRow | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [since, setSince] = useState('');
  const [weekly, setWeekly] = useState('');
  const [notes, setNotes] = useState('');
  const [abs, setAbs] = useState<{ from: string; to: string; kind: AbsenceKind; note: string }>({
    from: todayIso(),
    to: todayIso(),
    kind: 'vacation',
    note: '',
  });

  useEffect(() => {
    if (!row) return;
    setEmail(row.email);
    setPhone(row.phone);
    setSince(row.employedSince);
    setWeekly(row.weeklyHours ? String(row.weeklyHours) : '');
    setNotes(row.notes);
    setAbs({ from: todayIso(), to: todayIso(), kind: 'vacation', note: '' });
  }, [row]);

  if (!row) return null;
  const kindLabel = (k: AbsenceKind) => t(`hr_${k}` as MsgKey);

  return (
    <Modal
      open
      title={`✏️ ${row.name}`}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
          <button className="btn btn-ghost sm" onClick={onClose}>{t('rc_close')}</button>
          <button
            className="btn btn-primary sm"
            onClick={() =>
              void apiPatchStaff(shopId, row.staffId, {
                email: email.trim(),
                phone: phone.trim(),
                employedSince: since,
                weeklyHours: Number(weekly) || 0,
                notes,
              }).then(() => {
                onSaved('💾 ' + t('team_saved'));
                onClose();
              })
            }
          >
            {t('acc_save')}
          </button>
        </div>
      }
    >
      <div className="sd-grid">
        <label>
          <span>{t('hr_contact')}</span>
          <input className="input" value={email} placeholder="email@salon.de" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <span>&nbsp;</span>
          <input className="input" value={phone} placeholder="+49 …" onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          <span>{t('hr_since')}</span>
          <input className="input" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label>
          <span>{t('hr_weekly')}</span>
          <input className="input" type="number" min={0} max={60} value={weekly} onChange={(e) => setWeekly(e.target.value)} />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>{t('hr_note')}</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <div style={{ marginTop: 14 }}>
        <strong style={{ fontSize: '0.85rem' }}>🌴 {t('hr_add_absence')}</strong>
        <div className="hr-abs-form" style={{ marginTop: 6 }}>
          <label className="chip">
            {t('hr_kind')}
            <select value={abs.kind} onChange={(e) => setAbs({ ...abs, kind: e.target.value as AbsenceKind })}>
              {ABSENCE_KINDS.map((k) => (
                <option key={k} value={k}>{kindLabel(k)}</option>
              ))}
            </select>
          </label>
          <label className="chip">
            {t('hr_from')}
            <input type="date" value={abs.from} onChange={(e) => setAbs({ ...abs, from: e.target.value })} style={{ border: 'none', background: 'transparent', outline: 'none', fontWeight: 600 }} />
          </label>
          <label className="chip">
            {t('hr_to')}
            <input type="date" value={abs.to} min={abs.from} onChange={(e) => setAbs({ ...abs, to: e.target.value })} style={{ border: 'none', background: 'transparent', outline: 'none', fontWeight: 600 }} />
          </label>
          <input className="input" style={{ flex: 1, minWidth: 130 }} placeholder={t('hr_note')} value={abs.note} onChange={(e) => setAbs({ ...abs, note: e.target.value })} />
          <button
            className="btn btn-primary sm"
            onClick={() => {
              void apiAddAbsence(shopId, row.staffId, {
                from: abs.from,
                to: abs.to < abs.from ? abs.from : abs.to,
                kind: abs.kind,
                note: abs.note.trim() || undefined,
              }).then(() => {
                onSaved('✅ ' + t('hr_absence_added'));
                onClose();
              });
            }}
          >
            {t('hr_save_absence')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
