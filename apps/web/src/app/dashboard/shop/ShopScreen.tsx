'use client';
/**
 * Shop tab — the company's own settings: logo, photos, branches, and the exit
 * door.
 * Nothing here is part of running today, which is why it is not on the Today
 * tab getting in the way.
 */
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  apiSetShopLogo,
  apiAddLocation,
  apiPatchLocation,
  apiDeleteLocation,
  apiReleaseShop,
  apiRecordExitFeedback,
  apiClosures,
  apiAddClosure,
  apiDeleteClosure,
  apiShopBackup,
  apiShopRestore,
  apiShopAnnouncement,
  apiSetShopAnnouncement,
  apiStampStatus,
  apiSetStampSettings,
  apiQuietDiscount,
  apiSetQuietDiscount,
  apiQuietWindows,
  apiChecklists,
  apiSaveChecklist,
  apiDeleteChecklist,
  apiResources,
  apiSetResources,
  type ShopClosure,
} from '@/lib/api';
import type { ChecklistTemplate as ChecklistTemplateT } from '@/core/store';
import { weekdayShort } from '@/lib/format';
import { fileToLogoDataUrl } from '@/lib/image';
import { PhotoManager } from '@/components/PhotoManager';
import { BillingSettings } from '@/components/BillingSettings';
import { useConfirm } from '@/components/ConfirmDialog';
import { ConflictGuard } from '@/components/ConflictGuard';
import { useToast } from '../toast';
import { OperatorShell, useOverview, type Overview } from '../shell';
import type { ShopRef } from '@/lib/owned-shops';
import { todayIso, addDays } from '@/core/time';

export function ShopScreen({ shops }: { shops: ShopRef[] }) {
  return (
    <OperatorShell shops={shops} active="/dashboard/shop">
      {({ shopId, ownerKey, refresh }) => <ShopTab shopId={shopId} ownerKey={ownerKey} refresh={refresh} />}
    </OperatorShell>
  );
}

