// src/lib/dispute-pack.ts — THE CARD DISPUTE PACK: one PDF with everything a card processor asks for when a client
// disputes a charge for a visit — a plain summary, the key facts at a glance, the visit from booking to payment as a
// timeline, the charge and receipt, who the client is and their history, proof the service was given (times, provider,
// after photos), what they agreed to (policies shown at booking, signed forms), every message, and what the business
// offered or refunded. Built from the visit (and its Making it right case, when there is one), in the app's print style.
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { visitOf, staffList } from '@/lib/cases';
import { bookingPolicyLines } from '@/lib/policy-copy';
import { JAKARTA_400, JAKARTA_500, JAKARTA_700, JAKARTA_800 } from '@/lib/fonts/jakarta';

const W = 612, H = 792, M = 42;
const INK = rgb(0.086, 0.09, 0.102), MUTED = rgb(0.427, 0.439, 0.459), LINE = rgb(0.863, 0.867, 0.878), SOFT = rgb(0.969, 0.969, 0.973), WHITE = rgb(1, 1, 1);
const hex = (h: string) => { const n = parseInt(String(h || '#16171a').replace('#', ''), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const when = (iso: any, tz: string) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : ''; };
const day = (iso: any, tz: string) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }) : ''; };
const dShort = (iso: any, tz: string) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz }) : ''; };
const tShort = (iso: any, tz: string) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(' AM', 'am').replace(' PM', 'pm') : ''; };
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));

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

  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit as any);
  const R = await doc.embedFont(b64(JAKARTA_400), { subset: true }), Md = await doc.embedFont(b64(JAKARTA_500), { subset: true }), B = await doc.embedFont(b64(JAKARTA_700), { subset: true }), X = await doc.embedFont(b64(JAKARTA_800), { subset: true });
  const glyphs = new Set(R.getCharacterSet());
  const safe = (s: any) => Array.from(String(s ?? '')).map((ch) => (ch === '\n' || glyphs.has(ch.codePointAt(0) as number) ? ch : ch === '•' ? '·' : '')).join('');
  const bname = tenant.name || tenant.businessName || 'Business'; doc.setTitle(safe(`Dispute evidence - ${a.clientName || 'client'} - ${day(a.startTime, tz)}`)); doc.setCreator(safe(bname));
  const A = hex((tenant.bookingPageSettings?.cfPageConfig?.accentColor || tenant.brandColor || '#16171a'));
  let page: PDFPage = doc.addPage([W, H]); let pageNo = 1; const pages: PDFPage[] = [page];
  const Y = (top: number) => H - top;   // layout in "distance from the top"
  const text = (s: string, x: number, top: number, o: { size?: number; font?: PDFFont; color?: any; right?: boolean; spacing?: number } = {}) => { const size = o.size ?? 10, font = o.font ?? R; const t = safe(s); const w = font.widthOfTextAtSize(t, size); page.drawText(t, { x: o.right ? x - w : x, y: Y(top) - size, size, font, color: o.color ?? INK }); return w; };
  const label = (s: string, x: number, top: number, color = MUTED) => text(s.toUpperCase(), x, top, { size: 7, font: B, color });
  const wrap = (s: string, font: PDFFont, size: number, max: number) => { const out: string[] = []; for (const para of safe(s).split('\n')) { let cur = ''; for (const w of para.split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (font.widthOfTextAtSize(t, size) > max && cur) { out.push(cur); cur = w; } else cur = t; } out.push(cur); } return out; };
  const round = (x: number, top: number, w: number, h: number, r: number, o: { fill?: any; stroke?: any; width?: number } = {}) => {
    const p = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    page.drawSvgPath(p, { x, y: Y(top), color: o.fill, borderColor: o.stroke, borderWidth: o.stroke ? (o.width ?? 1) : 0 });
  };
  const rule = (top: number, x1 = M, x2 = W - M, t = 1.5, color = INK) => page.drawLine({ start: { x: x1, y: Y(top) }, end: { x: x2, y: Y(top) }, thickness: t, color });
  const footer = () => { rule(H - 34, M, W - M, 0.6, LINE); text(`From ${bname}'s records · every time shown comes from the booking system`, M, H - 30, { size: 7.5, color: MUTED }); };
  const logo = async (x: number, top: number, s: number) => {
    const url = tenant.logoUrl || tenant.logo; const im = url ? await image(doc, url) : null;
    if (im) { page.drawImage(im, { x, y: Y(top) - s, width: s, height: s }); return; }
    round(x, top, s, s, s * 0.3, { fill: A }); const ini = safe(bname).split(/\s+/).filter(Boolean).slice(0, 1).map((w) => w[0]).join('').toUpperCase(); const fs = s * 0.42;
    text(ini, x + s / 2 - X.widthOfTextAtSize(ini, fs) / 2, top + s / 2 - fs * 0.62, { size: fs, font: X, color: WHITE });
  };
  const newPage = async (title: string) => { footer(); page = doc.addPage([W, H]); pages.push(page); pageNo++;
    await logo(M, 40, 16); text(`${bname} · Card dispute evidence`, M + 22, 43, { size: 8.5, color: MUTED }); text(`${a.clientName || ''} · Visit ${a.shortCode || appointmentId.slice(0, 6)}`, W - M, 43, { size: 8.5, color: MUTED, right: true });
    return 70 + (title ? 0 : 0); };

  // ── Facts ──
  const provider = v.providerName || a.staffName || 'our provider'; const started = a.serviceStartedAt || a.arrivedAt; const ended = a.serviceEndedAt || a.completedAt;
  const refunded = reversals.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0); const online = ['online', 'client_self_service'].includes(String(a.source || ''));
  const first = String(a.clientName || 'The client').split(' ')[0];
  const firstVisit = priors.map((x: any) => x.startTime).sort()[0];
  const visits = priors.length + (ended ? 1 : 0);
  const summary = [
    `${a.clientName || 'The client'} booked ${String(a.serviceName || 'a service').toLowerCase().startsWith('a') ? '' : 'a '}${a.serviceName || 'service'}${online ? ' online' : ''}${a.createdAt ? ` on ${dShort(a.createdAt, tz)}` : ''} for ${dShort(a.startTime, tz)} at ${tShort(a.startTime, tz)}${online && v.agreedAtBooking ? ', agreeing to our policies' : ''}.`,
    (() => { const svc = started ? `the service was carried out by ${provider}${ended ? ` from ${tShort(started, tz)} to ${tShort(ended, tz)}` : ` starting ${tShort(started, tz)}`}` : '';
      return a.arrivedAt ? ` ${first} checked in at ${tShort(a.arrivedAt, tz)}${svc ? ` and ${svc}` : ''}.` : svc ? ` ${svc[0].toUpperCase()}${svc.slice(1)}.` : ''; })(),
    total ? ` ${first} paid ${usd(total)}${v.cardLast4 ? ` by card ending ${v.cardLast4}` : ''}.` : '',
    priors.length ? ` ${first} has ${priors.length} other completed visit${priors.length === 1 ? '' : 's'} with us since ${new Date(firstVisit).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: tz })}.` : '',
    c ? ` ${first} contacted us on ${dShort(c.createdAt, tz)}${c.reasonLabel ? ` about ${String(c.reasonLabel).toLowerCase()}` : ''}${c.fix ? `, and we offered ${String(c.fix.label).toLowerCase().startsWith('a ') ? '' : 'a '}${String(c.fix.label).toLowerCase()}${c.fix.amountCents ? ` of ${usd(c.fix.amountCents / 100)}` : ''}` : ''}.` : '',
    refunded > 0 ? ` We have already refunded ${usd(refunded)}.` : '',
  ].join('').trim();

  // ── Page 1 header ──
  await logo(M, 40, 32);
  text(bname, M + 42, 42, { size: 12.5, font: B }); text([tenant.studioAddress || tenant.address || '', tenant.phone || tenant.businessPhone || ''].filter(Boolean).join(' · '), M + 42, 59, { size: 8.5, color: MUTED });
  text('Card dispute evidence', W - M, 38, { size: 22, font: R, right: true }); text(`Visit ${a.shortCode || appointmentId.slice(0, 6)} · prepared ${day(new Date().toISOString(), tz)}`, W - M, 64, { size: 8.5, color: MUTED, right: true });
  rule(84, M, W - M, 1.6);
  // Summary
  const sl = wrap(summary, R, 10.5, W - 2 * M - 28); const sh = 30 + sl.length * 15.5;
  round(M, 98, W - 2 * M, sh, 12, { fill: SOFT }); label('Summary', M + 14, 110); sl.forEach((l, i) => text(l, M + 14, 124 + i * 15.5, { size: 10.5 }));
  let top = 98 + sh + 14;
  // Tiles
  const tiles: [string, string, string][] = [
    ['Service given', started ? dShort(started, tz) : '—', started ? `${tShort(started, tz)}${ended ? `–${tShort(ended, tz)}` : ''} · ${String(provider).split(' ')[0]}` : 'Not recorded'],
    ['Charge', total ? usd(total) : '—', v.cardLast4 ? `Card ending ${v.cardLast4}` : String(receipt?.paymentMethod || sales[0]?.paymentMethod || '')],
    ['Agreed to policies', online && v.agreedAtBooking ? 'Online' : (v.consents || []).length ? 'Signed' : 'At booking', online && v.agreedAtBooking ? `When booking, ${dShort(a.createdAt, tz)}` : (v.consents || []).length ? `${(v.consents || []).length} form${(v.consents || []).length === 1 ? '' : 's'}` : 'Shown on booking'],
    ['Repeat client', `${visits} visit${visits === 1 ? '' : 's'}`, firstVisit ? `Since ${new Date(firstVisit).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: tz })}` : cl.createdAt ? `Client since ${dShort(cl.createdAt, tz)}` : 'First visit'],
  ];
  const tw = (W - 2 * M - 3 * 8) / 4;
  tiles.forEach(([k, big, small], i) => { const x = M + i * (tw + 8); round(x, top, tw, 62, 10, { stroke: INK, width: 1.5 }); label(k, x + 10, top + 10, INK); text(big, x + 10, top + 24, { size: 13.5, font: k === 'Charge' ? X : B }); text(small, x + 10, top + 44, { size: 8, color: MUTED }); });
  top += 62 + 22;

  // Timeline (left) and charge + client (right)
  const colL = M, colLW = 290, colR = M + colLW + 24, colRW = W - M - colR;
  text('The visit, start to finish', colL, top, { size: 10.5, font: B }); rule(top + 18, colL, colL + colLW, 1.5);
  const ev: { at: string; text: string; accent?: boolean; hollow?: boolean }[] = [];
  if (a.createdAt) ev.push({ at: a.createdAt, text: online ? `Booked online${v.agreedAtBooking ? ' · agreed to policies' : ''}` : 'Booked' });
  if (a.reminderSentAt) ev.push({ at: a.reminderSentAt, text: 'Reminder sent', hollow: true });
  if (a.arrivedAt) ev.push({ at: a.arrivedAt, text: 'Checked in' });
  for (const x of (v.consents || [])) if (x.signedAt) ev.push({ at: x.signedAt, text: `Signed ${String(x.title).toLowerCase()}` });
  if (started && started !== a.arrivedAt) ev.push({ at: started, text: `Service started · ${provider}` });
  if (ended) ev.push({ at: ended, text: `Finished${(v.afterPhotos || []).length ? ' · after photo taken' : ''}` });
  const paidAt = receipt?.date || sales[0]?.date; if (paidAt) ev.push({ at: paidAt, text: `Paid ${usd(total)}${v.cardLast4 ? ` · card ending ${v.cardLast4}` : ''}` });
  if (v.aftercareSentAt) ev.push({ at: v.aftercareSentAt, text: 'Aftercare sent', hollow: true });
  if (c?.createdAt) ev.push({ at: c.createdAt, text: `Told us about ${String(c.reasonLabel || 'a concern').toLowerCase()}`, accent: true });
  if (c?.fix?.at) ev.push({ at: c.fix.at, text: `We offered ${String(c.fix.label || 'a fix').toLowerCase()}`, accent: true });
  for (const r of reversals) ev.push({ at: r.date, text: `Refunded ${usd(r.amount)}${r.paymentMethod ? ` · ${String(r.paymentMethod).toLowerCase()}` : ''}`, accent: true });
  if (c?.clientConfirmed && c?.checkedBackAt) ev.push({ at: c.checkedBackAt, text: `${first} said it was put right`, accent: true });
  ev.sort((x, y) => String(x.at).localeCompare(String(y.at)));
  let lt = top + 30; let lastDay = '';
  const evShown = ev.slice(0, 14);
  evShown.forEach((e, i) => {
    const d = dShort(e.at, tz); const lab = d !== lastDay ? `${d} · ${tShort(e.at, tz)}` : tShort(e.at, tz); lastDay = d;
    text(lab, colL + 82, lt + 1, { size: 8, color: MUTED, right: true });
    const cx = colL + 94, cy = Y(lt + 6);
    if (i < evShown.length - 1) page.drawLine({ start: { x: cx, y: cy - 4 }, end: { x: cx, y: cy - 22 }, thickness: 1.4, color: LINE });
    if (e.hollow) page.drawCircle({ x: cx, y: cy, size: 3.6, borderColor: INK, borderWidth: 1.4 }); else page.drawCircle({ x: cx, y: cy, size: 4, color: e.accent ? A : INK });
    const ls = wrap(e.text, R, 9.5, colLW - 108); ls.slice(0, 2).forEach((l, j) => text(l, colL + 106, lt + j * 12, { size: 9.5 })); lt += Math.max(22, ls.slice(0, 2).length * 12 + 10);
  });
  if (!ev.length) text('No visit events recorded.', colL, lt, { size: 9.5, color: MUTED });

  let rt = top; text('The charge', colR, rt, { size: 10.5, font: B }); rule(rt + 18, colR, W - M, 1.5); rt += 28;
  const items: [string, number, boolean?][] = (receipt?.lineItems || []).slice(0, 8).map((li: any) => [`${li.label}${li.staff ? ` (${li.staff})` : ''}`, Number(li.amount) || 0]);
  if (!items.length) for (const t of sales.slice(0, 6)) items.push([String(t.description || 'Sale'), Number(t.amount) || 0]);
  for (const [k, n] of [['Tax', receipt?.tax], ['Tip', receipt?.tip ?? sales.reduce((s: number, t: any) => s + (Number(t.tipAmount) || 0), 0)], ['Discount', receipt?.discount ? -receipt.discount : 0]] as [string, number][]) if (n) items.push([k, n]);
  for (const [k, n] of items) { const ls = wrap(k, R, 9.5, colRW - 60); text(ls[0], colR, rt, { size: 9.5 }); text(usd(n), W - M, rt, { size: 9.5, right: true }); rt += 15; }
  rule(rt + 2, colR, W - M, 0.6, LINE); rt += 8; text('Total', colR, rt, { size: 10.5, font: X }); text(usd(total), W - M, rt, { size: 10.5, font: X, right: true }); rt += 22;
  const kv = (k: string, val: string) => { if (!val) return; text(k, colR, rt, { size: 8.5, color: MUTED }); const ls = wrap(val, R, 8.5, colRW - 74); ls.slice(0, 2).forEach((l, j) => text(l, colR + 74, rt + j * 11, { size: 8.5 })); rt += Math.max(14, ls.slice(0, 2).length * 11 + 3); };
  kv('Paid', paidAt ? when(paidAt, tz) : ''); kv('Card', v.cardLast4 ? `Ending ${v.cardLast4}` : String(receipt?.paymentMethod || '')); kv('Receipt', receipt?.id || (sess ? String(sess) : '')); kv('Payment ref', pi || '');
  rt += 12; text('The client', colR, rt, { size: 10.5, font: B }); rule(rt + 18, colR, W - M, 1.5); rt += 28;
  kv('Name', a.clientName || cl.name || ''); kv('Email', cl.email || a.clientEmail || ''); kv('Phone', cl.phone || cl.phoneNumber || a.clientPhone || ''); kv('Client since', cl.createdAt ? day(cl.createdAt, tz) : ''); kv('Visits', `${visits} completed`);

  // ── Page 2 ──
  top = await newPage('');
  const section = async (t: string, needH: number) => { if (top + needH > H - 46) top = await newPage(''); text(t, M, top, { size: 10.5, font: B }); rule(top + 18, M, W - M, 1.5); top += 30; };
  // Proof
  await section('Proof the service was given', 120);
  const photos = [...(v.afterPhotos || []), ...((a.photoUrls || a.visitPhotos || []) as any[]).filter((u: any) => typeof u === 'string')].slice(0, 2);
  const imgs = (await Promise.all(photos.map((u) => image(doc, u)))).filter(Boolean) as PDFImage[];
  if (imgs.length) {
    const boxW = (W - 2 * M - 14) / 2, boxH = 132;
    imgs.forEach((im, i) => { const x = M + i * (boxW + 14); const s = Math.min(boxW / im.width, boxH / im.height); const w = im.width * s, h = im.height * s; round(x, top, boxW, boxH, 10, { fill: SOFT }); page.drawImage(im, { x: x + (boxW - w) / 2, y: Y(top) - boxH + (boxH - h) / 2, width: w, height: h }); text(`After photo${ended ? ` · ${dShort(ended, tz)}, ${tShort(ended, tz)}` : ''}${i === 0 ? ` · ${String(provider).split(' ')[0]}` : ''}`, x, top + boxH + 6, { size: 8, color: MUTED }); });
    top += 132 + 22;
  } else if (photos.length) { text('After photos are on file but couldn’t be added to this copy.', M, top, { size: 9, color: MUTED }); top += 18; }
  const facts: [string, string][] = [['Booked for', when(a.startTime, tz)], ['Checked in', a.arrivedAt ? tShort(a.arrivedAt, tz) : ''], ['In the chair', started && ended ? `${Math.max(1, Math.round((Date.parse(ended) - Date.parse(started)) / 60000))} minutes` : ''], ['Station', v.station || ''], ['Products used', (v.products || []).join(', ')]].filter(([, x]) => x) as [string, string][];
  const fw = (W - 2 * M) / Math.max(1, Math.min(4, facts.length));
  facts.slice(0, 4).forEach(([k, val], i) => { text(k, M + i * fw, top, { size: 8.5, color: MUTED }); wrap(val, Md, 9.5, fw - 10).slice(0, 2).forEach((l, j) => text(l, M + i * fw, top + 13 + j * 12, { size: 9.5, font: Md })); });
  top += 44;

  // Agreed
  const pol = [...new Set(bookingPolicyLines(tenant, service).filter(Boolean))];
  await section(`What ${first} agreed to`, 60 + pol.length * 26);
  text(online && v.agreedAtBooking ? `Shown on the booking page and agreed to when ${first} confirmed on ${when(a.createdAt, tz)}:` : 'The policies in place for this booking:', M, top, { size: 9, color: MUTED }); top += 18;
  for (const l of pol) { const ls = wrap(l, R, 9.5, W - 2 * M - 22); if (top + ls.length * 13 > H - 46) top = await newPage('');
    round(M, top + 1, 11, 11, 2.5, { fill: INK }); page.drawSvgPath('M 2.6 5.8 L 4.7 7.9 L 8.6 3.4', { x: M, y: Y(top + 1), borderColor: WHITE, borderWidth: 1.5 });
    ls.forEach((x, j) => text(x, M + 20, top + j * 12.5, { size: 9.5 })); top += ls.length * 12.5 + 5; }
  for (const x of (v.consents || []).slice(0, 3)) { if (top + 56 > H - 46) top = await newPage('');
    round(M, top + 4, W - 2 * M, 48, 10, { stroke: INK, width: 1.5 }); label('Signed form', M + 12, top + 13, INK); text(x.title, M + 12, top + 24, { size: 10, font: Md }); text(`Signed ${when(x.signedAt, tz)}${started && Date.parse(x.signedAt) <= Date.parse(started) ? ', before the service' : ''}`, M + 12, top + 38, { size: 8, color: MUTED }); top += 60; }
  if (v.aftercareSentAt) { const ls = wrap(`Aftercare sent ${when(v.aftercareSentAt, tz)}${v.aftercare ? `: “${String(v.aftercare).slice(0, 300)}”` : '.'}`, R, 9, W - 2 * M); ls.forEach((l, j) => text(l, M, top + j * 12, { size: 9, color: MUTED })); top += ls.length * 12 + 8; }

  // Concern
  if (c) {
    await section(`${first}’s concern and how we responded`, 120);
    const thread: { by: string; at: string; text: string; ours: boolean }[] = [];
    if (c.words || c.wordsEn) thread.push({ by: first, at: c.createdAt, text: String(c.wordsEn || c.words), ours: false });
    for (const m of (c.messages || [])) thread.push({ by: m.by, at: m.at, text: m.text, ours: m.to === 'client' || m.by !== first });
    for (const m of thread.slice(0, 8)) {
      const maxW = (W - 2 * M) * 0.72; const ls = wrap(m.text, R, 9.5, maxW - 22).slice(0, 8); const bh = ls.length * 13 + 14; if (top + bh + 16 > H - 46) top = await newPage('');
      const bw = Math.min(maxW, Math.max(...ls.map((l) => R.widthOfTextAtSize(l, 9.5))) + 22); const x = m.ours ? W - M - bw : M;
      text(`${m.by} · ${dShort(m.at, tz)}, ${tShort(m.at, tz)}`, m.ours ? W - M : M, top, { size: 7.5, color: MUTED, right: m.ours }); top += 11;
      round(x, top, bw, bh, 10, m.ours ? { fill: INK } : { fill: SOFT }); ls.forEach((l, j) => text(l, x + 11, top + 7 + j * 13, { size: 9.5, color: m.ours ? WHITE : INK })); top += bh + 10;
    }
    if (top + 50 > H - 46) top = await newPage('');
    round(M, top, W - 2 * M, 44, 10, { fill: SOFT }); const ow = (W - 2 * M) / 3;
    const outs: [string, string][] = [['We offered', c.fix ? `${c.fix.label}${c.fix.amountCents ? ` ${usd(c.fix.amountCents / 100)}` : ''} · ${dShort(c.fix.at, tz)}` : 'Not decided yet'], ['Refunded', c.fix?.refundedAt ? `${usd((c.fix.refundedCents || 0) / 100)} · ${dShort(c.fix.refundedAt, tz)}` : refunded > 0 ? usd(refunded) : 'Nothing'], [`${first} said it was put right`, c.clientConfirmed ? `Yes${c.checkedBackAt ? ` · ${dShort(c.checkedBackAt, tz)}` : ''}` : '—']];
    outs.forEach(([k, val], i) => { text(k, M + 12 + i * ow, top + 9, { size: 8, color: MUTED }); text(val, M + 12 + i * ow, top + 23, { size: 9.5, font: Md }); }); top += 56;
  } else if (reversals.length) {
    await section('Refunds on this visit', 40 + reversals.length * 14);
    for (const r of reversals) { text(`${when(r.date, tz)} · ${usd(r.amount)} by ${r.paymentMethod || 'refund'}`, M, top, { size: 9.5 }); top += 14; }
  }

  footer();
  pages.forEach((p, i) => { const t = `Page ${i + 1} of ${pages.length}`; p.drawText(t, { x: W - M - R.widthOfTextAtSize(t, 7.5), y: 22.5, size: 7.5, font: R, color: MUTED }); });
  return { ok: true, bytes: await doc.save(), name: `dispute-${safe(a.clientName || 'visit').replace(/\s+/g, '-').toLowerCase()}-${String(a.startTime || '').slice(0, 10)}.pdf` };
}
