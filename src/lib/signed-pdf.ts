// src/lib/signed-pdf.ts
//
// SIGNED DOCUMENTS AS PDFs — kept in the student's file.
//   header     school logo, name, legal name, licence
//   body       the EXACT text that was signed (headings, lists)
//   signature  the drawn signature, typed name, time (school's time zone),
//              IP, device, and a SHA-256 fingerprint of the exact text
//   school     the seal; the director's signature once countersigned
//              (agreements show "countersignature pending" until then)
//   footer     "page X of Y" + the fingerprint on every page
// Stored privately (academy/signed/…): staff open them from the student file;
// the student/applicant downloads their own through a 5-minute link.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { getIdentity } from '@/lib/school-identity';
import { tenantTimeZone } from '@/lib/tenant-time';
import { savePrivateDocument, privateBucket } from '@/lib/private-storage';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const SIGNATURE_OK = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export interface SignedPdfInput {
  tenantId: string; title: string; kindLabel: string; text: string;
  signer: { typedName: string; signature?: string | null; at: string; ip?: string | null; userAgent?: string | null; email?: string | null };
  school?: { countersign?: { by: string; at: string } | null; pending?: boolean; note?: string };
}

async function identityImage(tenantId: string, k: 'logo' | 'seal' | 'signature') {
  const d = ((await getAdminDb().doc(`tenants/${tenantId}/schoolIdentity/${k}`).get()).data() as any) || null;
  return typeof d?.dataUrl === 'string' ? d.dataUrl : null;
}
async function embed(pdf: PDFDocument, dataUrl: string | null | undefined): Promise<PDFImage | null> {
  const m = String(dataUrl || '').match(/^data:image\/(png|jpeg);base64,(.+)$/); if (!m) return null;
  try { const bytes = Buffer.from(m[2], 'base64'); return m[1] === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); } catch { return null; }
}
/** Only characters the standard fonts can draw (others become "?"). */
function safeFor(font: PDFFont) { const cache = new Map<string, boolean>(); return (s: string) => [...String(s || '')].map((ch) => { if (ch === '\t') return ' '; if (!cache.has(ch)) { try { font.widthOfTextAtSize(ch, 10); cache.set(ch, true); } catch { cache.set(ch, false); } } return cache.get(ch) ? ch : '?'; }).join(''); }

