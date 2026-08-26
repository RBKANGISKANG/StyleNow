'use client';
/**
 * The team's plan as a grid — one row per person, one column per day.
 *
 * The per-employee cards answer "when is Lena away". This answers the question
 * a shop actually asks: "who is covering Thursday". You cannot see that by
 * reading cards one after another, which is why the same data needs both
 * shapes.
 *
 * Colour is never the only signal: every state also carries a letter (H/S/T/A)
 * and a title, so the grid survives colour blindness and a mono printout.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { apiRoster, apiAddAbsence, apiDeleteAbsence, type RosterCalendar as Roster, type AbsenceKind } from '@/lib/api';
import { useConfirm } from './ConfirmDialog';
import { todayIso, addDays } from '@/core/time';

const KINDS: AbsenceKind[] = ['vacation', 'sick', 'training', 'other'];
const KIND_LETTER: Record<AbsenceKind, string> = { vacation: 'H', sick: 'S', training: 'T', other: 'A' };

export function RosterCalendarView({
  shopId,
  from,
  to,
  onChanged,
}: {
  shopId: string;
  from: string;
  to: string;
  onChanged: (msg: string) => void;
}) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<Roster | null>(null);
  // The cell you clicked, waiting for a kind and an end date.
  const [draft, setDraft] = useState<{ staffId: string; name: string; from: string; to: string } | null>(null);
  const [kind, setKind] = useState<AbsenceKind>('vacation');
  const [note, setNote] = useState('');
  const { ask, dialog } = useConfirm();

  const load = useCallback(() => {
    if (!shopId) return;
    void apiRoster(shopId, from, to).then(setData);
  }, [shopId, from, to]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const today = todayIso();
  const dayLabel = useMemo(
    () => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'narrow', timeZone: 'UTC' }),
    [lang],
  );
  const kindLabel = (k: AbsenceKind) => t(`hr_${k}` as MsgKey);

  if (data === null) return <div className="spinner" />;
  if (data.rows.length === 0) return <p style={{ color: 'var(--ink-soft)' }}>{t('team_last')}</p>;

  const isWeekend = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
    return d === 0 || d === 6;
  };

  return (
    <div className="panel">
      {dialog}
      <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginBottom: 10 }}>💡 {t('rc_hint')}</p>

      <div className="rc-wrap">
        <div className="rc-grid" style={{ gridTemplateColumns: `minmax(120px, 168px) repeat(${data.dates.length}, minmax(30px, 1fr))` }}>
          {/* header: the dates */}
          <div className="rc-corner">{t('team_title')}</div>
          {data.dates.map((iso) => (
            <div
              key={iso}
              className={`rc-head ${iso === today ? 'today' : ''} ${isWeekend(iso) ? 'weekend' : ''}`}
              title={iso}
            >
              <span className="dow">{dayLabel.format(new Date(`${iso}T12:00:00Z`))}</span>
              <span className="num">{Number(iso.slice(8, 10))}</span>
            </div>
          ))}

          {/* one row per person */}
          {data.rows.map((r) => (
            <span key={r.staffId} style={{ display: 'contents' }}>
              <div className="rc-name">
                <strong>{r.name}</strong>
                <span>
                  {r.workingDays} {t('rc_days')}
                  {r.absentDays > 0 && ` · ${r.absentDays} ${t('rc_away')}`}
                </span>
              </div>
              {r.days.map((d) => {
                const label =
                  d.state === 'closed'
                    ? t('cls_closed')
                    : d.state === 'absent'
                      ? `${kindLabel(d.kind ?? 'other')}${d.note ? ` · ${d.note}` : ''}`
                      : d.state === 'working'
                        ? `${Math.round(d.scheduledMin / 60)} h · ${d.bookingCount} ${t('rev_bookings')}`
                        : t('rc_off');
                return (
                  <button
                    key={d.iso}
                    className={`rc-cell ${d.state} ${d.kind ? `k-${d.kind}` : ''} ${d.iso === today ? 'today' : ''} ${isWeekend(d.iso) ? 'weekend' : ''}`}
                    title={`${r.name} · ${d.iso} · ${label}`}
                    aria-label={`${r.name} ${d.iso} ${label}`}
                    disabled={d.state === 'closed'}
                    onClick={() => {
                      if (d.state === 'absent' && d.absenceId) {
                        ask({
                          title: t('del_abs_title'),
                          body: t('del_abs_body'),
                          consequences: [`${r.name} · ${kindLabel(d.kind ?? 'other')} · ${d.iso}`],
                          confirmLabel: t('del_abs_confirm'),
                          run: () =>
                            apiDeleteAbsence(shopId, r.staffId, d.absenceId!).then(() => {
                              load();
                              onChanged('🗑 ' + t('hr_absence_removed'));
                            }),
                        });
                        return;
                      }
                      setDraft({ staffId: r.staffId, name: r.name, from: d.iso, to: d.iso });
                      setKind('vacation');
                      setNote('');
                    }}
                  >
                    {d.state === 'absent' ? (
                      <span className="mark">{KIND_LETTER[d.kind ?? 'other']}</span>
                    ) : d.state === 'working' ? (
                      <span className="load" style={{ height: `${Math.min(Math.round((d.bookedMin / Math.max(d.scheduledMin, 1)) * 100), 100)}%` }} />
                    ) : d.state === 'closed' ? (
                      <span className="mark">✕</span>
                    ) : null}
                  </button>
                );
              })}
            </span>
          ))}
        </div>
      </div>

      <div className="rc-legend">
        <span><i className="sw working" /> {t('rc_l_working')}</span>
        <span><i className="sw booked" /> {t('rc_l_booked')}</span>
        <span><i className="sw vacation" /> H — {t('hr_vacation')}</span>
        <span><i className="sw sick" /> S — {t('hr_sick')}</span>
        <span><i className="sw training" /> T — {t('hr_training')}</span>
        <span><i className="sw other" /> A — {t('hr_other')}</span>
        <span><i className="sw off" /> {t('rc_off')}</span>
        <span><i className="sw closed" /> {t('cls_closed')}</span>
      </div>

      {draft && (
        <div className="rc-draft">
          <strong>
            🌴 {draft.name} · {draft.from}
          </strong>
          <div className="hr-abs-form" style={{ marginTop: 8 }}>
            <label className="chip">
              {t('hr_kind')}
              <select value={kind} onChange={(e) => setKind(e.target.value as AbsenceKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </select>
            </label>
            <label className="chip">
              {t('hr_to')}
              <input
                type="date"
                value={draft.to}
                min={draft.from}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontWeight: 600 }}
              />
            </label>
            <input
              className="input"
              style={{ flex: 1, minWidth: 140 }}
              placeholder={t('hr_note')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={80}
            />
            <button className="btn btn-ghost sm" onClick={() => setDraft(null)}>
              ✕
            </button>
            <button
              className="btn btn-primary sm"
              onClick={() => {
                void apiAddAbsence(shopId, draft.staffId, {
                  from: draft.from,
                  to: draft.to < draft.from ? draft.from : draft.to,
                  kind,
                  note: note.trim() || undefined,
                }).then(() => {
                  setDraft(null);
                  load();
                  onChanged('✅ ' + t('hr_absence_added'));
                });
              }}
            >
              {t('hr_save_absence')}
            </button>
          </div>
        </div>
      )}

      {data.closures.length > 0 && (
        <p style={{ fontSize: '0.76rem', color: 'var(--ink-soft)', marginTop: 12 }}>
          🚫 {t('cls_title')}:{' '}
          {data.closures
            .map((c) => `${c.from}${c.to !== c.from ? `–${c.to}` : ''}${c.reason ? ` (${c.reason})` : ''}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

/** Helper for the default two-week window the HR tab opens on. */
export function defaultRosterRange(): { from: string; to: string } {
  const today = todayIso();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  const monday = addDays(today, 1 - dow);
  return { from: monday, to: addDays(monday, 13) };
}
