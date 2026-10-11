// src/lib/dispute-pack.ts — THE CARD DISPUTE PACK: one PDF with everything a card processor asks for when a client
// disputes a charge for a visit — who they are and their history with the business, the charge (amount, card, receipt,
// payment reference), proof the service was given (check-in, start and finish times, the provider, after photos),
// what they agreed to (the policies shown at booking, signed forms), every message, and what the business offered or
// refunded. Built from the visit (and its Making it right case, when there is one). Upload it to the processor as is.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import { visitOf, staffList } from '@/lib/cases';
import { bookingPolicyLines } from '@/lib/policy-copy';

const W = 612, H = 792, M = 44;
const INK = rgb(0.086, 0.09, 0.102), MUTED = rgb(0.427, 0.439, 0.459), LINE = rgb(0.925, 0.925, 0.933), SOFT = rgb(0.965, 0.965, 0.969);
const hex = (h: string) => { const n = parseInt(String(h || '#16171a').replace('#', ''), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const safe = (s: any) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/×/g, 'x').replace(/…/g, '...').replace(/·/g, '-').replace(/[^\x20-\x7E\n]/g, '');
const when = (iso: any, tz: string) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : ''; };
const day = (iso: any, tz: string) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }) : ''; };
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = []; for (const para of safe(text).split('\n')) { let cur = ''; for (const w of para.split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (font.widthOfTextAtSize(t, size) > max && cur) { out.push(cur); cur = w; } else cur = t; } out.push(cur); } return out;
}

async function image(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (!r.ok) return null; const b = new Uint8Array(await r.arrayBuffer()); if (b.length > 6_000_000) return null;
    return b[0] === 0x89 && b[1] === 0x50 ? await doc.embedPng(b) : await doc.embedJpg(b);
  } catch { return null; }
}

