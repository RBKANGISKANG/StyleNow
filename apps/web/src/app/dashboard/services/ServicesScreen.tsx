'use client';
/**
 * Services tab — the shop's menu and the smart-pricing rules that move those
 * prices. Both stay editable at any time; a removed service is archived rather
 * than dropped, so old receipts still render.
 */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  apiPatchService,
  apiAddService,
  apiArchiveService,
  apiToggleRule,
  apiAddPricingRule,
  apiDeletePricingRule,
} from '@/lib/api';
import { CategoryPicker } from '@/components/CategoryPicker';
import { useConfirm } from '@/components/ConfirmDialog';
import { useToast } from '../toast';
import { OperatorShell, useOverview } from '../shell';
import type { ShopRef } from '@/lib/owned-shops';

export function ServicesScreen({ shops }: { shops: ShopRef[] }) {
  return (
    <OperatorShell shops={shops} active="/dashboard/services">
      {({ shopId }) => <ServicesTab shopId={shopId} />}
    </OperatorShell>
  );
}

function ServicesTab({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const { data, reload: load } = useOverview(shopId);
  const { setToast, toastEl } = useToast();
  const { ask, dialog } = useConfirm();

  const patchService = async (
    sid: string,
    patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean; categoryId?: string },
  ) => {
    await apiPatchService(shopId, sid, patch);
    setToast('💾 OK');
    void load();
  };

  const toggleRule = async (rid: string) => {
    await apiToggleRule(shopId, rid);
    void load();
  };

  if (data === null) return <div className="spinner" />;

  return (
    <>
    <section className="section">
      <h2>{t('svc_manage')}</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="dash-table">
          <thead>
            <tr>
              <th>{t('services')}</th>
              <th>{t('svc_category')}</th>
              <th>{t('price')}</th>
              <th>{t('duration')}</th>
              <th>{t('smart_pricing')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.shop.services.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.emoji} <strong>{s.name[lang]}</strong>
                </td>
                <td>
                  <CategoryPicker
                    compact
                    value={s.categoryId ?? null}
                    onChange={(categoryId) => void patchService(s.id, { categoryId })}
                  />
                </td>
                <td>
                  <div className="svc-edit">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      defaultValue={(s.basePriceCents / 100).toFixed(2)}
                      key={`${s.id}-${s.basePriceCents}`}
                      onBlur={(e) => {
                        const cents = Math.round(parseFloat(e.target.value || '0') * 100);
                        if (cents !== s.basePriceCents && cents > 0) {
                          void patchService(s.id, { basePriceCents: cents });
                        }
                      }}
                    />
                    €
                  </div>
                </td>
                <td>
                  <div className="svc-edit">
                    <input
                      type="number"
                      min={10}
                      step={5}
                      defaultValue={s.durationMin}
                      key={`${s.id}-d-${s.durationMin}`}
                      onBlur={(e) => {
                        const v = Math.round(Number(e.target.value));
                        if (v !== s.durationMin && v >= 10) void patchService(s.id, { durationMin: v });
                      }}
                    />
                    {t('min')}
                  </div>
                </td>
                <td>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={s.dynamicPricing}
                      onChange={(e) => void patchService(s.id, { dynamicPricing: e.target.checked })}
                    />
                    <span className="knob" />
                  </label>
                </td>
                <td>
                  <button
                    className="btn btn-ghost sm"
                    style={{ color: 'var(--danger)' }}
                    onClick={() =>
                      ask({
                        title: t('del_service_title', { name: s.name[lang] }),
                        body: t('del_service_body'),
                        consequences: [t('del_service_c1'), t('del_service_c2')],
                        confirmLabel: t('del_service_confirm'),
                        run: () =>
                          apiArchiveService(shopId, s.id).then(() => {
                            setToast('🗄 ' + t('svc_archived'));
                            void load();
                          }),
                      })
                    }
                  >
                    {t('svc_archive')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddService
        shopId={shopId}
        onAdded={() => {
          setToast('✅ ' + t('svc_added'));
          void load();
        }}
      />
    </section>

    <section className="section">
      <h2>{t('rules_title')}</h2>
      <div className="panel">
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 12 }}>{t('rules_hint')}</p>
        {data.shop.pricingRules.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.88rem' }}>—</p>
        ) : (
          data.shop.pricingRules.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 0',
                borderTop: '1px solid var(--line)',
              }}
            >
              <span style={{ flex: 1, fontWeight: 600, fontSize: '0.9rem' }}>{r.name}</span>
              <span
                className={`st-badge ${r.enabled ? 'st-confirmed' : 'st-pending_payment'}`}
              >
                {r.enabled ? t('rule_on') : t('rule_off')}
              </span>
              <label className="switch">
                <input type="checkbox" checked={r.enabled} onChange={() => void toggleRule(r.id)} />
                <span className="knob" />
              </label>
              <button
                className="btn btn-ghost sm"
                style={{ color: 'var(--danger)' }}
                onClick={() =>
                  ask({
                    title: t('del_rule_title', { name: r.name }),
                    body: t('del_rule_body'),
                    confirmLabel: t('del_rule_confirm'),
                    run: () =>
                      apiDeletePricingRule(shopId, r.id).then(() => {
                        setToast('🗑 ' + t('rule_deleted'));
                        void load();
                      }),
                  })
                }
              >
                {t('rule_delete')}
              </button>
            </div>
          ))
        )}
        <AddRule
          shopId={shopId}
          onAdded={() => {
            setToast('✅ ' + t('rule_added'));
            void load();
          }}
        />
      </div>
    </section>
      {toastEl}
      {dialog}
    </>
  );
}

