'use client';
/**
 * Sales leads: salons we want on the platform. Private to the platform admin.
 * Import a CSV (or the JSON the research produced), work through the list,
 * and send each salon its invite link — the partner form opens pre-filled.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { LEAD_STATUSES, type Lead, type LeadStatus } from '@/core/store';
import { adminKey, adminNeedsKey, apiAdminImportLeads, apiAdminLeads, apiAdminUpdateLead } from '@/lib/api';

/** Minimal RFC-4180 CSV parser (quotes, commas, newlines in quotes; ; or , separator). */
function parseCsv(text: string): Array<Record<string, string>> {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().replace(/^﻿/, ''));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const CSV_COLUMNS = ['id', 'name', 'category', 'street', 'postcode', 'district', 'city', 'phone', 'email', 'website', 'instagram', 'owner_name', 'opening_hours', 'status', 'source', 'note'];

export default function LeadsPage() {
  const { t } = useI18n();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<LeadStatus | 'all'>('all');
  const [withEmail, setWithEmail] = useState(false);

  const load = useCallback(async () => {
    try {
      setLeads(await apiAdminLeads());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!adminNeedsKey() || adminKey()) void load();
    else setError('unauthorized');
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (leads ?? []).filter(
      (l) =>
        (status === 'all' || l.status === status) &&
        (!withEmail || l.email) &&
        (!needle || `${l.name} ${l.street} ${l.district} ${l.postcode} ${l.category}`.toLowerCase().includes(needle)),
    );
  }, [leads, q, status, withEmail]);

  const importFile = async (file: File) => {
    const text = await file.text();
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = file.name.endsWith('.json') ? JSON.parse(text) : parseCsv(text);
    } catch {
      setMsg('⚠️ ' + t('ld_bad_file'));
      return;
    }
    if (!Array.isArray(rows) || !rows.length) return setMsg('⚠️ ' + t('ld_bad_file'));
    try {
      const r = await apiAdminImportLeads(rows);
      setMsg('✓ ' + t('ld_imported', { added: r.added, updated: r.updated, skipped: r.skipped }));
      await load();
    } catch (e) {
      setMsg('⚠️ ' + (e as Error).message);
    }
  };

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = [CSV_COLUMNS.join(','), ...shown.map((l) => [l.id, l.name, l.category, l.street, l.postcode, l.district, l.city, l.phone, l.email, l.website, l.instagram, l.ownerName, l.openingHours, l.status, l.source, l.note].map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stylenow-leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const invite = (l: Lead) => `${window.location.origin}${(process.env.NEXT_PUBLIC_BASE_PATH ?? '')}/partner?lead=${encodeURIComponent(l.id)}`;

  const setLeadStatus = async (l: Lead, s: LeadStatus) => {
    await apiAdminUpdateLead(l.id, { status: s });
    setLeads((cur) => cur?.map((x) => (x.id === l.id ? { ...x, status: s } : x)) ?? null);
  };

  if (error === 'unauthorized' || error === 'admin_not_configured') {
    return (
      <div className="adm-gate panel">
        <p>{t('ld_need_key')}</p>
        <Link className="btn btn-primary" href="/admin">{t('adm_title')}</Link>
      </div>
    );
  }

  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, (leads ?? []).filter((l) => l.status === s).length]));
  return (
    <div className="adm">
      <div className="adm-head">
        <h1>📇 {t('ld_title')}</h1>
        <div className="adm-head-tools">
          <Link className="btn btn-ghost sm" href="/admin">← {t('adm_title')}</Link>
        </div>
      </div>
      <p className="adm-muted">{t('ld_sub')}</p>

      <div className="panel" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="btn btn-primary sm" style={{ cursor: 'pointer' }}>
          ⬆ {t('ld_import')}
          <input type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </label>
        <button className="btn btn-soft sm" onClick={exportCsv} disabled={!shown.length}>⬇ {t('ld_export')}</button>
        <span className="adm-muted" style={{ fontSize: '0.8rem' }}>{t('ld_columns')}: {CSV_COLUMNS.join(', ')}</span>
        {msg && <span>{msg}</span>}
      </div>

      <div className="filter-row" style={{ flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder={t('ld_search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`chip ${status === 'all' ? 'on-primary' : ''}`} onClick={() => setStatus('all')}>{t('ld_all')} · {leads?.length ?? 0}</button>
        {LEAD_STATUSES.map((s) => (
          <button key={s} className={`chip ${status === s ? 'on-primary' : ''}`} onClick={() => setStatus(s)}>
            {t(`ld_st_${s}` as MsgKey)} · {counts[s]}
          </button>
        ))}
        <label className="chip" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={withEmail} onChange={(e) => setWithEmail(e.target.checked)} /> ✉ {t('ld_with_email')}
        </label>
      </div>

      {!leads ? (
        <p className="adm-muted">…</p>
      ) : !shown.length ? (
        <div className="empty"><div className="big">📇</div><p>{t('ld_empty')}</p></div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ld-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>{t('ld_c_salon')}</th><th>{t('ld_c_address')}</th><th>{t('ld_c_contact')}</th><th>{t('ld_c_status')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--line, rgba(127,127,127,.2))', verticalAlign: 'top' }}>
                  <td style={{ padding: '8px 6px 8px 0' }}>
                    <b>{l.name}</b>
                    <div className="adm-muted">{l.category}{l.ownerName ? ` · ${l.ownerName}` : ''}</div>
                  </td>
                  <td>{l.street}<div className="adm-muted">{l.postcode} {l.district}</div></td>
                  <td>
                    {l.phone && <div><a href={`tel:${l.phone.replace(/[^+\d]/g, '')}`}>📞 {l.phone}</a></div>}
                    {l.email && <div><a href={`mailto:${l.email}`}>✉ {l.email}</a></div>}
                    {l.website && <div><a href={l.website.startsWith('http') ? l.website : `https://${l.website}`} target="_blank" rel="noreferrer">🌐 {l.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 32)}</a></div>}
                    {l.instagram && <div><a href={l.instagram} target="_blank" rel="noreferrer">📷 Instagram</a></div>}
                  </td>
                  <td>
                    <select className="input" value={l.status} onChange={(e) => void setLeadStatus(l, e.target.value as LeadStatus)}>
                      {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(`ld_st_${s}` as MsgKey)}</option>)}
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn btn-soft sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(invite(l));
                        setMsg('✓ ' + t('ld_link_copied', { name: l.name }));
                        if (l.status === 'new' || l.status === 'contacted' || l.status === 'interested') void setLeadStatus(l, 'invited');
                      }}
                    >
                      🔗 {t('ld_invite')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
