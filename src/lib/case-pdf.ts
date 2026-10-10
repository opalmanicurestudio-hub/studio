// src/lib/case-pdf.ts — THE RECORDS A CASE KEEPS, as PDFs (letter size): the CASE RECORD (everything about the case —
// what the client said, the visit, the fair-use checks, every step with who and when, the fix and what it cost) and,
// for safety cases, the INCIDENT REPORT (what happened, tools and hygiene record, who was there, signed statements,
// the 48-hour check-in, manager sign-off). Closed cases print as final; later notes are listed underneath, dated.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const W = 612, H = 792, M = 44;
const INK = rgb(0.086, 0.09, 0.102), MUTED = rgb(0.427, 0.439, 0.459), LINE = rgb(0.925, 0.925, 0.933), SOFT = rgb(0.965, 0.965, 0.969), RED = rgb(0.706, 0.137, 0.094), PINK = rgb(0.992, 0.925, 0.925);
const hex = (h: string) => { const n = parseInt(String(h || '#16171a').replace('#', ''), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const safe = (s: any) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/×/g, 'x').replace(/…/g, '...').replace(/·/g, '-').replace(/✓/g, '+').replace(/[^\x20-\x7E\n]/g, '');
const when = (iso: any, tz: string) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : ''; };
const day = (iso: any, tz: string) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }) : ''; };

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = []; for (const para of safe(text).split('\n')) { let cur = ''; for (const w of para.split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (font.widthOfTextAtSize(t, size) > max && cur) { out.push(cur); cur = w; } else cur = t; } out.push(cur); } return out;
}

