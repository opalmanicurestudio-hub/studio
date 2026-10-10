// src/lib/pay-stub-pdf.ts — THE PAY STUB AS A PDF (letter size): page 1 is the statement — the business, the person,
// the period and payday, the total, where it came from, hours and notes; the pages after list EVERY line (visits,
// retail, tips, adjustments, period items, shifts) with how each was worked out, ending with the check that the lines
// add up to the total. Uses the business's colour.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Stub } from '@/lib/pay-stub';
import type { AuditLine } from '@/lib/pay-audit';

const W = 612, H = 792, M = 44;
const money = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(Math.round((v || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hex = (h: string) => { const n = parseInt(h.replace('#', ''), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const INK = rgb(0.086, 0.09, 0.102), MUTED = rgb(0.427, 0.439, 0.459), LINE = rgb(0.925, 0.925, 0.933), SOFT = rgb(0.965, 0.965, 0.969);
const day = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
// The standard PDF fonts only cover basic Latin — swap the typographic characters we use for plain ones.
const safe = (s: any) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/×/g, 'x').replace(/…/g, '...').replace(/·/g, '-').replace(/[^\x20-\x7E]/g, '');

function fit(text: string, font: PDFFont, size: number, max: number) { let t = safe(text); if (font.widthOfTextAtSize(t, size) <= max) return t; while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > max) t = t.slice(0, -1); return `${t}...`; }

export async function stubPdf(stub: Stub, business: { name: string; accent: string; address?: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create(); doc.setTitle(safe(`Earnings statement - ${stub.name} - ${stub.period.from} to ${stub.period.to}`)); doc.setCreator(safe(business.name));
  const R = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  const A = hex(business.accent || '#16171a'); const ref = `PS-${stub.period.to.replace(/-/g, '')}-${stub.staffId.slice(0, 6).toUpperCase()}`;
  let page: PDFPage = doc.addPage([W, H]); let y = H - M; let pageNo = 1;
  const text = (s: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: any; right?: boolean; max?: number } = {}) => {
    const size = o.size ?? 9, font = o.font ?? R; const t = o.max ? fit(s, font, size, o.max) : safe(s); const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: o.right ? x - w : x, y: yy, size, font, color: o.color ?? INK }); };
  const footer = () => { page.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.6, color: LINE });
    text('Earnings before taxes and deductions. Your official payslip comes from your payroll provider.', M, 22, { size: 7.5, color: MUTED });
    text(`${ref}  -  page ${pageNo}`, W - M, 22, { size: 7.5, color: MUTED, right: true }); };
  const newPage = () => { footer(); page = doc.addPage([W, H]); pageNo++; y = H - M;
    text(`${business.name}  -  ${stub.name}  -  ${day(stub.period.from)} - ${longDay(stub.period.to)}`, M, y, { size: 8, color: MUTED }); y -= 20; };
  const need = (h: number) => { if (y - h < 50) newPage(); };

  // ── Page 1: the statement ──
  page.drawRectangle({ x: M, y: y - 34, width: 34, height: 34, color: A });
  const ini = business.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  text(ini, M + 17 - B.widthOfTextAtSize(safe(ini), 12) / 2, y - 22, { size: 12, font: B, color: rgb(1, 1, 1) });
  text(business.name, M + 46, y - 12, { size: 14, font: B }); if (business.address) text(business.address, M + 46, y - 26, { size: 8.5, color: MUTED, max: 260 });
  text('Earnings statement', W - M, y - 12, { size: 16, font: B, right: true }); text(ref, W - M, y - 26, { size: 8.5, color: MUTED, right: true });
  y -= 48; page.drawRectangle({ x: M, y, width: W - 2 * M, height: 4, color: A }); y -= 26;
  const col = (W - 2 * M) / 4; const cell = (i: number, k: string, v: string, sub?: string) => { text(k, M + i * col, y, { size: 7.5, font: B, color: MUTED }); text(v, M + i * col, y - 14, { size: 11, font: B, max: col - 10 }); if (sub) text(sub, M + i * col, y - 26, { size: 8.5, color: MUTED }); };
  cell(0, 'TEAM MEMBER', stub.name, stub.role.replace(/_/g, ' ')); cell(1, 'PAY PERIOD', `${day(stub.period.from)} - ${longDay(stub.period.to)}`);
  cell(2, stub.paid ? 'PAID ON' : 'PAYDAY', longDay(stub.period.payday));
  page.drawRectangle({ x: M + 3 * col - 6, y: y - 34, width: col + 6, height: 50, color: SOFT });
  text('TOTAL BEFORE TAXES', M + 3 * col, y, { size: 7.5, font: B, color: MUTED }); text(money(stub.total), M + 3 * col, y - 22, { size: 18, font: B });
  y -= 56;

  // Where it came from — a bar, then the parts table
  const parts: [string, number, any][] = [['Services', stub.parts.services, A], ['Tips', stub.parts.tips, rgb(0.961, 0.62, 0.043)], ['Retail', stub.parts.retail, rgb(0.333, 0.345, 0.369)], ['Time', stub.parts.time, rgb(0.78, 0.79, 0.82)], ['Other', stub.parts.other, rgb(0.6, 0.62, 0.65)], ['Adjustments', stub.parts.adjustments, rgb(0.12, 0.42, 0.23)]];
  const pos = parts.filter((p) => p[1] > 0); const sumPos = pos.reduce((s, p) => s + p[1], 0) || 1; let x = M;
  for (const p of pos) { const w = ((W - 2 * M) * p[1]) / sumPos; page.drawRectangle({ x, y, width: Math.max(1, w - 2), height: 10, color: p[2] }); x += w; }
  y -= 26;
  text('Earnings', M, y, { size: 11, font: B }); y -= 16;
  const head = (cols: [string, number, boolean?][]) => { for (const [k, xx, r] of cols) text(k, xx, y, { size: 7.5, font: B, color: MUTED, right: !!r }); y -= 5; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: INK }); y -= 13; };
  head([['ITEM', M], ['LINES', M + 300, true], ['THIS PERIOD', W - M, true]]);
  const counts: Record<string, number> = { Services: stub.audit.visits.length, Tips: stub.audit.tips.length, Retail: stub.audit.retail.length, Time: stub.audit.period.filter((x) => ['p:hourly', 'p:training', 'p:salary', 'p:ot', 'p:minwage'].includes(x.ref)).length, Other: stub.audit.period.filter((x) => !['p:hourly', 'p:training', 'p:salary', 'p:ot', 'p:minwage'].includes(x.ref)).length, Adjustments: stub.audit.adjustments.length };
  for (const [k, v] of parts) { if (!v && !counts[k]) continue; text(k, M, y); text(String(counts[k] || ''), M + 300, y, { right: true, color: MUTED }); text(money(v), W - M, y, { right: true }); y -= 6; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE }); y -= 12; }
  text('Total', M, y, { font: B }); text(money(stub.total), W - M, y, { font: B, right: true }); y -= 28;

  text('Time', M, y, { size: 11, font: B }); y -= 16;
  head([['', M], ['HOURS PAID', M + 260, true], ['OVERTIME', M + 380, true], ['SHIFTS', W - M, true]]);
  text('Hours', M, y); text(String(stub.hours), M + 260, y, { right: true }); text(String(stub.overtimeHours), M + 380, y, { right: true }); text(String(stub.audit.shifts.length), W - M, y, { right: true }); y -= 28;

  if (stub.audit.adjustments.length) { text('Adjustments', M, y, { size: 11, font: B }); y -= 16;
    for (const a of stub.audit.adjustments) { text(`${a.title} (${a.detail})`, M, y, { max: 420 }); text(money(a.amount), W - M, y, { right: true }); y -= 14; } y -= 10; }
  const notes = stub.notes.filter((n) => !/^Before taxes/.test(n));
  if (notes.length) { text('Notes', M, y, { size: 11, font: B }); y -= 15; for (const n of notes) { text(n, M, y, { size: 8.5, color: MUTED, max: W - 2 * M }); y -= 12; } y -= 8; }
  const c = stub.audit.check;
  page.drawRectangle({ x: M, y: y - 26, width: W - 2 * M, height: 34, color: SOFT });
  text(`Every line is listed on the following pages: ${c.lines} lines add up to ${money(c.linesTotal)}${c.ok ? (c.rounding ? ` (${money(c.rounding)} rounding)` : '') : ' - please ask your manager to check this stub'}.`, M + 10, y - 12, { size: 8.5, max: W - 2 * M - 20 });

  // ── Every line ──
  newPage();
  text('Every line on this stub', M, y, { size: 14, font: B }); y -= 22;
  const section = (title: string, lines: AuditLine[], showAmount = true) => {
    if (!lines.length) return; need(40); text(`${title} (${lines.length})`, M, y, { size: 11, font: B }); y -= 15;
    head([['DATE', M], ['WHAT', M + 52], ['HOW IT WAS WORKED OUT', M + 250], ...(showAmount ? [['AMOUNT', W - M, true] as [string, number, boolean]] : [])]);
    for (const l of lines) { need(16); text(day(l.date || ''), M, y, { size: 8.5 }); text(l.title, M + 52, y, { size: 8.5, max: 190 }); text(l.detail, M + 250, y, { size: 8, color: MUTED, max: showAmount ? 210 : 270 });
      if (showAmount) text(money(l.amount), W - M, y, { size: 8.5, right: true }); y -= 5; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: LINE }); y -= 11; }
    y -= 10; };
  section('Visits', stub.audit.visits); section('Retail', stub.audit.retail); section('Tips', stub.audit.tips);
  section('Worked out for the period', stub.audit.period); section('Adjustments', stub.audit.adjustments); section('Shifts', stub.audit.shifts, false);
  need(30); page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 1.2, color: INK });
  text('Lines add up to', M, y - 10, { font: B }); text(money(c.linesTotal), W - M, y - 10, { font: B, right: true });
  if (c.rounding) text(`Rounding: ${money(c.rounding)}`, W - M, y - 24, { size: 8, color: MUTED, right: true });
  footer();
  return doc.save();
}
