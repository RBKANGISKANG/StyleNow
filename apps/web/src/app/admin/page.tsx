'use client';
/**
 * Platform admin — an "action inbox". Left: what needs a decision (pending
 * applications) and the live salons; right: the selected item in detail.
 * Server mode needs the admin key (sessionStorage only); local/static mode runs
 * the engine in this browser and has nothing to protect.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, dateOf } from '@/lib/format';
import { addDays, todayIso } from '@/core/time';
import { PLATFORM_COMMISSION_PCT, type ShopApplication } from '@/core/store';
import { useConfirm } from '@/components/ConfirmDialog';
import {
  adminKey,
  adminNeedsKey,
  setAdminKey,
  apiAdminApplications,
  apiAdminDecide,
  apiAdminOverview,
  apiAdminSetPaused,
  apiAdminSetRequireApproval,
  apiAdminSettings,
  type PlatformOverview,
  type PlatformRow,
} from '@/lib/api';

type Period = 'month' | '30d';
type Selected = { kind: 'app'; id: string } | { kind: 'shop'; id: string } | null;

interface AppData {
  business?: {
    legalName?: string; displayName?: string; categories?: string[]; contactName?: string; email?: string;
    phone?: string; website?: string; vatId?: string; registerNo?: string; smallBusiness?: boolean;
  };
  locations?: Array<{ mobile?: boolean; radiusKm?: number; street?: string; zip?: string; city?: string; district?: string }>;
  offer?: {
    openingHours?: Record<string, { open?: string; close?: string; closed?: boolean }>;
    services?: Array<{ name?: string; priceCents?: number; durationMin?: number }>;
    staffCount?: number;
    languages?: string[];
  };
  payoutAndPolicy?: {
    owner?: string; ibanMasked?: string; freeUntilHours?: number; lateFeePercent?: number;
    noShowFeePercent?: number; depositPercent?: number;
  };
  consents?: { partnerTerms?: boolean; accuracy?: boolean };
}

const dataOf = (a: ShopApplication) => a.data as AppData;
const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

function appName(a: ShopApplication): string {
  const b = dataOf(a).business;
  return (b?.displayName || b?.legalName || a.id).trim();
}
function appWhere(a: ShopApplication): string {
  const l = dataOf(a).locations?.[0];
  return (l?.district || l?.city || '').trim();
}

/** The automatic checklist: [label, passed, optional]. */
function checklist(a: ShopApplication): Array<[MsgKey, boolean, boolean]> {
  const d = dataOf(a);
  return [
    ['adm_c_legal', nonEmpty(d.business?.legalName), false],
    ['adm_c_email', /.+@.+\..+/.test(d.business?.email ?? ''), false],
    ['adm_c_tax', nonEmpty(d.business?.vatId) || d.business?.smallBusiness === true, false],
    ['adm_c_register', nonEmpty(d.business?.registerNo), true],
    ['adm_c_service', (d.offer?.services ?? []).some((s) => nonEmpty(s.name) && Number(s.priceCents) > 0), false],
    ['adm_c_hours', Object.values(d.offer?.openingHours ?? {}).some((h) => h && !h.closed), false],
    ['adm_c_payout', nonEmpty(d.payoutAndPolicy?.ibanMasked), false],
    ['adm_c_consents', d.consents?.partnerTerms === true && d.consents?.accuracy === true, false],
  ];
}

function periodRange(p: Period): [string, string] {
  const today = todayIso();
  return p === 'month' ? [`${today.slice(0, 8)}01`, today] : [addDays(today, -29), today];
}

