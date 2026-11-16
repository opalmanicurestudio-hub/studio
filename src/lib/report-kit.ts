// src/lib/report-kit.ts — A REPORT ANYONE CAN READ (design canvas "Food numbers": One report, read in a minute; Every
// report, the same six parts). Every report is one shape, so each reads the same way: what it is (one line, who it's
// for); the numbers that matter (three to five, each with a line on what it means and how it compares); one picture
// when it shows something; what's worth a look, in a sentence each; the detail as a table with its totals; and how to
// read it. The spreadsheet (CSV) is made from the same table, so the file and the page never disagree: one row each,
// plain numbers with no $ signs, no totals row (a spreadsheet adds its own). Made on the server (lib/records-reports),
// shown by components/reports/ReportView. Pure.
import { monthWords, toCsv } from '@/lib/records';

export type Cell = string | number | null;
export type ColKind = 'text' | 'date' | 'month' | 'money' | 'price' | 'count' | 'num' | 'pct';
export type Col = { label: string; kind: ColKind; /** summed in the totals row */ total?: boolean };
export type Tone = 'ok' | 'warn';
export type Kpi = { label: string; value: string; note?: string; tone?: Tone };
export type BarTone = 'main' | 'soft' | 'warn';
export type Bar = { label: string; value: number; tone: BarTone; tip?: string };
export type Chart = { title: string; money: boolean; bars: Bar[]; avg?: { value: number; label: string } | null; legend?: { tone: BarTone; label: string }[];
  /** day labels ("Oct 1") under every seventh bar, instead of each bar's own */ days?: boolean };
export type Note = { text: string; tone: 'warn' | 'plain'; href?: string; link?: string };
export type Report = {
  kind: string; title: string; group: string; what: string; month: string; monthWords: string; business: string; madeAt: string;
  kpis: Kpi[]; chart: Chart | null; notes: Note[]; columns: Col[]; rows: Cell[][]; totals: Cell[] | null;
  glossary: [string, string][]; file: string; empty: string;
};

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const r2 = (n: number) => Math.round(num(n) * 100) / 100;

/** "$1,234.50", or "−$12.50". */
export const dollars = (v: number, cents = true) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
/** "$55,472" for a big number, "$412.50" for a small one. */
export const kpiDollars = (v: number) => dollars(v, Math.abs(v) < 1000);
/** "16.4%". */
export const pct = (v: number, places = 1) => `${(num(v) * 100).toFixed(places).replace(/\.0$/, '')}%`;
/** "Oct 3", from "2026-10-03". */
export const dayWords = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** "Saturday, Oct 31". */
export const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
/** 0 Sunday … 6 Saturday. */
export const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
/** "a and b", "a, b and c". */
export const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** How a change reads: "Up 6% on September", "Down 3% on September", "About the same as September". */
export function changeWords(now: number, before: number, label: string): { text: string; tone?: Tone } | null {
  if (!(before > 0)) return null; const d = (now - before) / before;
  if (Math.abs(d) < 0.01) return { text: `About the same as ${label}.` };
  return { text: `${d > 0 ? 'Up' : 'Down'} ${Math.round(Math.abs(d) * 100)}% on ${label}.`, tone: d > 0 ? 'ok' : undefined };
}

/** One cell, as the page and the printout show it. */
export function cellText(c: Col, v: Cell): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return c.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? dayWords(v) : c.kind === 'month' && /^\d{4}-\d{2}$/.test(v) ? monthWords(v) : v;
  if (c.kind === 'money') return dollars(v);
  // What one costs, which can be a fraction of a cent (a ml of syrup): to four places, two at least.
  if (c.kind === 'price') return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  if (c.kind === 'pct') return pct(v);
  if (c.kind === 'count') return Math.round(v).toLocaleString('en-US');
  return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
/** The totals row: each column marked `total` added up (money to the cent); the first says what it is. */
export function totalsOf(cols: Col[], rows: Cell[][], label: string): Cell[] | null {
  if (!rows.length || !cols.some((c) => c.total)) return null;
  return cols.map((c, i) => (i === 0 ? label : c.total ? r2(rows.reduce((s, r) => s + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0)) : null));
}
/** The spreadsheet: the table's columns and rows, as they are (no totals row). */
export const reportCsv = (r: Pick<Report, 'columns' | 'rows'>) => toCsv(r.columns.map((c) => c.label), r.rows);
/** The file's name: "north-loft-nightly-closes-2026-10.csv". */
export const fileName = (business: string, what: string, month: string) => `${String(business || 'records').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'records'}-${what}-${month}.csv`;

/** The reports, in the order Records lists them. */
export const RECORD_REPORTS: { kind: string; title: string; group: string }[] = [
  { kind: 'nights', title: 'Nightly closes', group: 'Money' },
  { kind: 'tips', title: 'Tips by person', group: 'People' },
  { kind: 'declared', title: 'Cash tips declared', group: 'People' },
  { kind: 'stock', title: 'Stock value', group: 'Stock' },
  { kind: 'purchases', title: 'Orders received, by supplier', group: 'Stock' },
  { kind: 'adjustments', title: 'Comps and voids by person', group: 'Stock' },
];
export const isRecordReport = (k: unknown) => RECORD_REPORTS.some((x) => x.kind === k);
