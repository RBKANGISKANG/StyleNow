'use client';
/**
 * Team tab — who works here, at which branch, on which days. The working hours
 * set here are the first input to availability: everything else (absences,
 * bookings, buffers) only ever subtracts from them.
 */
import { Fragment, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Glyph } from '@/components/Icon';
import { usePaged, Pager } from '@/components/Pager';
import { apiAddStaff, apiPatchStaff, apiArchiveStaff } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmDialog';
import { useToast } from '../toast';
import { OperatorShell, useOverview, type Overview } from '../shell';
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

  if (data === null) return <div className="spinner" />;

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
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [tier, setTier] = useState<'senior' | 'stylist'>('stylist');
  const [locationId, setLocationId] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const { ask, dialog } = useConfirm();

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

  return (
    <div className="panel">
      {dialog}
      {err && <div className="alert" style={{ marginBottom: 10 }}>{err}</div>}

      {/* Once a salon has more than a handful of people, a stack of cards is a
          scroll and a squint. A table puts role, tier, branch and contracted
          hours in the same column for everyone, so they can be compared down
          the page instead of remembered across it. */}
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
                    <tr className={editing === r.staffId ? 'open' : undefined}>
                      <td data-label={t('team_name')}>
                        <div className="dt-person">
                          <span className="avatar" style={{ background: 'var(--violet)', margin: 0, width: 34, height: 34, fontSize: '0.85rem' }}>
                            {r.name[0]?.toUpperCase()}
                          </span>
                          <input
                            className="input"
                            style={{ fontWeight: 700, padding: '6px 10px', minWidth: 120 }}
                            defaultValue={r.name}
                            key={`n-${r.staffId}-${r.name}`}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== r.name) void apiPatchStaff(shopId, r.staffId, { name: v }).then(() => onChanged('💾 ' + t('team_saved')));
                            }}
                          />
                        </div>
                      </td>
                      <td data-label={t('team_col_role')}>
                        <input
                          className="input"
                          style={{ padding: '6px 10px', fontSize: '0.82rem', minWidth: 110 }}
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
                      </td>
                      <td data-label={t('team_tier')}>
                        <select
                          className="dt-select"
                          value={r.tier}
                          onChange={(e) => void apiPatchStaff(shopId, r.staffId, { tier: e.target.value as 'senior' | 'stylist' }).then(() => onChanged('💾 ' + t('team_saved')))}
                        >
                          <option value="senior">{t('team_senior')}</option>
                          <option value="stylist">{t('team_stylist')}</option>
                        </select>
                      </td>
                      <td data-label={t('team_branch')}>
                        <select
                          className="dt-select"
                          value={r.locationId ?? ''}
                          onChange={(e) => void apiPatchStaff(shopId, r.staffId, { locationId: e.target.value || undefined }).then(() => onChanged('💾 ' + t('team_saved')))}
                        >
                          <option value="">—</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.label}</option>
                          ))}
                        </select>
                      </td>
                      <td data-label={t('team_week')} className="num">
                        {mins === 0 ? <span className="dt-muted">—</span> : <strong>{(mins / 60).toFixed(mins % 60 ? 1 : 0)} h</strong>}
                      </td>
                      <td className="dt-actions">
                        <button className="btn btn-soft sm" onClick={() => setEditing(editing === r.staffId ? null : r.staffId)}>
                          {t('team_hours')}
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
                      </td>
                    </tr>

                    {editing === r.staffId && (
                      <tr className="dt-detail">
                        <td colSpan={6}>
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
