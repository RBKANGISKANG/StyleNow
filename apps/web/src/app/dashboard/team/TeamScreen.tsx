'use client';
/**
 * Team tab — who works here, at which branch, on which days. The working hours
 * set here are the first input to availability: everything else (absences,
 * bookings, buffers) only ever subtracts from them.
 */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
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
        <h2>👥 {t('team_title')}</h2>
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
