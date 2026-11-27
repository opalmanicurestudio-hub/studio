// src/lib/csv.ts — A SPREADSHEET DOWNLOAD (the Reports tab's Download): rows as a CSV file that opens in Excel, Numbers
// and Google Sheets. A cell starting with =, +, - or @ that isn't a number is kept as text, so a name or a note can
// never run as a formula in someone's spreadsheet.
export type Cell = string | number | null | undefined;

const safe = (v: Cell): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The rows as CSV text (with the mark Excel looks for, so accents and ’ come through). */
export function toCsv(rows: Cell[][]): string {
  return '﻿' + rows.map((r) => r.map(safe).join(',')).join('\r\n') + '\r\n';
}

/** A file name from words: "North Loft profit and loss 2026-10" → north-loft-profit-and-loss-2026-10.csv */
export const csvName = (...parts: string[]) => `${parts.join(' ').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report'}.csv`;

/** Downloads the rows as a CSV file (in the browser). */
export function downloadCsv(name: string, rows: Cell[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
