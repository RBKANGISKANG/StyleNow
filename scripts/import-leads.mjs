#!/usr/bin/env node
/**
 * Upload a leads CSV to a running StyleNow server (same as the admin "Import" button).
 *
 *   node scripts/import-leads.mjs db/leads/wandsbek-leads.csv --url https://your-site --key $STYLENOW_ADMIN_KEY
 *
 * Re-running is safe: leads are matched on id (or name + street) and updated,
 * and a status your sales team set is never overwritten.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const url = opt('url', process.env.STYLENOW_URL ?? 'http://localhost:3000');
const key = opt('key', process.env.STYLENOW_ADMIN_KEY ?? '');
if (!file || !key) {
  console.error('usage: node scripts/import-leads.mjs <file.csv|file.json> --url <server> --key <admin key>');
  process.exit(1);
}

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(head.map((k, i) => [k.trim(), (r[i] ?? '').trim()])));
}

const text = fs.readFileSync(file, 'utf8');
const rows = file.endsWith('.json') ? JSON.parse(text) : parseCsv(text);
const res = await fetch(`${url.replace(/\/$/, '')}/api/admin/leads`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': key },
  body: JSON.stringify({ rows }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error('import failed:', res.status, body); process.exit(1); }
console.log(`${rows.length} rows → ${body.added} added, ${body.updated} updated, ${body.skipped} skipped`);