function AddService({ shopId, onAdded }: { shopId: string; onAdded: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('✨');
  const [price, setPrice] = useState('');
  const [minutes, setMinutes] = useState('45');
  const [gap, setGap] = useState('0');
  const [dyn, setDyn] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="btn btn-soft sm" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
        {t('svc_add')}
      </button>
    );
  }
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ width: 70 }} value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={2} />
        <input
          className="input"
          style={{ flex: 1, minWidth: 160 }}
          placeholder={t('svc_new_name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
        <input className="input" style={{ width: 96 }} type="number" min={0} step="0.5" placeholder="€" value={price} onChange={(e) => setPrice(e.target.value)} />
        <input className="input" style={{ width: 90 }} type="number" min={5} step={5} placeholder={t('min')} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <input className="input" style={{ width: 110 }} type="number" min={0} step={5} placeholder={`+${t('min')} gap`} value={gap} onChange={(e) => setGap(e.target.value)} />
        <CategoryPicker value={categoryId} onChange={setCategoryId} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
          <span className="switch">
            <input type="checkbox" checked={dyn} onChange={(e) => setDyn(e.target.checked)} />
            <span className="knob" />
          </span>
          {t('smart_pricing')}
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-ghost sm" onClick={() => setOpen(false)}>✕</button>
        <button
          className="btn btn-primary sm"
          disabled={!name.trim() || !(Number(price) > 0)}
          onClick={() => {
            void apiAddService(shopId, {
              name: name.trim(),
              emoji,
              basePriceCents: Math.round(Number(price) * 100),
              durationMin: Number(minutes),
              processingGapMin: Number(gap),
              dynamicPricing: dyn,
              categoryId: categoryId ?? undefined,
            }).then(() => {
              setName('');
              setPrice('');
              setOpen(false);
              onAdded();
            });
          }}
        >
          {t('svc_add')}
        </button>
      </div>
    </div>
  );
}

const RULE_KINDS = ['time_of_day', 'day_of_week', 'last_minute', 'occupancy', 'new_customer', 'seasonal'] as const;
const DOW_KEYS = [1, 2, 3, 4, 5, 6, 7];

function AddRule({ shopId, onAdded }: { shopId: string; onAdded: () => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof RULE_KINDS)[number]>('time_of_day');
  const [adjustKind, setAdjustKind] = useState<'percent' | 'fixed_cents'>('percent');
  const [value, setValue] = useState('-10');
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('12:00');
  const [dows, setDows] = useState<number[]>([]);

  const toMinutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

  if (!open) {
    return (
      <button className="btn btn-soft sm" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
        {t('rule_add')}
      </button>
    );
  }
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '2px dashed var(--line)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder={t('rule_name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
        <label className="chip">
          {t('rule_kind')}
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {RULE_KINDS.map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>
        <label className="chip">
          {t('rule_adjust')}
          <select value={adjustKind} onChange={(e) => setAdjustKind(e.target.value as typeof adjustKind)}>
            <option value="percent">{t('rule_percent')}</option>
            <option value="fixed_cents">{t('rule_fixed')}</option>
          </select>
        </label>
        <input className="input" style={{ width: 100 }} type="number" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      {kind === 'time_of_day' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <input className="input" style={{ width: 120 }} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          –
          <input className="input" style={{ width: 120 }} type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
      {(kind === 'time_of_day' || kind === 'day_of_week') && (
        <div className="filter-row" style={{ marginTop: 8, marginBottom: 0 }}>
          {DOW_KEYS.map((d) => (
            <button
              key={d}
              className={`chip ${dows.includes(d) ? 'on-primary' : ''}`}
              onClick={() => setDows(dows.includes(d) ? dows.filter((x) => x !== d) : [...dows, d])}
            >
              {new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, d)))}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-ghost sm" onClick={() => setOpen(false)}>✕</button>
        <button
          className="btn btn-primary sm"
          disabled={!name.trim() || Number.isNaN(Number(value))}
          onClick={() => {
            const rule: Record<string, unknown> = {
              kind,
              name: name.trim(),
              adjustKind,
              adjustValue: adjustKind === 'percent' ? Number(value) : Math.round(Number(value) * 100),
              priority: 10,
              stackable: false,
            };
            if (dows.length) rule.dows = dows;
            if (kind === 'time_of_day') {
              rule.minuteOfDayFrom = toMinutes(from);
              rule.minuteOfDayTo = toMinutes(to);
            }
            if (kind === 'last_minute') rule.leadHoursMax = 3;
            if (kind === 'occupancy') rule.occupancyMinPct = 80;
            void apiAddPricingRule(shopId, rule).then(() => {
              setName('');
              setOpen(false);
              onAdded();
            });
          }}
        >
          {t('rule_save')}
        </button>
      </div>
    </div>
  );
}