/** Build the pack for a visit (appointmentId) or a case (caseId → its visit). */
export async function disputePack(db: any, tenantId: string, o: { appointmentId?: string; caseId?: string }): Promise<{ ok: true; bytes: Uint8Array; name: string } | { ok: false; error: string }> {
  const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data() || {}; const tz = tenant.timezone || 'America/New_York';
  let c: any = null; if (o.caseId) { const s = await db.doc(`${T}/cases/${o.caseId}`).get(); c = s.exists ? { id: s.id, ...s.data() } : null; }
  const appointmentId = String(o.appointmentId || c?.visit?.appointmentId || ''); if (!appointmentId) return { ok: false, error: 'There’s no visit linked to build the pack from.' };
  const aS = await db.doc(`${T}/appointments/${appointmentId}`).get(); if (!aS.exists) return { ok: false, error: 'Visit not found.' }; const a: any = aS.data() || {};
  if (!c) { const cs = await db.collection(`${T}/cases`).where('visit.appointmentId', '==', appointmentId).limit(1).get(); c = cs.empty ? null : { id: cs.docs[0].id, ...cs.docs[0].data() }; }
  const staff = await staffList(db, tenantId); const v: any = (await visitOf(db, tenantId, appointmentId, staff)) || {};
  const cl: any = a.clientId ? (await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {} : {};
  const tx = (await db.collection(`${T}/transactions`).where('appointmentId', '==', appointmentId).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const sales = tx.filter((t: any) => t.type !== 'reversal' && t.type !== 'expense' && !t.voided); const reversals = tx.filter((t: any) => t.type === 'reversal');
  const sess = sales.map((t: any) => t.checkoutSessionId).find(Boolean);
  const receipt: any = sess ? ((await db.collection(`${T}/receipts`).where('checkoutSessionId', '==', sess).limit(1).get()).docs[0]?.data() || null) : null;
  const pi = receipt?.stripePaymentIntentId || (receipt?.payments || []).map((p: any) => p.stripePaymentIntentId).find(Boolean) || sales.map((t: any) => t.stripePaymentIntentId).find(Boolean) || null;
  const priors = a.clientId ? (await db.collection(`${T}/appointments`).where('clientId', '==', a.clientId).get()).docs.map((d: any) => d.data() || {}).filter((x: any) => ['completed', 'checked_out', 'paid'].includes(String(x.status)) && x.startTime && x.startTime !== a.startTime) : [];
  const service: any = a.serviceId ? (await db.doc(`${T}/services/${a.serviceId}`).get()).data() || null : null;
  const total = receipt?.total ?? sales.reduce((s: number, t: any) => s + (Number(t.amount) || 0) + (Number(t.tipAmount) || 0), 0);

  const doc = await PDFDocument.create(); const R = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  const bname = tenant.name || tenant.businessName || 'Business'; doc.setTitle(safe(`Dispute evidence - ${a.clientName || 'client'} - ${day(a.startTime, tz)}`)); doc.setCreator(safe(bname));
  const A = hex((tenant.bookingPageSettings?.cfPageConfig?.accentColor || tenant.brandColor || '#16171a')); let page: PDFPage = doc.addPage([W, H]); let y = H - M; let pageNo = 1;
  const text = (s: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: any; right?: boolean } = {}) => { const size = o.size ?? 10, font = o.font ?? R; const t = safe(s); page.drawText(t, { x: o.right ? x - font.widthOfTextAtSize(t, size) : x, y: yy, size, font, color: o.color ?? INK }); };
  const footer = () => { page.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.6, color: LINE }); text(`Prepared ${when(new Date().toISOString(), tz)} from ${bname}'s records`, M, 22, { size: 7.5, color: MUTED }); text(`Page ${pageNo}`, W - M, 22, { size: 7.5, color: MUTED, right: true }); };
  const need = (h: number) => { if (y - h < 52) { footer(); page = doc.addPage([W, H]); pageNo++; y = H - M; } };
  const para = (s: string, o: { size?: number; color?: any; font?: PDFFont; indent?: number } = {}) => { const size = o.size ?? 10; for (const l of wrap(s, o.font ?? R, size, W - 2 * M - (o.indent || 0))) { need(size + 4); text(l, M + (o.indent || 0), y, { size, color: o.color, font: o.font }); y -= size + 4; } y -= 3; };
  const section = (t: string) => { need(34); y -= 8; text(t, M, y, { size: 11.5, font: B }); y -= 5; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.1, color: INK }); y -= 14; };
  const rows = (pairs: [string, string][]) => { for (const [k, val] of pairs) { if (!val) continue; const ls = wrap(val, R, 9.5, W - 2 * M - 150); need(ls.length * 13 + 2); text(k, M, y, { size: 8.5, font: B, color: MUTED }); ls.forEach((l, i) => text(l, M + 150, y - i * 13, { size: 9.5 })); y -= ls.length * 13 + 3; } y -= 3; };

  // Header
  page.drawRectangle({ x: M, y: y - 34, width: 34, height: 34, color: A }); const ini = safe(bname).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); text(ini, M + 17 - B.widthOfTextAtSize(ini, 12) / 2, y - 22, { size: 12, font: B, color: rgb(1, 1, 1) });
  text(bname, M + 46, y - 12, { size: 14, font: B }); text([tenant.studioAddress || tenant.address || '', tenant.phone || tenant.businessPhone || '', tenant.email || tenant.contactEmail || ''].filter(Boolean).join(' - '), M + 46, y - 26, { size: 8.5, color: MUTED });
  text('Card dispute evidence', W - M, y - 12, { size: 16, font: B, right: true }); text(`Visit ${a.shortCode || appointmentId.slice(0, 8)}`, W - M, y - 26, { size: 8.5, color: MUTED, right: true });
  y -= 48; page.drawRectangle({ x: M, y, width: W - 2 * M, height: 4, color: A }); y -= 24;

  // Summary
  const provider = v.providerName || a.staffName || 'our provider'; const started = a.serviceStartedAt || a.arrivedAt; const ended = a.serviceEndedAt || a.completedAt;
  const refunded = reversals.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
  const summary = [
    `${a.clientName || 'The client'} booked ${a.serviceName || 'a service'} for ${when(a.startTime, tz)}${a.source && ['online', 'client_self_service'].includes(String(a.source)) ? ' online' : ''}${a.createdAt ? ` on ${day(a.createdAt, tz)}` : ''}.`,
    (() => { const svc = started ? `the service was carried out by ${provider}${ended ? ` from ${when(started, tz)} to ${when(ended, tz)}` : ` starting ${when(started, tz)}`}` : '';
      return a.arrivedAt ? ` They checked in at ${when(a.arrivedAt, tz)}${svc ? ` and ${svc}` : ''}.` : svc ? ` ${svc[0].toUpperCase()}${svc.slice(1)}.` : ''; })(),
    total ? ` They paid ${usd(total)}${v.cardLast4 ? ` by card ending ${v.cardLast4}` : ''}${receipt?.date ? ` on ${day(receipt.date, tz)}` : ''}.` : '',
    priors.length ? ` They have ${priors.length} other completed visit${priors.length === 1 ? '' : 's'} with us${priors.length ? `, the first on ${day(priors.map((x: any) => x.startTime).sort()[0], tz)}` : ''}.` : '',
    c ? ` They contacted us about this visit on ${day(c.createdAt, tz)} (${c.reasonLabel || 'a concern'})${c.fix ? `, and we offered: ${c.fix.label}${c.fix.amountCents ? ` ${usd(c.fix.amountCents / 100)}` : ''}` : ''}.` : '',
    refunded > 0 ? ` We have already refunded ${usd(refunded)}.` : '',
  ].join('');
  section('Summary'); para(summary.trim());

  section('The client'); rows([['Name', a.clientName || cl.name || ''], ['Email', cl.email || a.clientEmail || ''], ['Phone', cl.phone || cl.phoneNumber || a.clientPhone || ''], ['Client since', cl.createdAt ? day(cl.createdAt, tz) : ''], ['Completed visits', String(priors.length + (ended ? 1 : 0))]]);
  section('The charge'); rows([['Amount', total ? usd(total) : ''], ['Date', receipt?.date ? when(receipt.date, tz) : sales[0]?.date ? when(sales[0].date, tz) : ''], ['Card', v.cardLast4 ? `ending ${v.cardLast4}` : ''], ['Paid by', receipt?.paymentMethod || sales[0]?.paymentMethod || ''], ['Receipt', receipt?.id || (sess ? String(sess) : '')], ['Payment reference', pi || '']]);
  if (receipt?.lineItems?.length) { for (const li of receipt.lineItems.slice(0, 20)) { need(14); text(`${li.label}${li.staff ? ` (${li.staff})` : ''}`, M + 10, y, { size: 9.5 }); text(usd(li.amount), W - M, y, { size: 9.5, right: true }); y -= 13; }
    for (const [k, n] of [['Tax', receipt.tax], ['Tip', receipt.tip], ['Discount', receipt.discount ? -receipt.discount : 0], ['Total', receipt.total]] as [string, number][]) { if (!n) continue; need(14); text(k, M + 10, y, { size: 9.5, font: k === 'Total' ? B : R }); text(usd(n), W - M, y, { size: 9.5, right: true, font: k === 'Total' ? B : R }); y -= 13; } y -= 4; }

  section('Proof the service was given'); rows([['Service', a.serviceName || ''], ['Provider', provider], ['Booked for', when(a.startTime, tz)], ['Checked in', a.arrivedAt ? when(a.arrivedAt, tz) : ''], ['Service started', started ? when(started, tz) : ''], ['Service finished', ended ? when(ended, tz) : ''], ['Station', v.station || ''], ['Products used', (v.products || []).join(', ')]]);
  const photos = [...(v.afterPhotos || []), ...((a.photoUrls || a.visitPhotos || []) as any[]).filter((u: any) => typeof u === 'string')].slice(0, 4);
  if (photos.length) {
    para(`Photo${photos.length === 1 ? '' : 's'} taken at the end of the visit:`, { size: 9.5, color: MUTED });
    const imgs = (await Promise.all(photos.map((u) => image(doc, u)))).filter(Boolean) as PDFImage[];
    const box = (W - 2 * M - 24) / 2; let col = 0;
    for (const im of imgs) { const s = Math.min(box / im.width, 220 / im.height); const w = im.width * s, h = im.height * s; if (col === 0) need(h + 10); page.drawImage(im, { x: M + col * (box + 24), y: y - h, width: w, height: h }); if (col === 1 || im === imgs[imgs.length - 1]) { y -= 230; col = 0; } else col = 1; }
    if (!imgs.length) para('(Photos are on file but couldn’t be added to this copy.)', { size: 9, color: MUTED });
  }

  section('What they agreed to');
  para(v.agreedAtBooking ? `Booked online on ${day(a.createdAt, tz)}. Confirming the booking meant agreeing to these policies, shown on the booking page:` : 'Policies in place for this booking:', { size: 9.5 });
  for (const l of [...new Set(bookingPolicyLines(tenant, service).filter(Boolean))]) para(`- ${l}`, { size: 9.5, indent: 8 });
  if ((v.consents || []).length) { para('Signed forms:', { size: 9.5, font: B }); for (const x of v.consents) para(`- ${x.title}, signed ${when(x.signedAt, tz)}`, { size: 9.5, indent: 8 }); }
  if (v.aftercareSentAt) para(`Aftercare instructions were sent ${when(v.aftercareSentAt, tz)}${v.aftercare ? `: "${String(v.aftercare).slice(0, 400)}"` : '.'}`, { size: 9.5 });

  if (c) {
    section('Their concern and how we responded');
    rows([['Raised', `${when(c.createdAt, tz)} - ${c.reasonLabel || ''}`], ['Their words', c.words ? `"${String(c.wordsEn || c.words).slice(0, 600)}"` : ''], ['What we offered', c.fix ? `${c.fix.label}${c.fix.amountCents ? ` ${usd(c.fix.amountCents / 100)}` : ''} (${day(c.fix.at, tz)})` : 'Not decided yet'], ['Refund given', c.fix?.refundedAt ? `${usd((c.fix.refundedCents || 0) / 100)} ${c.fix.refundVia ? `(${c.fix.refundVia})` : 'to the card'} on ${day(c.fix.refundedAt, tz)}` : ''], ['Client said it was put right', c.clientConfirmed ? `Yes${c.checkedBackAt ? `, ${day(c.checkedBackAt, tz)}` : ''}` : '']]);
    if ((c.messages || []).length) { para('Messages:', { size: 9.5, font: B }); for (const m of c.messages) para(`${when(m.at, tz)} - ${m.by}: "${m.text}"`, { size: 9, indent: 8 }); }
  }
  if (reversals.length) { section('Refunds on this visit'); for (const r of reversals) para(`${when(r.date, tz)} - ${usd(r.amount)} by ${r.paymentMethod || 'refund'}${r.notes ? ` (${String(r.notes).slice(0, 120)})` : ''}`, { size: 9.5 }); }
  footer();
  return { ok: true, bytes: await doc.save(), name: `dispute-${safe(a.clientName || 'visit').replace(/\s+/g, '-').toLowerCase()}-${String(a.startTime || '').slice(0, 10)}.pdf` };
}
