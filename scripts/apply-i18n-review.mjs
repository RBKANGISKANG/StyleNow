import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/apply-i18n-review.mjs docs/i18n-review/<code>.csv');
const code = path.basename(file, '.csv');
const target = path.join('apps/web/src/lib/locales', `${code}.json`);

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const placeholders = (s) => (s.match(/\{[a-zA-Z_]+\}/g) || []).sort().join();
const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const col = (name) => header.indexOf(name);
const catalogue = JSON.parse(fs.readFileSync(target, 'utf8'));
let applied = 0;
for (const r of rows) {
  const key = r[col('key')], english = r[col('english')] ?? '', fix = (r[col('reviewer_correction')] ?? '').trim();
  if (!key || !fix) continue;
  if (placeholders(fix) !== placeholders(english)) {
    console.error(`skipped ${key}: placeholders must be ${placeholders(english) || 'none'}`);
    continue;
  }
  catalogue[key] = fix;
  applied++;
}
fs.writeFileSync(target, JSON.stringify(catalogue));
console.log(`${code}: applied ${applied} corrections to ${target}`);