export async function casePdf(c: any, business: { name: string; accent: string; address?: string; timezone?: string }, kind: 'record' | 'incident'): Promise<Uint8Array> {
  const tz = business.timezone || 'America/New_York';
  const doc = await PDFDocument.create(); const R = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(safe(`${kind === 'incident' ? 'Incident report' : 'Case record'} ${c.number}`)); doc.setCreator(safe(business.name));
  const A = hex(business.accent); let page: PDFPage = doc.addPage([W, H]); let y = H - M; let pageNo = 1;
  const text = (s: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: any; right?: boolean } = {}) => { const size = o.size ?? 10, font = o.font ?? R; const t = safe(s); page.drawText(t, { x: o.right ? x - font.widthOfTextAtSize(t, size) : x, y: yy, size, font, color: o.color ?? INK }); };
  const footer = () => { page.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.6, color: LINE }); text(c.locked ? `Final - closed ${day(c.closedAt, tz)}. Later notes are dated and listed at the end.` : 'Open case - this copy shows the case as of the date printed.', M, 22, { size: 7.5, color: MUTED }); text(`${c.number} - page ${pageNo} - printed ${day(new Date().toISOString(), tz)}`, W - M, 22, { size: 7.5, color: MUTED, right: true }); };
  const need = (h: number) => { if (y - h < 52) { footer(); page = doc.addPage([W, H]); pageNo++; y = H - M; } };
  const para = (s: string, o: { size?: number; color?: any; font?: PDFFont; indent?: number } = {}) => { const size = o.size ?? 10; for (const l of wrap(s, o.font ?? R, size, W - 2 * M - (o.indent || 0))) { need(size + 4); text(l, M + (o.indent || 0), y, { size, color: o.color, font: o.font }); y -= size + 4; } };
  const section = (t: string) => { need(30); y -= 6; text(t, M, y, { size: 11.5, font: B }); y -= 5; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.1, color: INK }); y -= 14; };
  const kv = (pairs: [string, string][]) => { const col = (W - 2 * M) / pairs.length; need(34); pairs.forEach(([k, v], i) => { text(k.toUpperCase(), M + i * col, y, { size: 7, font: B, color: MUTED }); for (const [j, l] of wrap(v || '-', B, 10, col - 10).slice(0, 2).entries()) text(l, M + i * col, y - 13 - j * 12, { size: 10, font: B }); }); y -= 42; };

  // Header
  page.drawRectangle({ x: M, y: y - 34, width: 34, height: 34, color: A });
  const ini = safe(business.name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); text(ini, M + 17 - B.widthOfTextAtSize(ini, 12) / 2, y - 22, { size: 12, font: B, color: rgb(1, 1, 1) });
  text(business.name, M + 46, y - 12, { size: 14, font: B }); if (business.address) text(business.address, M + 46, y - 26, { size: 8.5, color: MUTED });
  text(kind === 'incident' ? 'Incident report' : 'Case record', W - M, y - 12, { size: 16, font: B, right: true }); text(kind === 'incident' ? `INC for ${c.number}` : c.number, W - M, y - 26, { size: 8.5, color: MUTED, right: true });
  y -= 48; page.drawRectangle({ x: M, y, width: W - 2 * M, height: 4, color: kind === 'incident' ? RED : A }); y -= 24;
  const v = c.visit || {};

  if (kind === 'incident') {
    const i = c.incident || {};
    page.drawRectangle({ x: M, y: y - 8, width: W - 2 * M, height: 22, color: PINK }); text(`${c.reasonLabel}${c.words ? ` - "${String(c.words).slice(0, 90)}"` : ''}`, M + 8, y, { size: 10, font: B, color: RED }); y -= 30;
    kv([['Date of visit', day(v.startTime, tz)], ['Where', i.where || v.station || '-'], ['Client', c.clientName], ['Provider', v.providerName || '-']]);
    section('What happened'); para(i.whatHappened || c.words || '-');
    section('Tools and hygiene record'); para([i.kit ? `Kit / tools: ${i.kit}` : '', i.cycle ? `Sterilization record: ${i.cycle}` : '', v.products?.length ? `Products: ${v.products.join(', ')}` : ''].filter(Boolean).join('\n') || 'Not recorded yet.');
    section('First aid and advice given'); para([i.firstAid, i.advice].filter(Boolean).join('\n') || 'Not recorded yet.');
    section('Who was there'); para((i.present || []).join(', ') || [v.providerName, c.clientName].filter(Boolean).join(', '));
    section('Statements'); if (!(i.statements || []).length) para('No statements yet.', { color: MUTED });
    for (const s of i.statements || []) { para(`${s.by}, ${when(s.at, tz)}${s.signed ? ' (signed)' : ''}:`, { font: B, size: 9.5 }); para(`"${s.text}"`, { indent: 10, size: 9.5 }); y -= 4; }
    section('48-hour check-in'); para(i.checkIn48At ? `${when(i.checkIn48At, tz)}: ${i.checkIn48Note || 'done'}` : 'Not done yet.', { color: i.checkIn48At ? INK : RED });
    section('Sign-off'); need(40); y -= 18;
    page.drawLine({ start: { x: M, y }, end: { x: M + 220, y }, thickness: 0.8, color: INK }); page.drawLine({ start: { x: W - M - 220, y }, end: { x: W - M, y }, thickness: 0.8, color: INK });
    text(i.signedOffBy ? `Manager: ${i.signedOffBy}, ${day(i.signedOffAt, tz)}` : 'Manager sign-off (pending)', M, y - 12, { size: 8.5, color: MUTED }); text(`Provider: ${(i.statements || []).find((s: any) => s.by === v.providerName)?.by || v.providerName || '-'}`, W - M - 220, y - 12, { size: 8.5, color: MUTED }); y -= 28;
  } else {
    kv([['Client', c.clientName], ['Visit', `${v.serviceName || '-'}${v.startTime ? `, ${day(v.startTime, tz)}` : ''}`], ['Provider', v.providerName || '-'], ['Outcome', c.fix ? c.fix.label : c.status === 'closed' ? 'Closed' : 'Open']]);
    kv([['Heard via', ({ call: 'Phone call', staff: 'Provider', desk: 'Front desk', survey: 'Visit rating', link: 'Visit link' } as any)[c.via] || c.via], ['Owner', c.ownerName || '-'], ['First reply', c.firstReplyAt ? when(c.firstReplyAt, tz) : '-'], ['Closed', c.closedAt ? day(c.closedAt, tz) : 'Open']]);
    section('What the client said'); para(c.words ? `"${c.words}"` : c.reasonLabel); if (c.photos?.length) para(`${c.photos.length} photo${c.photos.length === 1 ? '' : 's'} on file.`, { color: MUTED, size: 9 }); if (c.voice) para(`Voice note on file${c.voice.language ? ` (${c.voice.language})` : ''}${c.voice.translation ? `. Translation: "${c.voice.translation}"` : ''}.`, { color: MUTED, size: 9 });
    section('The visit'); para([v.paid != null ? `Paid $${Number(v.paid).toFixed(2)}${v.tip ? ` + $${Number(v.tip).toFixed(2)} tip` : ''}${v.cardLast4 ? `, card ending ${v.cardLast4}` : ''}.` : '', v.products?.length ? `Products: ${v.products.join(', ')}.` : '', v.station ? `Station: ${v.station}.` : ''].filter(Boolean).join(' ') || 'No visit linked.');
    section('Fair-use check'); for (const k of c.checks || []) para(`${k.ok ? '[ok]' : '[!]'} ${k.title} - ${k.detail}`, { size: 9.5, color: k.ok ? INK : RED });
    section('The fix'); para(c.fix ? `${c.fix.label}${c.fix.amountCents ? ` $${(c.fix.amountCents / 100).toFixed(2)}` : ''}. Chosen by ${c.fix.by || '-'}${c.fix.approvedBy ? `, approved by ${c.fix.approvedBy}` : ''} on ${when(c.fix.at, tz)}.` : 'No fix chosen yet.');
    if (c.messages?.length) { section('Messages to the client'); for (const m of c.messages) para(`${when(m.at, tz)} - ${m.by}: "${m.text}"`, { size: 9.5 }); }
  }
  section('Every step'); for (const t of c.timeline || []) { need(14); text(when(t.at, tz), M, y, { size: 8.5, color: MUTED }); text(String(t.by || '').slice(0, 24), M + 110, y, { size: 8.5, font: B }); const ls = wrap(t.text || '', R, 8.5, W - 2 * M - 220); ls.forEach((l, i) => { if (i) { need(12); } text(l, M + 220, y, { size: 8.5 }); y -= 11; }); y -= 3; }
  if (c.addenda?.length) { section('Added after closing'); for (const a of c.addenda) para(`${when(a.at, tz)} - ${a.by}: ${a.text}`, { size: 9.5 }); }
  footer(); return doc.save();
}
