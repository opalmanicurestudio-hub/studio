// src/lib/pdf-table.ts — READING A PDF REPORT (Moving in). Some apps only hand over reports as PDFs (a gift card
// liability report, a membership list). A PDF has no table — just words placed on a page — so the rows are rebuilt:
// words on the same line become a row, and the columns come from where the header row's words sit. The result goes
// through the same preview as a spreadsheet, so anything read wrong is seen before it's saved. A scanned PDF (a picture
// of a page) has no words to read; that's said plainly.

export type PdfWord = { str: string; x: number; y: number; w: number; page: number };

/** Words → table rows. Pure (checked in scripts/verify). */
export function wordsToRows(words: PdfWord[]): string[][] {
  const ws = words.filter((w) => w.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  // 1. Lines: words within 3 points of each other vertically (same page).
  const lines: PdfWord[][] = [];
  for (const w of ws) { const last = lines[lines.length - 1]; if (last && last[0].page === w.page && Math.abs(last[0].y - w.y) <= 3) last.push(w); else lines.push([w]); }
  // 2. Within a line, words close together are one cell ("Maria" "Lopez" → "Maria Lopez"); a wide gap starts a new cell.
  const cellsOf = (line: PdfWord[]) => { const sorted = [...line].sort((a, b) => a.x - b.x); const cells: { text: string; x: number; end: number }[] = [];
    for (const w of sorted) { const c = cells[cells.length - 1]; const gap = c ? w.x - c.end : Infinity; const space = Math.max(4, (w.w / Math.max(1, w.str.length)) * 1.6);
      if (c && gap < space) { c.text += (gap > 0.5 ? ' ' : '') + w.str; c.end = w.x + w.w; } else cells.push({ text: w.str, x: w.x, end: w.x + w.w }); }
    return cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })); };
  const rows = lines.map(cellsOf).filter((r) => r.length);
  if (!rows.length) return [];
  // 3. Columns: the header is the first row with the most cells among the first lines (titles above it have fewer).
  const top = rows.slice(0, 15); const most = Math.max(...top.map((r) => r.length)); if (most < 2) return [];
  const hi = rows.findIndex((r) => r.length === most); const header = rows[hi];
  const starts = header.map((c) => c.x); const mids = starts.map((x, i) => (i ? (header[i - 1].end + x) / 2 : -Infinity));
  const colOf = (x: number, end: number) => { const center = (x + end) / 2; let k = 0; for (let i = 0; i < mids.length; i++) if (center >= mids[i] - 2 || x >= mids[i]) k = i; return k; };
  const out: string[][] = [header.map((c) => c.text)];
  for (const r of rows.slice(hi + 1)) {
    if (r.length === header.length && r.every((c, i) => c.text === header[i].text)) continue;   // the header again on a new page
    const cells = Array(header.length).fill(''); for (const c of r) { const k = colOf(c.x, c.end); cells[k] = cells[k] ? `${cells[k]} ${c.text}` : c.text; }
    if (cells.filter(Boolean).length < 2) continue;   // page numbers, footers, section titles
    if (/^(total|totals|grand total|subtotal|page \d+)/i.test(cells[0])) continue;
    out.push(cells);
  }
  return out;
}

/** Read a PDF file in the browser into table rows. */
export async function readPdfRows(file: File): Promise<string[][]> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; const words: PdfWord[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 200); p++) { const page = await doc.getPage(p); const tc = await page.getTextContent();
    for (const it of tc.items as any[]) if (it.str) words.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || it.str.length * 5, page: p }); }
  if (!words.length) throw new Error('This PDF is a picture of a page (scanned), so there are no words to read. Ask your old app for the same report as CSV or Excel.');
  const rows = wordsToRows(words);
  if (rows.length < 2) throw new Error('We couldn’t find a table in this PDF. Ask your old app for the same report as CSV or Excel.');
  return rows;
}
