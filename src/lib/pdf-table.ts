// src/lib/pdf-table.ts — READING A PDF REPORT (Moving in). Some apps only hand over reports as PDFs (a gift card
// liability report, a membership list). A PDF has no table — just words placed on a page — so the rows are rebuilt:
// words on the same line become a row, and the columns come from where the header row's words sit. The result goes
// through the same preview as a spreadsheet, so anything read wrong is seen before it's saved. A scanned PDF (a picture
// of a page) has no words to read; that's said plainly.

export type PdfWord = { str: string; x: number; y: number; w: number; page: number };

/** Words → table rows. Pure (checked in scripts/verify). */
export function wordsToRows(words: PdfWord[]): string[][] { return wordsToTable(words).rows; }

export type PdfTotals = { kind: 'grand' | 'total' | 'subtotal'; byColumn: Record<number, number> };
const money = (s: string): number | null => { const t = String(s || '').replace(/[\s$€£,]/g, ''); const neg = /^\(.*\)$/.test(t) || t.startsWith('-'); const m = /^\(?-?(\d+(?:\.\d+)?)\)?$/.exec(t); return m ? (neg ? -1 : 1) * Number(m[1]) : null; };

/** Words → rows, plus the report's own totals line(s) — used as a check, never as a row. */
export function wordsToTable(words: PdfWord[]): { rows: string[][]; totals: PdfTotals | null } {
  const ws = words.filter((w) => w.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  // 1. Lines: words within 3 points of each other vertically (same page).
  const lines: PdfWord[][] = [];
  for (const w of ws) { const last = lines[lines.length - 1]; if (last && last[0].page === w.page && Math.abs(last[0].y - w.y) <= 3) last.push(w); else lines.push([w]); }
  // 2. Within a line, words close together are one cell ("Maria" "Lopez" → "Maria Lopez"); a wide gap starts a new cell.
  const cellsOf = (line: PdfWord[]) => { const sorted = [...line].sort((a, b) => a.x - b.x); const cells: { text: string; x: number; end: number }[] = [];
    for (const w of sorted) { const c = cells[cells.length - 1]; const gap = c ? w.x - c.end : Infinity; const space = Math.max(4, (w.w / Math.max(1, w.str.length)) * 1.6);
      if (c && gap < space) { c.text += (gap > 0.5 ? ' ' : '') + w.str; c.end = w.x + w.w; } else cells.push({ text: w.str, x: w.x, end: w.x + w.w }); }
    return cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })); };
  const all = lines.map((l) => ({ cells: cellsOf(l), y: l[0].y, page: l[0].page })).filter((r) => r.cells.length);
  if (!all.length) return { rows: [], totals: null };
  const rows = all.map((r) => r.cells);
  // 3. Columns: the header is the first row with the most cells among the first lines (titles above it have fewer).
  const top = rows.slice(0, 15); const most = Math.max(...top.map((r) => r.length)); if (most < 2) return { rows: [], totals: null };
  const hi = rows.findIndex((r) => r.length === most); const header = rows[hi];
  const starts = header.map((c) => c.x); const mids = starts.map((x, i) => (i ? (header[i - 1].end + x) / 2 : -Infinity));
  const colOf = (x: number, end: number) => { const center = (x + end) / 2; let k = 0; for (let i = 0; i < mids.length; i++) if (center >= mids[i] - 2 || x >= mids[i]) k = i; return k; };
  // The usual gap between table lines — a wrapped cell sits one line-gap under its row, a footer much further down.
  const gaps: number[] = []; for (let i = hi + 1; i < all.length; i++) if (all[i].page === all[i - 1].page) gaps.push(all[i - 1].y - all[i].y);
  const lineGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 14;
  const out: string[][] = [header.map((c) => c.text)]; const totalRows: { kind: PdfTotals['kind']; cells: string[] }[] = [];
  let last: { line: (typeof all)[number]; cells: string[] } | null = null;
  for (const line of all.slice(hi + 1)) {
    const r = line.cells;
    if (r.length === header.length && r.every((c, i) => c.text === header[i].text)) { last = null; continue; }   // the header again on a new page
    const cells = Array(header.length).fill(''); for (const c of r) { const k = colOf(c.x, c.end); cells[k] = cells[k] ? `${cells[k]} ${c.text}` : c.text; }
    const filled = cells.filter(Boolean);
    if (/^(total|totals|grand total|subtotal|page \d+)/i.test(cells[0])) {
      const kind = /^grand/i.test(cells[0]) ? 'grand' : /^sub/i.test(cells[0]) ? 'subtotal' : /^page/i.test(cells[0]) ? null : 'total';
      if (kind) totalRows.push({ kind, cells }); last = null; continue;
    }
    if (filled.length < 2) {
      // A cell that spilled onto a second line ("Alexandra Montgomery-" / "Reyes"): one cell, right under a row, in a
      // column that row already has words in. It joins that row instead of being lost. Anything else — page numbers,
      // footers, section titles further down — is still left out.
      const k = cells.findIndex(Boolean); const text = cells[k] || '';
      if (last && line.page === last.line.page && last.line.y - line.y <= lineGap * 1.5 && last.cells[k] && money(text) === null && !/^page\b/i.test(text)) {
        last.cells[k] = /-$/.test(last.cells[k]) ? `${last.cells[k]}${text}` : `${last.cells[k]} ${text}`; last.line = line;
      }
      continue;
    }
    out.push(cells); last = { line, cells };
  }
  // 4. The report's own totals: a grand total wins; otherwise the total lines added up (one per page); otherwise subtotals.
  const pick = totalRows.some((t) => t.kind === 'grand') ? totalRows.filter((t) => t.kind === 'grand').slice(-1) : totalRows.some((t) => t.kind === 'total') ? totalRows.filter((t) => t.kind === 'total') : totalRows;
  let totals: PdfTotals | null = null;
  if (pick.length) { const byColumn: Record<number, number> = {}; for (const t of pick) t.cells.forEach((v, i) => { if (!i) return; const n = money(v); if (n !== null) byColumn[i] = Math.round(((byColumn[i] || 0) + n) * 100) / 100; });
    if (Object.keys(byColumn).length) totals = { kind: pick[0].kind, byColumn }; }
  return { rows: out, totals };
}

/** Does what we read add up to the report's own totals? One line per money column the report totals. */
export function totalsCheck(rows: string[][], totals: PdfTotals | null): { column: string; report: number; read: number; ok: boolean }[] {
  if (!totals || rows.length < 2) return [];
  return Object.entries(totals.byColumn).map(([k, report]) => { const i = Number(k);
    const read = Math.round(rows.slice(1).reduce((s, r) => s + (money(r[i] || '') ?? 0), 0) * 100) / 100;
    return { column: rows[0][i] || `Column ${i + 1}`, report, read, ok: Math.abs(read - report) < 0.01 }; });
}

/** Read a PDF file in the browser into table rows (with the report's totals alongside, for the check). */
export async function readPdfRows(file: File): Promise<string[][] & { totals?: PdfTotals | null }> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; const words: PdfWord[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 200); p++) { const page = await doc.getPage(p); const tc = await page.getTextContent();
    for (const it of tc.items as any[]) if (it.str) words.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || it.str.length * 5, page: p }); }
  if (!words.length) throw new Error('This PDF is a picture of a page (scanned), so there are no words to read. Ask your old app for the same report as CSV or Excel.');
  const { rows, totals } = wordsToTable(words);
  if (rows.length < 2) throw new Error('We couldn’t find a table in this PDF. Ask your old app for the same report as CSV or Excel.');
  return Object.assign(rows, { totals });
}
