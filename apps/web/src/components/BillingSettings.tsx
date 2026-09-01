'use client';
/**
 * What the shop's receipts say.
 *
 * Three fields and a checkbox, because that is all a B2C service receipt
 * legally needs beyond what the booking knows. The checkbox is the one with
 * teeth: a Kleinunternehmer's receipts must not show VAT at all, so flipping
 * it changes every future receipt from the VAT block to the §19 sentence.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { apiBillingProfile, apiSetBillingProfile, type BillingProfile } from '@/lib/api';

export function BillingSettings({ shopId, onToast }: { shopId: string; onToast: (msg: string) => void }) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<BillingProfile | null>(null);

  useEffect(() => {
    let alive = true;
    void apiBillingProfile(shopId).then((b) => {
      if (alive) setProfile(b);
    });
    return () => {
      alive = false;
    };
  }, [shopId]);

  if (!profile) return <div className="spinner" />;

  const save = (next: BillingProfile) => {
    setProfile(next);
    void apiSetBillingProfile(shopId, next).then(() => onToast('💾 ' + t('bl_saved')));
  };

  return (
    <div className="panel">
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 12 }}>{t('bl_hint')}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ flex: 1, minWidth: 200, display: 'grid', gap: 4, fontSize: '0.75rem', fontWeight: 700 }}>
          {t('bl_legal')}
          <input
            className="input"
            defaultValue={profile.legalName}
            key={`l-${shopId}-${profile.legalName}`}
            maxLength={120}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value.trim() !== profile.legalName)
                save({ ...profile, legalName: e.target.value.trim() });
            }}
          />
        </label>
        <label style={{ flex: 1, minWidth: 180, display: 'grid', gap: 4, fontSize: '0.75rem', fontWeight: 700 }}>
          {t('bl_taxid')}
          <input
            className="input"
            defaultValue={profile.taxId}
            key={`t-${shopId}-${profile.taxId}`}
            maxLength={40}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value.trim() !== profile.taxId)
                save({ ...profile, taxId: e.target.value.trim() });
            }}
          />
        </label>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 12, fontSize: '0.8rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={profile.smallBusiness}
          onChange={(e) => save({ ...profile, smallBusiness: e.target.checked })}
          style={{ width: 16, height: 16, accentColor: 'var(--primary)', marginTop: 2 }}
        />
        <span>{t('bl_small')}</span>
      </label>
    </div>
  );
}
