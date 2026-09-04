'use client';
/**
 * Team tab — who works here, at which branch, on which days. The working hours
 * set here are the first input to availability: everything else (absences,
 * bookings, buffers) only ever subtracts from them.
 */
import { Fragment, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Glyph } from '@/components/Icon';
import { usePaged, Pager } from '@/components/Pager';
import { apiAddStaff, apiPatchStaff, apiArchiveStaff } from '@/lib/api';
import { ConflictGuard } from '@/components/ConflictGuard';
import { useConfirm } from '@/components/ConfirmDialog';
import { Modal } from '@/components/Modal';
import { useToast } from '../toast';
import { OperatorShell, useOverview, type Overview } from '../shell';
import { StaffWeekGrid } from '@/components/StaffWeekGrid';
import type { ShopRef } from '@/lib/owned-shops';

export function TeamScreen({ shops }: { shops: ShopRef[] }) {
  return (
    <OperatorShell shops={shops} active="/dashboard/team">
      {({ shopId }) => <TeamTab shopId={shopId} />}
    </OperatorShell>
  );
}

function TeamTab({ shopId }: { shopId: string }) {
  const { t } = useI18n();
  const { data, reload } = useOverview(shopId);
  const { setToast, toastEl } = useToast();
  const [weekFor, setWeekFor] = useState<string | null>(null);

  // The picker follows the roster: when the shop changes, so does the team.
  useEffect(() => setWeekFor(null), [shopId]);

  if (data === null) return <div className="spinner" />;
  const chosen = weekFor ?? data.staffRows[0]?.staffId ?? null;

  return (
    <>
      <section className="section">
        <h2>
          <Glyph name="users" emoji="👥" size={20} /> {t('team_title')}
        </h2>
        <TeamManager
          shopId={shopId}
          rows={data.staffRows}
          locations={data.shop.locations}
          onChanged={(msg) => {
            setToast(msg);
            void reload();
          }}
        />
      </section>

      {/* One person's week, sold against rostered — the roster above says who
          is meant to be in; this says whether anybody is buying that time. */}
      {chosen && (
        <section className="section">
          <h2>{t('sw_title')}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {data.staffRows.map((r) => (
              <button
                key={r.staffId}
                className={`chip ${chosen === r.staffId ? 'on-primary' : ''}`}
                onClick={() => setWeekFor(r.staffId)}
              >
                {r.name}
              </button>
            ))}
          </div>
          <div className="panel" style={{ padding: 14 }}>
            <StaffWeekGrid shopId={shopId} staffId={chosen} />
          </div>
        </section>
      )}
      {toastEl}
    </>
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
  const [err, setErr] = useState<string | null>(null);
  // set when archiving failed because the person still has booked customers —
  // opens the conflict resolver under their row
  const [conflictFor, setConflictFor] = useState<string | null>(null);
  // 'new' opens an empty dialog; a staffId opens that person's
  const [dialogFor, setDialogFor] = useState<'new' | string | null>(null);
  const [q, setQ] = useState('');

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => `${r.name} ${r.role[lang]}`.toLowerCase().includes(needle))
    : rows;
  // A three-person salon never sees this; a chain with forty stylists does.
  const PER_PAGE = 15;
  const paged = usePaged(shown, PER_PAGE, q);

  /** Contracted minutes a week — the number a rota conversation actually turns on. */
  const weekMinutes = (r: Overview['staffRows'][number]) =>
    WEEK.reduce((sum, d) => sum + (r.shifts[d] ?? []).reduce((m, w) => m + (w.endMin - w.startMin), 0), 0);

  const editingRow = dialogFor && dialogFor !== 'new' ? rows.find((r) => r.staffId === dialogFor) ?? null : null;

  return (
    <div className="panel">
      {err && <div className="alert" style={{ marginBottom: 10 }}>{err}</div>}

      {/* The table shows; the popup edits. Rows full of live inputs made every
          glance at the roster feel like standing in wet paint. */}
      <div className="dtable-bar">
        <input
          className="input"
          style={{ flex: 1, minWidth: 170, maxWidth: 300 }}
          placeholder={t('team_search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="dtable-count">
          {shown.length === 1 ? t('team_count_one') : t('team_count', { n: String(shown.length) })}
        </span>
        <button className="btn btn-primary sm" onClick={() => setDialogFor('new')}>
          ＋ {t('team_add')}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="empty"><p>{t('no_results')}</p></div>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>{t('team_name')}</th>
                <th>{t('team_col_role')}</th>
                <th>{t('team_tier')}</th>
                <th>{t('team_branch')}</th>
                <th className="num">{t('team_week')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paged.page.map((r) => {
                const mins = weekMinutes(r);
                return (
                  <Fragment key={r.staffId}>
                    <tr>
                      <td data-label={t('team_name')}>
                        <div className="dt-person">
                          <span className="avatar" style={{ background: 'var(--violet)', margin: 0, width: 34, height: 34, fontSize: '0.85rem' }}>
                            {r.name[0]?.toUpperCase()}
                          </span>
                          <strong>{r.name}</strong>
                        </div>
                      </td>
                      <td data-label={t('team_col_role')}>{r.role[lang]}</td>
                      <td data-label={t('team_tier')}>{r.tier === 'senior' ? t('team_senior') : t('team_stylist')}</td>
                      <td data-label={t('team_branch')}>
                        {r.locationId ? locations.find((l) => l.id === r.locationId)?.label ?? '—' : '—'}
                      </td>
                      <td data-label={t('team_week')} className="num">
                        {mins === 0 ? <span className="dt-muted">—</span> : <strong>{(mins / 60).toFixed(mins % 60 ? 1 : 0)} h</strong>}
                      </td>
                      <td className="dt-actions">
                        <button className="btn btn-soft sm" onClick={() => setDialogFor(r.staffId)}>
                          ✏️ {t('team_edit')}
                        </button>
                      </td>
                    </tr>

                    {conflictFor === r.staffId && (
                      <tr className="dt-detail">
                        <td colSpan={6}>
                          <ConflictGuard
                            shopId={shopId}
                            staffId={r.staffId}
                            onChanged={(msg) => {
                              onChanged(msg);
                              setErr(null);
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <Pager paged={paged} perPage={PER_PAGE} />
        </div>
      )}

      <StaffDialog
        shopId={shopId}
        open={dialogFor !== null}
        row={editingRow}
        locations={locations}
        onClose={() => setDialogFor(null)}
        onChanged={onChanged}
        onArchiveConflict={(staffId, msg) => {
          setErr(msg);
          setConflictFor(staffId);
          setDialogFor(null);
        }}
      />
    </div>
  );
}

/**
 * One person, one popup: identity, tier, branch and the working week in a
 * single place — instead of a table of live inputs and an expanding row. The
 * same dialog with empty fields adds a new member.
 */
function StaffDialog({
  shopId,
  open,
  row,
  locations,
  onClose,
  onChanged,
  onArchiveConflict,
}: {
  shopId: string;
  open: boolean;
  row: Overview['staffRows'][number] | null;
  locations: Overview['shop']['locations'];
  onClose: () => void;
  onChanged: (msg: string) => void;
  onArchiveConflict: (staffId: string, msg: string) => void;
}) {
  const { t, lang } = useI18n();
  const { ask, dialog } = useConfirm();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [tier, setTier] = useState<'senior' | 'stylist'>('stylist');
  const [locationId, setLocationId] = useState('');

  // every opening mirrors the person (or starts blank for a new one)
  useEffect(() => {
    if (!open) return;
    setName(row?.name ?? '');
    setRole(row?.role[lang] ?? '');
    setTier(row?.tier ?? 'stylist');
    setLocationId(row?.locationId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.staffId]);

  const save = () => {
    if (!name.trim()) return;
    if (row) {
      void apiPatchStaff(shopId, row.staffId, {
        name: name.trim(),
        role: { en: role.trim() || 'Stylist', de: role.trim() || 'Stylist' },
        tier,
        locationId: locationId || undefined,
      }).then(() => {
        onChanged('💾 ' + t('team_saved'));
        onClose();
      });
    } else {
      void apiAddStaff(shopId, {
        name: name.trim(),
        role: role.trim() || 'Stylist',
        tier,
        locationId: locationId || undefined,
      }).then(() => {
        onChanged('✅ ' + t('team_added'));
        onClose();
      });
    }
  };

  return (
    <Modal
      open={open}
      title={row ? `✏️ ${row.name}` : `＋ ${t('team_add')}`}
      subtitle={row ? undefined : t('team_new_sub')}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }}>
          {row && (
            <button
              className="btn btn-ghost sm"
              style={{ color: 'var(--danger)', marginRight: 'auto' }}
              onClick={() =>
                ask({
                  title: t('del_staff_title', { name: row.name }),
                  body: t('del_staff_body'),
                  consequences: [t('del_staff_c1'), t('del_staff_c2')],
                  typeToConfirm: row.name,
                  confirmLabel: t('del_staff_confirm'),
                  run: () =>
                    apiArchiveStaff(shopId, row.staffId).then((res) => {
                      if (res.ok) {
                        onChanged('🗑 ' + t('team_removed'));
                        onClose();
                      } else if (res.reason === 'has_bookings') {
                        onArchiveConflict(row.staffId, t('team_has_bookings', { name: row.name }));
                      } else {
                        onArchiveConflict(row.staffId, t('team_last'));
                      }
                    }),
                })
              }
            >
              {t('team_remove')}
            </button>
          )}
          <button className="btn btn-ghost sm" onClick={onClose} style={row ? undefined : { marginLeft: 'auto' }}>
            {t('rc_close')}
          </button>
          <button className="btn btn-primary sm" disabled={!name.trim()} onClick={save}>
            {row ? t('acc_save') : t('team_add')}
          </button>
        </div>
      }
    >
      {dialog}
      <div className="sd-grid">
        <label>
          <span>{t('team_name')} *</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>{t('team_col_role')}</span>
          <input className="input" value={role} maxLength={60} placeholder={t('team_role')} onChange={(e) => setRole(e.target.value)} />
        </label>
        <label>
          <span>{t('team_tier')}</span>
          <select className="input" value={tier} onChange={(e) => setTier(e.target.value as 'senior' | 'stylist')}>
            <option value="stylist">{t('team_stylist')}</option>
            <option value="senior">{t('team_senior')}</option>
          </select>
        </label>
        <label>
          <span>{t('team_branch')}</span>
          <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">—</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
      </div>

      {row ? (
        <div style={{ marginTop: 14 }}>
          <strong style={{ fontSize: '0.85rem' }}>🕘 {t('team_hours')}</strong>
          <div className="team-hours" style={{ marginTop: 6 }}>
            {WEEK.map((d) => {
              const shift = row.shifts[d]?.[0];
              const dayName = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short' }).format(
                new Date(Date.UTC(2024, 0, d)),
              );
              return (
                <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', flexWrap: 'wrap' }}>
                  <span style={{ width: 40, fontWeight: 700, fontSize: '0.8rem' }}>{dayName}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={Boolean(shift)}
                      onChange={(e) => {
                        const shifts = { ...row.shifts };
                        if (e.target.checked) shifts[d] = [{ startMin: 9 * 60, endMin: 18 * 60 }];
                        else delete shifts[d];
                        void apiPatchStaff(shopId, row.staffId, { shifts }).then(() => onChanged('💾 ' + t('team_saved')));
                      }}
                    />
                    <span className="knob" />
                  </label>
                  {shift ? (
                    <>
                      <input
                        className="input"
                        style={{ width: 104, padding: '6px 10px' }}
                        type="time"
                        defaultValue={hhmm(shift.startMin)}
                        key={`s-${row.staffId}-${d}-${shift.startMin}`}
                        onBlur={(e) => {
                          const shifts = { ...row.shifts, [d]: [{ startMin: toMin(e.target.value), endMin: shift.endMin }] };
                          void apiPatchStaff(shopId, row.staffId, { shifts }).then(() => onChanged('💾 ' + t('team_saved')));
                        }}
                      />
                      –
                      <input
                        className="input"
                        style={{ width: 104, padding: '6px 10px' }}
                        type="time"
                        defaultValue={hhmm(shift.endMin)}
                        key={`e-${row.staffId}-${d}-${shift.endMin}`}
                        onBlur={(e) => {
                          const shifts = { ...row.shifts, [d]: [{ startMin: shift.startMin, endMin: toMin(e.target.value) }] };
                          void apiPatchStaff(shopId, row.staffId, { shifts }).then(() => onChanged('💾 ' + t('team_saved')));
                        }}
                      />
                      <button
                        className="btn btn-ghost sm"
                        style={{ marginLeft: 'auto' }}
                        title={t('copy_week_tip')}
                        onClick={() => {
                          const shifts = { ...row.shifts };
                          for (const wd of [1, 2, 3, 4, 5]) shifts[wd] = [{ ...shift }];
                          void apiPatchStaff(shopId, row.staffId, { shifts }).then(() => onChanged('💾 ' + t('team_saved')));
                        }}
                      >
                        {t('copy_week')}
                      </button>
                    </>
                  ) : (
                    <span style={{ color: 'var(--ink-soft)', fontSize: '0.82rem' }}>{t('p_closed')}</span>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', marginTop: 4 }}>{t('team_hours_hint')}</p>
        </div>
      ) : (
        <p style={{ fontSize: '0.76rem', color: 'var(--ink-soft)', marginTop: 12 }}>{t('team_hours_after')}</p>
      )}
    </Modal>
  );
}
