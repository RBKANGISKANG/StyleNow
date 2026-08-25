'use client';
/**
 * HR page — the people side of a shop, on its own screen so the dashboard can
 * stay about today's operations.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { apiLocations } from '@/lib/api';
import { useOwnedShops, type ShopRef } from '@/lib/owned-shops';
import { HrPanel } from '@/components/HrPanel';

export function HrScreen({ shops }: { shops: ShopRef[] }) {
  const { t } = useI18n();
  const { ownedIds, myShops, shopId, setShopId } = useOwnedShops(shops);
  const [locations, setLocations] = useState<Array<{ id: string; label: string }>>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!shopId) return;
    void apiLocations(shopId).then(setLocations);
  }, [shopId]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const onChanged = useCallback((msg: string) => setToast(msg), []);

  if (ownedIds === null) return <div className="spinner" />;

  return (
    <div>
      <div className="page-title">
        <Link href="/dashboard" className="btn btn-ghost sm">
          ← {t('dash_title')}
        </Link>
        <h1>🧾 {t('hr_title')}</h1>
        {myShops.length > 1 && (
          <label className="chip">
            {t('dash_pick')}
            <select value={shopId} onChange={(e) => setShopId(e.target.value)}>
              {myShops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji} {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {myShops.length === 0 ? (
        <div className="empty">
          <div className="big">🏪</div>
          <h3 style={{ marginBottom: 6 }}>{t('own_none_title')}</h3>
          <p>{t('own_none_body')}</p>
          <div style={{ marginTop: 16 }}>
            <Link className="btn btn-primary" href="/dashboard">
              {t('dash_title')} →
            </Link>
          </div>
        </div>
      ) : (
        <HrPanel shopId={shopId} locations={locations} onChanged={onChanged} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