export async function buildSignedPdf(o: SignedPdfInput) {
  const db = getAdminDb();
  const t = ((await db.doc(`tenants/${o.tenantId}`).get()).data() as any) || {};
  const id = await getIdentity(o.tenantId, t).catch(() => null);
  const tz = tenantTimeZone(t);
  const pdf = await PDFDocument.create(); pdf.setTitle(o.title); pdf.setAuthor(id?.displayName || t.name || 'School'); pdf.setCreator('ClarityFlow');
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = safeFor(font);
  const [logo, seal, dirSig, stuSig] = await Promise.all([identityImage(o.tenantId, 'logo').then((u) => embed(pdf, u)), identityImage(o.tenantId, 'seal').then((u) => embed(pdf, u)), identityImage(o.tenantId, 'signature').then((u) => embed(pdf, u)), embed(pdf, o.signer.signature)]);
  const fp = sha256(o.text);
  const W = 612, H = 792, M = 54, ink = rgb(0.11, 0.1, 0.09), muted = rgb(0.47, 0.44, 0.42);
  let page = pdf.addPage([W, H]); let y = H - M;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const need = (h: number) => { if (y - h < M + 30) newPage(); };
  const wrap = (s: string, f: PDFFont, size: number, width: number) => { const out: string[] = []; for (const para of clean(s).split('\n')) { let line = ''; for (const w of para.split(/\s+/).filter(Boolean)) { const tryL = line ? `${line} ${w}` : w; if (f.widthOfTextAtSize(tryL, size) > width && line) { out.push(line); line = w; } else line = tryL; } out.push(line); } return out; };
  const text = (s: string, x: number, size: number, f = font, color = ink) => page.drawText(clean(s), { x, y, size, font: f, color });
  // (dateStyle/timeStyle can't be combined with timeZoneName — spell the fields out)
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' });

  // Header
  let hx = M;
  if (logo) { const s = logo.scale(Math.min(40 / logo.height, 120 / logo.width)); page.drawImage(logo, { x: M, y: y - s.height + 6, width: s.width, height: s.height }); hx = M + s.width + 12; }
  text(id?.displayName || t.name || 'School', hx, 15, bold); y -= 16;
  const sub = [id?.legalName && id.legalName !== id.displayName ? id.legalName : '', id?.licenseNumber ? `${id.licensingBoard ? `${id.licensingBoard} · ` : ''}School licence #${id.licenseNumber}` : '', id?.address || ''].filter(Boolean).join(' · ');
  if (sub) { for (const l of wrap(sub, font, 8.5, W - hx - M)) { text(l, hx, 8.5, font, muted); y -= 11; } }
  y -= 10; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.9, 0.89, 0.88) }); y -= 26;
  text(o.kindLabel.toUpperCase(), M, 8.5, bold, muted); y -= 20;
  for (const l of wrap(o.title, bold, 18, W - 2 * M)) { text(l, M, 18, bold); y -= 22; }
  y -= 8;

  // Body — the exact text signed
  for (const raw of o.text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '$1');
    if (!line.trim()) { y -= 6; continue; }
    if (/^#{1,2}\s+/.test(line)) { need(26); y -= 6; for (const l of wrap(line.replace(/^#{1,2}\s+/, ''), bold, 12, W - 2 * M)) { text(l, M, 12, bold); y -= 16; } continue; }
    const bullet = /^\s*[-•]\s+/.test(line); const body = bullet ? line.replace(/^\s*[-•]\s+/, '') : line; const x = bullet ? M + 12 : M;
    const ls = wrap(body, font, 10.5, W - M - x);
    ls.forEach((l, i) => { need(14); if (bullet && i === 0) text('•', M + 2, 10.5); text(l, x, 10.5); y -= 14; });
  }

  // Signatures
  need(200); y -= 18; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.9, 0.89, 0.88) }); y -= 22;
  text('SIGNED ELECTRONICALLY', M, 8.5, bold, muted); y -= 12;
  const sigTop = y;
  if (stuSig) { const s = stuSig.scale(Math.min(46 / stuSig.height, 220 / stuSig.width)); page.drawImage(stuSig, { x: M, y: y - s.height, width: s.width, height: s.height }); y -= Math.max(s.height, 30) + 4; } else y -= 34;
  page.drawLine({ start: { x: M, y }, end: { x: M + 250, y }, thickness: 0.8, color: ink }); y -= 13;
  text(o.signer.typedName, M, 10.5, bold); y -= 13;
  for (const l of [`Signed ${when(o.signer.at)}`, o.signer.email ? `Email: ${o.signer.email}` : '', o.signer.ip ? `IP address: ${o.signer.ip}` : '', o.signer.userAgent ? `Device: ${String(o.signer.userAgent).slice(0, 90)}` : ''].filter(Boolean)) { for (const w of wrap(l, font, 8, 250)) { text(w, M, 8, font, muted); y -= 10; } }
  // School side (right)
  let sy = sigTop + 12; const rx = W / 2 + 20; // level with SIGNED ELECTRONICALLY
  page.drawText('FOR THE SCHOOL', { x: rx, y: sy, size: 8.5, font: bold, color: muted }); sy -= 12;
  const cs = o.school?.countersign;
  const colW = 140; // leaves room for the seal on the right
  if (cs && dirSig) { const s = dirSig.scale(Math.min(42 / dirSig.height, colW / dirSig.width)); page.drawImage(dirSig, { x: rx, y: sy - s.height, width: s.width, height: s.height }); }
  sy -= 46; page.drawLine({ start: { x: rx, y: sy }, end: { x: rx + colW, y: sy }, thickness: 0.8, color: ink }); sy -= 13;
  const signer = [id?.signerName, id?.signerTitle].filter(Boolean).join(', ');
  page.drawText(clean(cs ? (signer || cs.by) : o.school?.pending ? 'Countersignature pending' : (id?.displayName || t.name || '')), { x: rx, y: sy, size: 10, font: bold, color: ink }); sy -= 12;
  for (const l of [cs ? `Countersigned ${when(cs.at)} by ${cs.by}` : o.school?.note || ''].filter(Boolean)) { for (const w of wrap(l, font, 8, colW)) { page.drawText(w, { x: rx, y: sy, size: 8, font, color: muted }); sy -= 10; } }
  if (seal) { const s = seal.scale(Math.min(72 / seal.height, 72 / seal.width)); page.drawImage(seal, { x: W - M - s.width, y: sigTop - s.height - 14, width: s.width, height: s.height, opacity: 0.95 }); }
  y = Math.min(y, sy) - 18; need(30);
  for (const l of wrap(`Fingerprint (SHA-256 of the exact text above): ${fp}`, font, 7.5, W - 2 * M)) { text(l, M, 7.5, font, muted); y -= 9; }

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(clean(`${id?.displayName || t.name || ''} · ${o.title} · page ${i + 1} of ${pages.length} · ${fp.slice(0, 16)}`).slice(0, 140), { x: M, y: 28, size: 7.5, font, color: muted }));
  return { bytes: await pdf.save(), fingerprint: fp };
}

/** Build and store privately; returns the stored file's details. */
export async function saveSignedPdf(o: SignedPdfInput, name: string) {
  const { bytes, fingerprint } = await buildSignedPdf(o);
  const f = await savePrivateDocument(o.tenantId, `tenants/${o.tenantId}/academy/signed/${name.replace(/[^a-z0-9_-]/gi, '-')}-${Date.now()}`, `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`, 3_000_000);
  return { ref: f.ref, path: f.path, sha256: f.sha256, fingerprint, at: new Date().toISOString() };
}

/** A 5-minute link to one of the signed PDFs (after the caller checks it's theirs). */
export async function signedPdfLink(path: string) {
  if (!/^tenants\/[A-Za-z0-9_-]+\/academy\/signed\/[^/]+\.pdf$/.test(path)) throw new Error('Not a signed document.');
  const [url] = await (await privateBucket()).file(path).getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60 * 1000 });
  return url as string;
}