export default function AdminPage() {
  const { t, lang } = useI18n();
  const { ask, dialog } = useConfirm();
  const needsKey = adminNeedsKey();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [apps, setApps] = useState<ShopApplication[]>([]);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [requireApproval, setRequire] = useState(false);
  const [selected, setSelected] = useState<Selected>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setHasKey(!needsKey || adminKey() !== ''), [needsKey]);

  const onError = useCallback((e: unknown) => {
    const code = (e as Error).message;
    if (code === 'unauthorized' || code === 'admin_not_configured') {
      setAdminKey('');
      setHasKey(!needsKey);
    }
    setError(code);
  }, [needsKey]);

  const load = useCallback(async () => {
    const [from, to] = periodRange(period);
    try {
      const [a, o, s] = await Promise.all([apiAdminApplications(), apiAdminOverview(from, to), apiAdminSettings()]);
      setApps(a);
      setOverview(o);
      setRequire(s.requireApproval);
      setError(null);
    } catch (e) {
      onError(e);
    }
  }, [period, onError]);

  useEffect(() => {
    if (hasKey) void load();
  }, [hasKey, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const pending = apps.filter((a) => a.status === 'pending');
  const decided = apps.filter((a) => a.status !== 'pending');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = overview?.rows ?? [];
    return q ? all.filter((r) => `${r.name} ${r.district}`.toLowerCase().includes(q)) : all;
  }, [overview, query]);

  const ago = (ms: number) => {
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 60) return t('adm_ago_min', { n: min });
    if (min < 60 * 24) return t('adm_ago_h', { n: Math.round(min / 60) });
    return t('adm_ago_d', { n: Math.round(min / 1440) });
  };

  const errorText = (code: string) =>
    code === 'unauthorized'
      ? t('adm_err_unauthorized')
      : code === 'admin_not_configured'
        ? t('adm_err_not_configured')
        : t('adm_err_generic', { code });

  if (hasKey === null) return null;

  if (!hasKey) {
    return (
      <div className="adm-gate panel">
        <h3>🔐 {t('adm_gate_title')}</h3>
        <p className="adm-muted">{t('adm_gate_body')}</p>
        {error && <div className="alert">{errorText(error)}</div>}
        <form
          className="adm-gate-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!keyInput.trim()) return;
            setAdminKey(keyInput.trim());
            setKeyInput('');
            setError(null);
            setHasKey(true);
          }}
        >
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={t('adm_gate_placeholder')}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={!keyInput.trim()}>
            {t('adm_gate_submit')}
          </button>
        </form>
      </div>
    );
  }

  const selApp = selected?.kind === 'app' ? apps.find((a) => a.id === selected.id) : undefined;
  const selShop = selected?.kind === 'shop' ? overview?.rows.find((r) => r.shopId === selected.id) : undefined;
  const liveCount = (overview?.rows ?? []).filter((r) => !r.paused).length;

  const reject = (a: ShopApplication) =>
    ask({
      title: t('adm_reject_title'),
      body: t('adm_reject_body'),
      questions: [{ id: 'reason', label: t('adm_reject_reason'), required: true, placeholder: t('adm_reject_ph') }],
      confirmLabel: t('adm_reject'),
      run: (answers) => act(() => apiAdminDecide(a.id, 'reject', answers.reason ?? '')),
    });

  return (
    <div className="adm">
      <div className="adm-head">
        <h1>🛡️ {t('adm_title')}</h1>
        <div className="adm-head-tools">
          <div className="filter-row" style={{ margin: 0 }}>
            {(['month', '30d'] as const).map((p) => (
              <button key={p} type="button" className={`chip ${period === p ? 'on-primary' : ''}`} onClick={() => setPeriod(p)}>
                {t(p === 'month' ? 'adm_period_month' : 'adm_period_30')}
              </button>
            ))}
          </div>
          {needsKey && (
            <button type="button" className="btn btn-ghost sm" onClick={() => (setAdminKey(''), setHasKey(false))}>
              {t('adm_sign_out')}
            </button>
          )}
        </div>
      </div>

      <label className="adm-require panel">
        <span className="switch">
          <input
            type="checkbox"
            checked={requireApproval}
            disabled={busy}
            onChange={(e) => {
              const on = e.target.checked;
              void act(() => apiAdminSetRequireApproval(on));
            }}
          />
          <span className="knob" />
        </span>
        <span>
          <b>{t('adm_require')}</b>
          <span className="adm-muted"> — {t(requireApproval ? 'adm_require_on' : 'adm_require_off')}</span>
        </span>
      </label>

      {!needsKey && <p className="adm-muted adm-note">ℹ️ {t('adm_local_note')}</p>}
      {error && <div className="alert">{errorText(error)}</div>}

      <div className={`adm-split ${selected ? 'has-sel' : ''}`}>
        <div className="adm-queue">
          <section className="panel">
            <h3>
              {t('adm_pending')} <span className="adm-count">{pending.length}</span>
            </h3>
            {pending.length === 0 && <p className="adm-muted">{t('adm_pending_none')}</p>}
            <ul className="adm-list">
              {pending.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`adm-item ${selected?.kind === 'app' && selected.id === a.id ? 'on' : ''}`}
                    onClick={() => setSelected({ kind: 'app', id: a.id })}
                  >
                    <span className="adm-item-main">
                      <b>{appName(a)}</b>
                      <span className="adm-muted">
                        {[appWhere(a), (dataOf(a).business?.categories ?? []).join(', '), ago(a.createdAt)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="adm-go">{t('adm_review')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h3>
              {t('adm_live')} <span className="adm-count">{overview?.rows.length ?? 0}</span>
            </h3>
            <input className="input" placeholder={t('adm_search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="adm-list adm-scroll">
              {rows.map((r) => (
                <li key={r.shopId}>
                  <button
                    type="button"
                    className={`adm-item ${selected?.kind === 'shop' && selected.id === r.shopId ? 'on' : ''}`}
                    onClick={() => setSelected({ kind: 'shop', id: r.shopId })}
                  >
                    <span className="adm-item-main">
                      <b>
                        {r.name} {r.paused && <span className="adm-badge warn">{t('adm_paused')}</span>}
                        {r.registered && <span className="adm-badge">{t('adm_new')}</span>}
                        <FreeBadge row={r} />
                      </b>
                      <span className="adm-muted">
                        {r.district} · {t('adm_bookings_n', { n: r.bookings })}
                      </span>
                    </span>
                    <span className="adm-num">{money(r.commissionCents, lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {decided.length > 0 && (
            <details className="panel adm-history">
              <summary>
                {t('adm_history')} <span className="adm-count">{decided.length}</span>
              </summary>
              <ul className="adm-list">
                {decided.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={`adm-item ${selected?.kind === 'app' && selected.id === a.id ? 'on' : ''}`}
                      onClick={() => setSelected({ kind: 'app', id: a.id })}
                    >
                      <span className="adm-item-main">
                        <b>{appName(a)}</b>
                        <span className="adm-muted">{a.decidedAt ? dateOf(a.decidedAt, lang) : ''}</span>
                      </span>
                      <span className={`adm-badge ${a.status === 'rejected' ? 'bad' : 'ok'}`}>
                        {t(a.status === 'rejected' ? 'adm_rejected' : 'adm_approved')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="adm-detail">
          {selected && (
            <button type="button" className="btn btn-ghost sm adm-back" onClick={() => setSelected(null)}>
              {t('adm_back')}
            </button>
          )}
          {selApp ? (
            <AppDetail
              app={selApp}
              busy={busy}
              onApprove={() => void act(() => apiAdminDecide(selApp.id, 'approve'))}
              onReject={() => reject(selApp)}
            />
          ) : selShop ? (
            <ShopDetail
              row={selShop}
              busy={busy}
              onPause={(paused) => void act(() => apiAdminSetPaused(selShop.shopId, paused))}
            />
          ) : (
            <div className="empty">
              <div className="big">📥</div>
              {t('adm_select')}
            </div>
          )}
        </div>
      </div>

      {overview && (
        <div className="adm-totals">
          <div className="stat-tile"><div className="lbl">{t('adm_s_bookings')}</div><div className="val">{overview.totals.bookings}</div></div>
          <div className="stat-tile"><div className="lbl">{t('adm_s_volume')}</div><div className="val">{money(overview.totals.volumeCents, lang)}</div></div>
          <div className="stat-tile"><div className="lbl">{t('adm_s_commission_owed', { pct: PLATFORM_COMMISSION_PCT })}</div><div className="val">{money(overview.totals.commissionCents, lang)}</div></div>
          <div className="stat-tile"><div className="lbl">{t('adm_s_live')}</div><div className="val">{liveCount}</div></div>
          <div className="stat-tile"><div className="lbl">{t('adm_s_pending')}</div><div className="val">{pending.length}</div></div>
        </div>
      )}
      {dialog}
    </div>
  );
}

/** "Free until <date>" while a salon is inside its commission-free first 12 months. */
function FreeBadge({ row }: { row: PlatformRow }) {
  const { t, lang } = useI18n();
  if (!row.freeUntil || row.freeUntil <= todayIso()) return null;
  const when = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${row.freeUntil}T00:00:00Z`));
  return <span className="adm-badge ok">{t('adm_free_until', { date: when })}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="adm-field">
      <span className="adm-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function AppDetail({ app, busy, onApprove, onReject }: { app: ShopApplication; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const { t, lang } = useI18n();
  const d = dataOf(app);
  const b = d.business ?? {};
  const pp = d.payoutAndPolicy ?? {};
  const checks = checklist(app);
  const blocking = checks.some(([, ok, optional]) => !ok && !optional);
  return (
    <div className="panel adm-card">
      <h3>{appName(app)}</h3>
      <p className="adm-muted">{app.id.toUpperCase()}</p>
      {app.status !== 'pending' && (
        <p className="adm-note">
          <span className={`adm-badge ${app.status === 'rejected' ? 'bad' : 'ok'}`}>
            {t(app.status === 'rejected' ? 'adm_rejected' : 'adm_approved')}
          </span>{' '}
          {app.decidedAt ? t('adm_decided', { when: dateOf(app.decidedAt, lang) }) : ''}
          {app.rejectReason ? ` · ${t('adm_reason_shown', { reason: app.rejectReason })}` : ''}
        </p>
      )}

      <h4>{t('adm_checklist')}</h4>
      <ul className="adm-checks">
        {checks.map(([key, ok, optional]) => (
          <li key={key} className={ok ? 'ok' : optional ? 'opt' : 'bad'}>
            <span aria-hidden>{ok ? '✓' : optional ? '–' : '✗'}</span> {t(key)}
          </li>
        ))}
      </ul>

      <h4>{t('adm_business')}</h4>
      <Field label={t('adm_f_legal')}>{b.legalName || '—'}</Field>
      <Field label={t('adm_f_display')}>{b.displayName || '—'}</Field>
      <Field label={t('adm_f_contact')}>{[b.contactName, b.email, b.phone, b.website].filter(Boolean).join(' · ') || '—'}</Field>
      <Field label={t('adm_f_vat')}>{b.vatId || '—'}</Field>
      <Field label={t('adm_f_register')}>{b.registerNo || '—'}</Field>
      <Field label={t('adm_f_small')}>{b.smallBusiness ? '✓' : '—'}</Field>
      <Field label={t('adm_f_locations')}>
        {(d.locations ?? []).map((l, i) => (
          <span key={i} className="adm-line">
            {l.mobile
              ? t('adm_f_mobile', { km: l.radiusKm ?? 0, city: l.city ?? '' })
              : [l.street, [l.zip, l.city].filter(Boolean).join(' '), l.district].filter(Boolean).join(', ')}
          </span>
        ))}
      </Field>
      <Field label={t('adm_f_services')}>
        {(d.offer?.services ?? []).map((s, i) => (
          <span key={i} className="adm-line">
            {s.name} · {money(Number(s.priceCents) || 0, lang)} · {s.durationMin} {t('min')}
          </span>
        ))}
      </Field>
      <Field label={t('adm_f_staff')}>
        {d.offer?.staffCount ?? '—'} · {(d.offer?.languages ?? []).join(', ').toUpperCase()}
      </Field>
      <Field label={t('adm_f_payout')}>{[pp.owner, pp.ibanMasked].filter(Boolean).join(' · ') || '—'}</Field>
      <Field label={t('adm_f_policy')}>
        {t('adm_f_policy_v', {
          h: pp.freeUntilHours ?? 0,
          late: pp.lateFeePercent ?? 0,
          ns: pp.noShowFeePercent ?? 0,
          dep: pp.depositPercent ?? 0,
        })}
      </Field>

      {app.status !== 'approved' && (
        <div className="adm-actions">
          <button type="button" className="btn btn-primary" disabled={busy || blocking} onClick={onApprove}>
            ✓ {t('adm_approve')}
          </button>
          {app.status === 'pending' && (
            <button type="button" className="btn btn-soft" disabled={busy} onClick={onReject}>
              {t('adm_reject')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ShopDetail({ row, busy, onPause }: { row: PlatformRow; busy: boolean; onPause: (paused: boolean) => void }) {
  const { t, lang } = useI18n();
  return (
    <div className="panel adm-card">
      <h3>
        {row.name} {row.paused && <span className="adm-badge warn">{t('adm_paused')}</span>} <FreeBadge row={row} />
      </h3>
      <p className="adm-muted">{row.district}</p>
      <div className="adm-stats">
        <div className="stat-tile"><div className="lbl">{t('adm_s_bookings')}</div><div className="val">{row.bookings}</div></div>
        <div className="stat-tile"><div className="lbl">{t('adm_s_volume')}</div><div className="val">{money(row.volumeCents, lang)}</div></div>
        <div className="stat-tile"><div className="lbl">{t('adm_s_online')}</div><div className="val">{money(row.onlineCompletedCents, lang)}</div></div>
        <div className="stat-tile"><div className="lbl">{t('adm_s_commission_owed', { pct: PLATFORM_COMMISSION_PCT })}</div><div className="val">{money(row.commissionCents, lang)}</div></div>
        <div className="stat-tile"><div className="lbl">{t('adm_s_noshow')}</div><div className="val">{row.noShowPct === null ? '—' : `${row.noShowPct} %`}</div></div>
        <div className="stat-tile"><div className="lbl">{t('adm_s_rating')}</div><div className="val">{row.ratingAvg.toFixed(1)}</div></div>
      </div>
      {row.paused && <p className="adm-muted adm-note">{t('adm_paused_note')}</p>}
      <div className="adm-actions">
        {row.slug && (
          <Link className="btn btn-soft" href={`/shops/${row.slug}`}>
            {t('adm_open_shop')} ↗
          </Link>
        )}
        <button type="button" className={`btn ${row.paused ? 'btn-primary' : 'btn-soft'}`} disabled={busy} onClick={() => onPause(!row.paused)}>
          {row.paused ? `▶ ${t('adm_resume')}` : `⏸ ${t('adm_pause')}`}
        </button>
      </div>
    </div>
  );
}
