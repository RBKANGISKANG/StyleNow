'use client';
/**
 * Shop tab — the company's own settings: logo, branches, and the exit door.
 * Nothing here is part of running today, which is why it is not on the Today
 * tab getting in the way.
 */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  apiSetShopLogo,
  apiAddLocation,
  apiPatchLocation,
  apiDeleteLocation,
  apiReleaseShop,
  apiRecordExitFeedback,
} from '@/lib/api';
import { fileToLogoDataUrl } from '@/lib/image';
import { useConfirm } from '@/components/ConfirmDialog';
import { useToast } from '../toast';
import { OperatorShell, useOverview, type Overview } from '../shell';
import type { ShopRef } from '@/lib/owned-shops';

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
      {locationsSection}

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
