/**
 * CSV for German spreadsheets — which is its own dialect.
 *
 * Excel in a German locale expects a semicolon separator (the comma is the
 * decimal sign there) and only recognises UTF-8 through a BOM; without both,
 * umlauts shred and every row lands in one column. Fields are quoted whenever
 * they carry the separator, quotes or newlines, per RFC 4180 quoting rules.
 * Money is written as "12,34" — the decimal comma, no currency sign; the
 * column header says EUR once.
 */

const SEP = ';';

function field(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: string[][]): string {
  // BOM first — the difference between "ü" and "Ã¼" in Excel.
  return '\uFEFF' + rows.map((r) => r.map(field).join(SEP)).join('\r\n') + '\r\n';
}

/** cents → "12,34" (decimal comma, no sign, empty for zero-optional columns) */
export function eurDe(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}