function ShopTab({
  shopId,
  ownerKey,
  refresh,
}: {
  shopId: string;
  ownerKey: string | null;
  refresh: () => void;
}) {
  const { t } = useI18n();
  const { data, reload: load } = useOverview(shopId);
  const { setToast, toastEl } = useToast();
  const { ask, dialog } = useConfirm();

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

  if (data === null) return <div className="spinner" />;

  const logoSection = (
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

  );

  const locationsSection = (
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

  );


  return (
    <>
      {logoSection}

      <section className="section">
        <h2>{t('ph_title')}</h2>
        <PhotoManager shopId={shopId} onToast={setToast} />
      </section>

      <section className="section">
        <h2>🧾 {t('bl_title')}</h2>
        <BillingSettings shopId={shopId} onToast={setToast} />
      </section>

      {locationsSection}

      <section className="section">
        <h2>🚫 {t('cls_title')}</h2>
        <ClosureManager shopId={shopId} onChanged={(msg) => setToast(msg)} />
      </section>

      <section className="section">
        <h2>💮 {t('st_title')}</h2>
        <StampPanel shopId={shopId} onChanged={(msg) => setToast(msg)} />
      </section>

      <section className="section">
        <h2>🌙 {t('qd_title')}</h2>
        <QuietDiscountPanel shopId={shopId} onChanged={(msg) => setToast(msg)} />
      </section>

      <section className="section">
        <h2>🚿 {t('rs_title')}</h2>
        <ResourcesPanel shopId={shopId} onChanged={(msg) => setToast(msg)} />
      </section>

      <section className="section">
        <h2>🧽 {t('cl_title')}</h2>
        <ChecklistEditor shopId={shopId} onChanged={(msg) => setToast(msg)} />
      </section>

      <section className="section">
        <h2>📣 {t('an_title')}</h2>
        <AnnouncementPanel shopId={shopId} onChanged={(msg) => setToast(msg)} />
      </section>

      <section className="section">
        <h2>💾 {t('bk_title')}</h2>
        <BackupPanel shopId={shopId} onChanged={(msg) => setToast(msg)} />
      </section>

      <section className="section">
        <h2>{t('own_disconnect')}</h2>
        <div className="panel">
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 10 }}>{t('co_del_body')}</p>
          <button
            className="btn btn-ghost sm"
            style={{ color: 'var(--danger)' }}
            onClick={() => {
              if (!ownerKey) return;
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
      </section>

      {toastEl}
      {dialog}
    </>
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

/** The shop's own loyalty program: on/off and how many visits earn the free one. */
function StampPanel({ shopId, onChanged }: { shopId: string; onChanged: (msg: string) => void }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(true);
  const [required, setRequired] = useState(10);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    void apiStampStatus(shopId).then((st) => {
      setEnabled(st.enabled);
      setRequired(st.required);
      setLoaded(true);
    });
  }, [shopId]);

  const save = (nextEnabled: boolean, nextRequired: number) => {
    setEnabled(nextEnabled);
    setRequired(nextRequired);
    void apiSetStampSettings(shopId, { enabled: nextEnabled, required: nextRequired }).then(() =>
      onChanged('💮 ' + t('st_saved')),
    );
  };

  if (!loaded) return <div className="spinner" />;
  return (
    <div className="panel">
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 10 }}>
        {t('st_hint', { n: String(required) })}
      </p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <span className="switch">
            <input type="checkbox" checked={enabled} onChange={(e) => save(e.target.checked, required)} />
            <span className="knob" />
          </span>
          <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{t('st_enabled')}</span>
        </label>
        {enabled && (
          <label className="chip">
            {t('st_required')}
            <select value={required} onChange={(e) => save(enabled, Number(e.target.value))}>
              {[5, 8, 10, 12, 15].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * A flat percent off in the shop's two historically emptiest day-parts.
 * The engine decides *where* it applies (quietWindows), the shop only says
 * how much — so the discount always sits exactly where chairs stand empty.
 */
function QuietDiscountPanel({ shopId, onChanged }: { shopId: string; onChanged: (msg: string) => void }) {
  const { t, lang } = useI18n();
  const [pct, setPct] = useState(0);
  const [windows, setWindows] = useState<Array<{ dow: number; part: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    void apiQuietDiscount(shopId).then((p) => {
      setPct(p);
      setLoaded(true);
    });
    void apiQuietWindows(shopId).then((w) => setWindows(w.slice(0, 2)));
  }, [shopId]);

  const save = (next: number) => {
    setPct(next);
    void apiSetQuietDiscount(shopId, next).then(() => onChanged('🌙 ' + t('qd_saved')));
  };

  if (!loaded) return <div className="spinner" />;
  const partName = (p: string) => t(p === 'morning' ? 'qw_morning' : p === 'afternoon' ? 'qw_afternoon' : 'qw_evening');
  return (
    <div className="panel">
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 10 }}>{t('qd_hint')}</p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="chip">
          {t('qd_pct')}
          <select value={pct} onChange={(e) => save(Number(e.target.value))}>
            {[0, 5, 10, 15, 20, 25, 30].map((n) => (
              <option key={n} value={n}>{n === 0 ? t('qd_off') : `−${n}%`}</option>
            ))}
          </select>
        </label>
        {pct > 0 && windows.length > 0 && (
          <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
            {t('qd_where')}{' '}
            {windows
              .map((w) => `${weekdayShort(addDays(todayIso(), ((w.dow - isoDowToday() + 7) % 7)), lang)} ${partName(w.part)}`)
              .join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The physical bottlenecks: a salon with five chairs but two wash basins gets
 * impossible schedules unless the engine knows. 0 = not tracked (unlimited).
 * Which services occupy which resource is set per service on the Services tab.
 */
function ResourcesPanel({ shopId, onChanged }: { shopId: string; onChanged: (msg: string) => void }) {
  const { t } = useI18n();
  const [res, setRes] = useState<{ basins: number; colourStations: number }>({ basins: 0, colourStations: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    void apiResources(shopId).then((r) => {
      setRes(r ?? { basins: 0, colourStations: 0 });
      setLoaded(true);
    });
  }, [shopId]);

  const save = (next: { basins: number; colourStations: number }) => {
    setRes(next);
    void apiSetResources(shopId, next).then(() => onChanged('🚿 ' + t('rs_saved')));
  };

  if (!loaded) return <div className="spinner" />;
  const opts = [0, 1, 2, 3, 4, 5, 6];
  return (
    <div className="panel">
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 10 }}>{t('rs_hint')}</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label className="chip">
          🚿 {t('rs_basins')}
          <select value={res.basins} onChange={(e) => save({ ...res, basins: Number(e.target.value) })}>
            {opts.map((n) => (<option key={n} value={n}>{n === 0 ? '∞' : n}</option>))}
          </select>
        </label>
        <label className="chip">
          🎨 {t('rs_colour')}
          <select value={res.colourStations} onChange={(e) => save({ ...res, colourStations: Number(e.target.value) })}>
            {opts.map((n) => (<option key={n} value={n}>{n === 0 ? '∞' : n}</option>))}
          </select>
        </label>
      </div>
    </div>
  );
}

/**
 * The Putzplan editor: each routine is a kind and one line per item. The
 * ticking happens on the Today tab; this is only where the routine is written.
 */
function ChecklistEditor({ shopId, onChanged }: { shopId: string; onChanged: (msg: string) => void }) {
  const { t } = useI18n();
  const [lists, setLists] = useState<ChecklistTemplateT[]>([]);
  const [editing, setEditing] = useState<{ id?: string; kind: 'opening' | 'closing' | 'weekly'; text: string } | null>(null);

  const load = useCallback(() => {
    if (!shopId) return;
    void apiChecklists(shopId).then(setLists);
  }, [shopId]);
  useEffect(load, [load]);

  const kindLabel = (k: string) => t(k === 'opening' ? 'cl_opening' : k === 'closing' ? 'cl_closing' : 'cl_weekly');
  return (
    <div className="panel">
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 10 }}>{t('cl_hint')}</p>
      {lists.map((tpl) => (
        <div key={tpl.id} className="wi-row">
          <span className="wi-name">{kindLabel(tpl.kind)}</span>
          <span className="wi-meta">{tpl.items.length} {t('cl_items')}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-soft sm"
              aria-label={t('a11y_edit')}
              onClick={() => setEditing({ id: tpl.id, kind: tpl.kind, text: tpl.items.map((i) => i.label).join('\n') })}
            >
              ✏️
            </button>
            <button className="btn btn-ghost sm" aria-label={t('a11y_delete')} onClick={() => void apiDeleteChecklist(shopId, tpl.id).then(load)}>
              ✕
            </button>
          </span>
        </div>
      ))}
      {editing ? (
        <div style={{ marginTop: 10 }}>
          <label className="chip" style={{ marginBottom: 8 }}>
            <select
              value={editing.kind}
              onChange={(e) => setEditing({ ...editing, kind: e.target.value as 'opening' | 'closing' | 'weekly' })}
            >
              <option value="opening">{t('cl_opening')}</option>
              <option value="closing">{t('cl_closing')}</option>
              <option value="weekly">{t('cl_weekly')}</option>
            </select>
          </label>
          <textarea
            className="input"
            rows={5}
            placeholder={t('cl_items_ph')}
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn btn-primary sm"
              disabled={!editing.text.trim()}
              onClick={() => {
                // Re-saving must not orphan today's ticks: an unchanged line
                // keeps its item id, only genuinely new lines get fresh ones.
                const prev = new Map(
                  (lists.find((l) => l.id === editing.id)?.items ?? []).map((i) => [i.label, i.id]),
                );
                void apiSaveChecklist(shopId, {
                  id: editing.id,
                  kind: editing.kind,
                  items: editing.text.split('\n').map((l) => ({ id: prev.get(l.trim()) ?? '', label: l })),
                }).then(() => {
                  setEditing(null);
                  onChanged('🧽 ' + t('cl_saved'));
                  load();
                });
              }}
            >
              💾 {t('loc_save')}
            </button>
            <button className="btn btn-ghost sm" onClick={() => setEditing(null)}>
              {t('cd_keep')}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-soft sm" style={{ marginTop: 8 }} onClick={() => setEditing({ kind: 'opening', text: '' })}>
          ＋ {t('cl_new')}
        </button>
      )}
    </div>
  );
}

/** iso weekday (1=Mon…7=Sun) of today, for turning a stored dow into a date. */
function isoDowToday(): number {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

/**
 * One sentence from the shop to everyone about to book — "we have AC",
 * "Christmas closing 24.–26.12.", "cash only today". Shown on the shop page
 * and at the top of checkout; empty means invisible.
 */
function AnnouncementPanel({ shopId, onChanged }: { shopId: string; onChanged: (msg: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    void apiShopAnnouncement(shopId).then((a) => {
      setText(a);
      setLoaded(true);
    });
  }, [shopId]);

  if (!loaded) return <div className="spinner" />;
  return (
    <div className="panel">
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 10 }}>{t('an_hint')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder={t('an_ph')}
          value={text}
          maxLength={140}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="btn btn-primary sm"
          onClick={() => void apiSetShopAnnouncement(shopId, text).then(() => onChanged('📣 ' + t('an_saved')))}
        >
          {t('an_save')}
        </button>
        {text && (
          <button
            className="btn btn-ghost sm"
            onClick={() => {
              setText('');
              void apiSetShopAnnouncement(shopId, '').then(() => onChanged('📣 ' + t('an_cleared')));
            }}
          >
            {t('an_clear')}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Backup and restore: the shop's whole configuration — team, hours, menu,
 * rules, photos, billing, notes — as one JSON file the operator OWNS. Ten
 * years from now the file still opens; a platform's database might not be
 * so obliging. Restore merges only this shop's slice, exactly like a sync
 * document, then pushes to the shop's other devices.
 */
function BackupPanel({ shopId, onChanged }: { shopId: string; onChanged: (msg: string) => void }) {
  const { t } = useI18n();
  const { ask, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    const doc = await apiShopBackup(shopId);
    if (!doc) return;
    const stamp = todayIso();
    const blob = new Blob([JSON.stringify({ shopId, exportedAt: new Date().toISOString(), config: doc }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stylenow-backup-${shopId}-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onChanged('💾 ' + t('bk_downloaded'));
  };

  const restore = (file: File) => {
    void file.text().then((text) => {
      let parsed: { shopId?: string; config?: unknown } | null = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        onChanged('⚠️ ' + t('bk_bad_file'));
        return;
      }
      if (!parsed?.config || typeof parsed.config !== 'object') {
        onChanged('⚠️ ' + t('bk_bad_file'));
        return;
      }
      if (parsed.shopId && parsed.shopId !== shopId) {
        onChanged('⚠️ ' + t('bk_wrong_shop'));
        return;
      }
      const config = parsed.config as Parameters<typeof apiShopRestore>[1];
      ask({
        title: t('bk_restore_title'),
        body: t('bk_restore_body'),
        consequences: [t('bk_restore_c1'), t('bk_restore_c2')],
        confirmLabel: t('bk_restore_confirm'),
        run: async () => {
          setBusy(true);
          const ok = await apiShopRestore(shopId, config);
          setBusy(false);
          onChanged(ok ? '✅ ' + t('bk_restored') : '⚠️ ' + t('bk_bad_file'));
        },
      });
    });
  };

  return (
    <div className="panel">
      {dialog}
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 10 }}>{t('bk_hint')}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-soft sm" onClick={() => void download()} disabled={busy}>
          ⬇️ {t('bk_download')}
        </button>
        <label className="btn btn-ghost sm" style={{ cursor: 'pointer' }}>
          ⬆️ {t('bk_restore')}
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) restore(f);
            }}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * Shop-wide closures. An absence takes one person out; this takes the whole
 * shop out — public holidays, renovation, the summer break — and it feeds the
 * same availability path, so the days vanish from every booking surface at
 * once rather than having to be entered per stylist.
 */
function ClosureManager({ shopId, onChanged }: { shopId: string; onChanged: (msg: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ShopClosure[] | null>(null);
  const [draft, setDraft] = useState({ from: todayIso(), to: todayIso(), reason: '' });
  const { ask, dialog } = useConfirm();

  const load = useCallback(() => {
    if (!shopId) return;
    void apiClosures(shopId).then(setRows);
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="panel">
      {dialog}
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 10 }}>{t('cls_hint')}</p>

      {rows === null ? (
        <div className="spinner" />
      ) : rows.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{t('cls_none')}</p>
      ) : (
        rows.map((c) => (
          <div key={c.id}>
          <div className="hr-abs">
            <span className="st-badge st-cancelled_by_shop">{t('cls_closed')}</span>
            <span style={{ fontSize: '0.85rem' }}>
              {c.from}
              {c.to !== c.from && ` → ${c.to}`}
              {c.reason ? ` · ${c.reason}` : ''}
            </span>
            <button
              className="btn btn-ghost sm"
              style={{ color: 'var(--danger)', marginLeft: 'auto' }}
              onClick={() =>
                ask({
                  title: t('cls_del_title'),
                  body: t('cls_del_body'),
                  consequences: [`${c.from}${c.to !== c.from ? ` → ${c.to}` : ''}${c.reason ? ` · ${c.reason}` : ''}`],
                  confirmLabel: t('cls_del_confirm'),
                  run: () =>
                    apiDeleteClosure(shopId, c.id).then(() => {
                      load();
                      onChanged('🗑 ' + t('cls_removed'));
                    }),
                })
              }
            >
              ✕
            </button>
          </div>
          {/* Closing the shop does not un-sell the appointments inside those
              days. Every stylist is off, so there is nobody to reassign to —
              each one is cancelled with a full refund, or the closure moves. */}
          {c.to >= todayIso() && (
            <ConflictGuard shopId={shopId} staffId={null} from={c.from} to={c.to} onChanged={onChanged} />
          )}
          </div>
        ))
      )}

      <div className="hr-abs-form">
        <label className="chip">
          {t('hr_from')}
          <input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            style={{ border: 'none', background: 'transparent', outline: 'none', fontWeight: 600 }}
          />
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
          style={{ flex: 1, minWidth: 160 }}
          placeholder={t('cls_reason_ph')}
          value={draft.reason}
          onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
          maxLength={80}
        />
        <button
          className="btn btn-primary sm"
          onClick={() => {
            void apiAddClosure(shopId, {
              from: draft.from,
              to: draft.to < draft.from ? draft.from : draft.to,
              reason: draft.reason.trim(),
            }).then(() => {
              setDraft({ from: todayIso(), to: todayIso(), reason: '' });
              load();
              onChanged('✅ ' + t('cls_added'));
            });
          }}
        >
          {t('cls_add')}
        </button>
      </div>
    </div>
  );
}
