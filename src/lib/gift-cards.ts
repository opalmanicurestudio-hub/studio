// src/lib/gift-cards.ts — GIFT CARDS (server). A card is a balance a client can spend here, found by its code.
//   tenants/{t}/giftCards/{id}: code (as printed), codeKey (letters and digits only, upper case — what lookups use),
//   initialCents, balanceCents, status (active | used | void), who bought it and who it's for, the note, how and when it
//   was sent, holds (amounts set aside on an open checkout so two tills can't spend the same money), and a history of
//   every change. Only the server writes them.
// Money: selling a card is money held for clients (Gift Card Sales, not revenue); spending one pays for the visit, which
// is when it counts as a sale — so a card is never counted twice. Imported balances from another app work the same way,
// and keep their old codes so physical cards people already have still work.
import { createHmac, randomInt } from 'crypto';

const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();
const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // no 0/O, 1/I — easy to read aloud and type
export const codeKey = (s: any) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const newCode = () => { let s = ''; for (let i = 0; i < 8; i++) s += ALPHA[randomInt(ALPHA.length)]; return `${s.slice(0, 4)}-${s.slice(4)}`; };
const HOLD_MIN = 30;
// Message greetings: "Hi Ana," (or "Hello," when there is no name). Texts get the business name in front automatically.
const firstOf = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const hiLine = (n: any) => (firstOf(n) ? `Hi ${firstOf(n)},` : 'Hello,');
const htmlText = (x: string) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]).replace(/\n/g, '<br>');
export type GiftCard = { id: string; code: string; codeKey: string; initialCents: number; balanceCents: number; status: 'active' | 'used' | 'void'; [k: string]: any };

/** What's free to spend: the balance less any holds still open on another checkout. */
export function available(g: any, exceptHold?: string | null) {
  const t = Date.now(); const holds = g?.holds || {};
  const held = Object.entries(holds).reduce((s: number, [k, h]: [string, any]) => s + (k !== exceptHold && h && Date.parse(h.until) > t ? Number(h.cents) || 0 : 0), 0);
  return Math.max(0, (Number(g?.balanceCents) || 0) - held);
}

export async function findByCode(db: any, tenantId: string, code: string): Promise<GiftCard | null> {
  const k = codeKey(code); if (k.length < 4) return null;
  const s = await db.collection(`${T(tenantId)}/giftCards`).where('codeKey', '==', k).limit(2).get();
  if (s.empty) return null; const d = s.docs[0]; return { id: d.id, ...(d.data() || {}) } as GiftCard;
}

/** The private link the recipient opens (balance, book with it). */
export function giftLinkKey(tenantId: string, id: string) {
  const secret = process.env.GIFT_LINK_SECRET || process.env.REFUND_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'gift';
  return createHmac('sha256', secret).update(`${tenantId}/${id}`).digest('base64url').slice(0, 22);
}
export const giftPath = (tenantId: string, id: string) => `/gift/${encodeURIComponent(tenantId)}/${encodeURIComponent(id)}?k=${giftLinkKey(tenantId, id)}`;

/** Make a card. Codes are unique per business; an imported one keeps its old code. */
export async function issueGiftCard(db: any, tenantId: string, o: {
  amountCents: number; code?: string | null; balanceCents?: number; by: string; source: 'desk' | 'online' | 'import' | 'recovery' | 'renter' | 'offer';
  promo?: { offerId: string; offerName: string; usableFrom: string | null; expiresAt: string; forCardId?: string | null } | null;   // a BONUS card (lib/gift-offers): nobody paid for it
  ownerRenterId?: string | null; ownerName?: string | null;   // a card a renter sold: paid to them, spent only with them
  service?: { id: string; name: string } | null;               // a SERVICE gift card: covers that service even if its price goes up
  purchaser?: { id?: string | null; name?: string | null } | null; recipient?: { id?: string | null; name?: string | null; phone?: string | null; email?: string | null } | null;
  message?: string | null; design?: string | null; line?: string | null; purchaserEmail?: string | null; orderId?: string | null;
  sendVia?: 'text' | 'email' | 'print' | 'code' | null; sendAt?: string | null; transactionId?: string | null; importId?: string | null; importedFrom?: string | null; createdAt?: string | null; lastUsedAt?: string | null;
  locationId?: string | null; limits?: any;   // where it was sold (cards across locations) · advanced limits (lib/gift-limits)
}) {
  const initial = Math.round(Number(o.amountCents) || 0); if (!(initial > 0) || initial > 500000) return { ok: false as const, error: 'Gift cards are from $1 to $5,000.' };
  let code = o.code ? String(o.code).trim().slice(0, 40) : newCode();
  for (let i = 0; i < 5 && (await findByCode(db, tenantId, code)); i++) { if (o.code) return { ok: false as const, error: `A gift card with code ${code} is already here.`, duplicate: true }; code = newCode(); }
  const bal = o.balanceCents == null ? initial : Math.max(0, Math.min(initial, Math.round(Number(o.balanceCents) || 0)));
  const ref = db.collection(`${T(tenantId)}/giftCards`).doc(); const at = now();
  // The business's expiry rule (never, unless they chose 5+ years) — imported cards keep whatever they had.
  let expiresAt: string | null = null;
  if (o.promo) expiresAt = o.promo.expiresAt;
  else if (o.source !== 'import') { const yrs = Number(((await db.doc(T(tenantId)).get()).data() as any)?.giftCardSettings?.expiryYears) || 0; if (yrs >= 5) { const d = new Date(); d.setFullYear(d.getFullYear() + yrs); expiresAt = d.toISOString(); } }
  const doc: any = { id: ref.id, code, codeKey: codeKey(code), initialCents: initial, balanceCents: bal, status: bal > 0 ? 'active' : 'used', source: o.source,
    purchaserId: o.purchaser?.id || null, purchaserName: o.purchaser?.name || null, recipientId: o.recipient?.id || null, recipientName: o.recipient?.name || null,
    recipientPhone: o.recipient?.phone || null, recipientEmail: o.recipient?.email || null,
    kind: o.service?.id ? 'service' : 'amount', serviceId: o.service?.id || null, serviceName: o.service?.name || null, ownerRenterId: o.ownerRenterId || null, ownerName: o.ownerRenterId ? o.ownerName || null : null, design: o.design || null, line: o.line ? String(o.line).slice(0, 30) : null, purchaserEmail: o.purchaserEmail || null, orderId: o.orderId || null, message: o.message ? String(o.message).slice(0, 400) : null,
    sendVia: o.sendVia || null, sendAt: o.sendAt || null, sentAt: null, transactionId: o.transactionId || null, importId: o.importId || null, importedFrom: o.importedFrom || null,
    soldAtLocationId: o.locationId || null, ...(o.limits ? { limits: o.limits } : {}),
    expiresAt, ...(o.promo ? { promo: true, offerId: o.promo.offerId, offerName: o.promo.offerName, usableFrom: o.promo.usableFrom, forCardId: o.promo.forCardId || null } : {}), createdAt: o.createdAt || at, createdBy: o.by, lastUsedAt: o.lastUsedAt || null, holds: {},
    history: [{ at, type: o.source === 'import' ? 'import' : 'issue', cents: bal, balanceAfter: bal, by: o.by, ...(o.transactionId ? { transactionId: o.transactionId } : {}) }] };
  await ref.set(doc); if (doc.recipientId) void syncClientGift(db, tenantId, doc.recipientId).catch(() => {});
  return { ok: true as const, card: doc as GiftCard };
}

/** Set an amount aside for a checkout that's open (30 minutes). Calling again for the same hold changes the amount. */
export async function holdGiftCard(db: any, tenantId: string, o: { code?: string; id?: string; holdId: string; cents: number }) {
  const g = o.id ? await db.doc(`${T(tenantId)}/giftCards/${o.id}`).get().then((d: any) => (d.exists ? { id: d.id, ...d.data() } : null)) : await findByCode(db, tenantId, String(o.code || ''));
  if (!g) return { ok: false as const, error: 'That gift card code wasn’t found. Check it and try again.' };
  if (g.status === 'void') return { ok: false as const, error: 'That gift card was cancelled.' };
  if ((g as any).promo && (g as any).usableFrom && Date.parse((g as any).usableFrom) > Date.now()) return { ok: false as const, error: `That bonus card can be used from ${new Date((g as any).usableFrom).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}.` };
  if (g.expiresAt && Date.parse(g.expiresAt) < Date.now()) return { ok: false as const, error: `That gift card expired on ${new Date(g.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.` };
  const ref = db.doc(`${T(tenantId)}/giftCards/${g.id}`);
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data(); const free = available(cur, o.holdId);
    if (free <= 0) return { ok: false as const, error: 'There’s nothing left on that gift card.', card: pub(cur) };
    const cents = Math.max(0, Math.min(free, Math.round(Number(o.cents) || 0)));
    const holds = { ...(cur.holds || {}) }; for (const [k, h] of Object.entries(holds)) if (Date.parse((h as any).until) <= Date.now()) delete holds[k];
    if (cents > 0) holds[o.holdId] = { cents, until: new Date(Date.now() + HOLD_MIN * 60000).toISOString() }; else delete holds[o.holdId];
    tx.update(ref, { holds }); return { ok: true as const, cents, card: pub({ ...cur, holds }) };
  });
}
export async function releaseHold(db: any, tenantId: string, id: string, holdId: string) {
  const ref = db.doc(`${T(tenantId)}/giftCards/${id}`); const { FieldValue } = await import('firebase-admin/firestore');
  await ref.update({ [`holds.${holdId}`]: FieldValue.delete() }).catch(() => {});
}

/** Spend from a card (at checkout, inside the sale). Uses the hold made for this checkout first. */
export async function spendGiftCard(db: any, tenantId: string, o: { id: string; cents: number; holdId?: string | null; by: string; transactionRef?: string | null; appointmentId?: string | null; clientId?: string | null; locationId?: string | null }) {
  const ref = db.doc(`${T(tenantId)}/giftCards/${o.id}`);
  const out: any = await spendTx(db, ref, o); if (out?.ok) void ref.get().then((d: any) => syncClientGift(db, tenantId, d.data()?.recipientId)).catch(() => {}); return out;
}
async function spendTx(db: any, ref: any, o: any) {
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data(); if (!cur) return { ok: false as const, error: 'That gift card wasn’t found.' };
    if (cur.status === 'void') return { ok: false as const, error: 'That gift card was cancelled.' };
    if (cur.expiresAt && Date.parse(cur.expiresAt) < Date.now()) return { ok: false as const, error: `Gift card ${cur.code} has expired.` };
    const want = Math.round(Number(o.cents) || 0); if (want <= 0) return { ok: true as const, cents: 0 };
    if (want > available(cur, o.holdId || null)) return { ok: false as const, error: `Only $${(available(cur, o.holdId || null) / 100).toFixed(2)} is left on gift card ${cur.code}.` };
    const bal = (Number(cur.balanceCents) || 0) - want; const holds = { ...(cur.holds || {}) }; if (o.holdId) delete holds[o.holdId];
    tx.update(ref, { balanceCents: bal, status: bal > 0 ? 'active' : 'used', lastUsedAt: now(), holds, recipientId: cur.recipientId || o.clientId || null,
      history: [...(cur.history || []).slice(-80), { at: now(), type: 'spend', cents: -want, balanceAfter: bal, by: o.by, ...(o.transactionRef ? { ref: o.transactionRef } : {}), ...(o.appointmentId ? { appointmentId: o.appointmentId } : {}), ...(o.locationId ? { locationId: o.locationId } : {}) }] });
    return { ok: true as const, cents: want, balanceAfter: bal, code: cur.code };
  });
}

/** Managers: put money back (a refunded visit), correct a balance, or cancel a card. */
export async function adjustGiftCard(db: any, tenantId: string, o: { id: string; kind: 'add' | 'set' | 'void'; cents?: number; note?: string; by: string }) {
  const ref = db.doc(`${T(tenantId)}/giftCards/${o.id}`);
  const out: any = await adjustTx(db, ref, o); if (out?.ok) void ref.get().then((d: any) => syncClientGift(db, tenantId, d.data()?.recipientId)).catch(() => {}); return out;
}
async function adjustTx(db: any, ref: any, o: any) {
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data(); if (!cur) return { ok: false as const, error: 'That gift card wasn’t found.' };
    const before = Number(cur.balanceCents) || 0; let bal = before;
    if (o.kind === 'add') bal = before + Math.round(Number(o.cents) || 0); else if (o.kind === 'set') bal = Math.round(Number(o.cents) || 0); else bal = 0;
    if (bal < 0 || bal > 500000) return { ok: false as const, error: 'That balance isn’t possible.' };
    tx.update(ref, { balanceCents: bal, status: o.kind === 'void' ? 'void' : bal > 0 ? 'active' : 'used', ...(o.kind === 'void' ? { voidedAt: now(), voidedBy: o.by } : {}),
      history: [...(cur.history || []).slice(-80), { at: now(), type: o.kind === 'void' ? 'void' : 'adjust', cents: bal - before, balanceAfter: bal, by: o.by, note: o.note ? String(o.note).slice(0, 200) : null }] });
    return { ok: true as const, balanceCents: bal };
  });
}

/** What a client or the desk may see of a card (never the holds' details or history). */
export function pub(g: any) {
  if (!g) return null;
  return { id: g.id, code: g.code, initialCents: g.initialCents, balanceCents: g.balanceCents, availableCents: available(g), status: g.status, recipientName: g.recipientName || null, purchaserName: g.purchaserName || null, message: g.message || null, design: g.design || null, line: g.line || null, ownerRenterId: g.ownerRenterId || null, ownerName: g.ownerName || null, expiresAt: g.expiresAt || null, kind: g.kind || 'amount', serviceId: g.serviceId || null, serviceName: g.serviceName || null, promo: g.promo === true, offerName: g.offerName || null, notes: Array.isArray(g.notes) ? g.notes.slice(0, 60) : null, givers: g.givers || null, usableFrom: g.usableFrom || null, lastUsedAt: g.lastUsedAt || null, createdAt: g.createdAt, limits: g.limits || null, soldAtLocationId: g.soldAtLocationId || null };
}

/** Text or email the card to the person it's for (now, or on the day chosen — the cron sends those). */
export async function deliverGiftCard(db: any, tenantId: string, tenant: any, g: any) {
  const { linkOrigin } = await import('@/lib/app-origin'); const origin = linkOrigin(tenant, '');
  const link = origin ? `${origin}${giftPath(tenantId, g.id)}` : ''; const biz = g.ownerName ? `${g.ownerName}${tenant?.name ? ` at ${tenant.name}` : ''}` : tenant?.name || 'us';
  // A chip-in (g.givers) is from everyone: "Jess, Maya and 4 others sent you…"
  const from = g.purchaserName ? (g.givers ? String(g.purchaserName) : String(g.purchaserName).split(' ')[0]) : null; const amount = `$${(g.initialCents / 100).toFixed(g.initialCents % 100 ? 2 : 0)}`;
  if (g.promo) return deliverBonus(db, tenantId, tenant, g, link, biz, amount);
  const closing = `Kind regards,\n${tenant?.name || biz}`;
  const smsText = `${firstOf(g.recipientName) ? `Hi ${firstOf(g.recipientName)}, you` : 'You'} have received a ${amount} gift card${from ? ` from ${from}` : ''}${g.ownerName ? ` for ${g.ownerName}` : ''}.${g.message ? ` “${String(g.message).slice(0, 160)}”` : ''} Your code is ${g.code}.${link ? ` To view your gift card and book, please visit ${link}` : ''}`;
  const text = `${hiLine(g.recipientName)}\n\nYou have received a ${amount} gift card${from ? ` from ${from}` : ''}. You can use it at ${biz}.${g.message ? `\n\n“${String(g.message).slice(0, 160)}”` : ''}\n\nYour code is ${g.code}.${link ? `\n\nTo view your gift card and book, please visit ${link}` : ''}\n\n${closing}`;
  const { sendNotification } = await import('@/lib/notify');
  let status = 'skipped';
  if (g.sendVia === 'text' && g.recipientPhone) status = (await sendNotification(db, { tenantId, channel: 'sms', to: String(g.recipientPhone), text: smsText, kind: 'gift_card', recipientType: 'client', recipientName: g.recipientName || null } as any).catch(() => ({ status: 'failed' })))?.status || 'failed';
  else if (g.sendVia === 'email' && g.recipientEmail) {
    const esc = (x: any) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
    const { brandAccent } = await import('@/lib/brand-accent'); const A = brandAccent(tenant);
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171a;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#6d7075;margin:0 0 6px">${esc(biz)}</p><h1 style="font-weight:400;font-size:28px;letter-spacing:-.02em;margin:0 0 18px">${from ? `${esc(from)} has sent you a gift` : 'You have received a gift'}</h1>
<p style="font-size:15px;line-height:1.55;margin:0 0 6px">${esc(hiLine(g.recipientName))}</p><p style="font-size:15px;line-height:1.55;margin:0 0 18px">You have received a ${esc(amount)} gift card${from ? ` from ${esc(from)}` : ''}. You can use it at ${esc(biz)}.</p>
<div style="border-radius:20px;background:${A};color:#fff;padding:24px 26px;margin:0 0 18px"><div style="font-size:12px;letter-spacing:.16em;opacity:.8">GIFT CARD${g.line ? ` · ${esc(g.line)}` : ''}</div><div style="font-size:44px;letter-spacing:-.03em;margin:12px 0 10px">${amount}</div><div style="font-family:Menlo,monospace;font-size:18px;letter-spacing:.14em">${esc(g.code)}</div><div style="font-size:13px;opacity:.85;margin-top:12px">FOR ${esc(String(g.recipientName || 'you').toUpperCase())} · EXPIRES NEVER</div></div>
${g.message ? `<p style="font-size:17px;line-height:1.55;font-style:italic;margin:0 0 6px">“${esc(String(g.message))}”</p><p style="font-size:13px;color:#6d7075;margin:0 0 18px">— ${esc(from || '')}</p>` : ''}
${link ? `<p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#16171a;color:#fff;text-decoration:none;border-radius:999px;padding:13px 24px;font-weight:600;font-size:15px">Open your gift card</a></p>` : ''}
<p style="font-size:13px;color:#6d7075;line-height:1.5;margin:0 0 18px">Please show your code when you pay, or book online and use it at your visit. Your gift card link always shows your remaining balance.</p><p style="font-size:15px;line-height:1.55;margin:0">${htmlText(closing)}</p></div>`;
    status = (await sendNotification(db, { tenantId, channel: 'email', to: String(g.recipientEmail), subject: `${from ? `${from} has sent you` : 'You have received'} a gift card for ${biz}`, text, html, kind: 'gift_card', recipientType: 'client', recipientName: g.recipientName || null } as any).catch(() => ({ status: 'failed' })))?.status || 'failed';
  }
  const sent = ['sent', 'queued', 'delivered'].includes(String(status));
  await db.doc(`${T(tenantId)}/giftCards/${g.id}`).set({ sentAt: sent ? now() : null, sendStatus: status, ...(g.sendAt ? { scheduledFor: g.sendAt, sendAt: null } : {}) }, { merge: true });
  return { sent, status };
}

/** A BONUS card goes to the buyer: a thank-you, with the dates it can be used. */
async function deliverBonus(db: any, tenantId: string, tenant: any, g: any, link: string, biz: string, amount: string) {
  const { bonusWhen } = await import('@/lib/gift-offers'); const when = bonusWhen(g);
  const smsText = `${firstOf(g.recipientName) ? `Hi ${firstOf(g.recipientName)}, thank` : 'Thank'} you for purchasing a gift card. As a thank-you, here is a ${amount} bonus for you${g.offerName ? ` (${g.offerName})` : ''}. ${when ? `${when}. ` : ''}Your code is ${g.code}.${link ? ` ${link}` : ''}`;
  const text = `${hiLine(g.recipientName)}\n\nThank you for purchasing a gift card from ${biz}. As a thank-you, here is a ${amount} bonus for you${g.offerName ? ` (${g.offerName})` : ''}. ${when ? `${when}. ` : ''}Your code is ${g.code}.${link ? `\n\n${link}` : ''}\n\nKind regards,\n${tenant?.name || biz}`;
  const { sendNotification } = await import('@/lib/notify'); let status = 'skipped';
  if (g.sendVia === 'text' && g.recipientPhone) status = (await sendNotification(db, { tenantId, channel: 'sms', to: String(g.recipientPhone), text: smsText, kind: 'gift_card', recipientType: 'client', recipientName: g.recipientName || null } as any).catch(() => ({ status: 'failed' })))?.status || 'failed';
  else if (g.sendVia === 'email' && g.recipientEmail) {
    const esc = (x: any) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171a;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#6d7075;margin:0 0 6px">${esc(biz)}</p><h1 style="font-weight:400;font-size:28px;letter-spacing:-.02em;margin:0 0 10px">${esc(amount)} for you</h1>
<p style="font-size:15px;line-height:1.55;margin:0 0 6px">${esc(hiLine(g.recipientName))}</p><p style="font-size:15px;line-height:1.55;margin:0 0 18px">Thank you for giving a gift card${g.offerName ? `. This is your ${esc(g.offerName)}` : ''}.</p>
<div style="border-radius:20px;background:#f3f3f5;padding:20px 22px;margin:0 0 18px"><div style="font-size:12px;letter-spacing:.16em;color:#6d7075">BONUS</div><div style="font-size:40px;letter-spacing:-.03em;margin:8px 0">${esc(amount)}</div><div style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.14em;font-size:16px">${esc(g.code)}</div>${when ? `<div style="font-size:13px;color:#6d7075;margin-top:10px">${esc(when)}.</div>` : ''}</div>
${link ? `<p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#16171a;color:#fff;text-decoration:none;border-radius:999px;padding:13px 24px;font-weight:600;font-size:15px">See your bonus</a></p>` : ''}
<p style="font-size:13px;color:#6d7075;line-height:1.5;margin:0 0 18px">You can use it on your next visit with us. As this is a thank-you gift, it cannot be exchanged for cash.</p><p style="font-size:15px;line-height:1.55;margin:0">Kind regards,<br>${esc(tenant?.name || biz)}</p></div>`;
    status = (await sendNotification(db, { tenantId, channel: 'email', to: String(g.recipientEmail), subject: `A ${amount} thank-you gift from ${biz}`, text, html, kind: 'gift_card', recipientType: 'client', recipientName: g.recipientName || null } as any).catch(() => ({ status: 'failed' })))?.status || 'failed';
  }
  const sent = ['sent', 'queued', 'delivered'].includes(String(status));
  await db.doc(`${T(tenantId)}/giftCards/${g.id}`).set({ sentAt: sent ? now() : null, sendStatus: status }, { merge: true });
  return { sent, status };
}

/** The buyer's bonus while an offer is on (lib/gift-offers). Returns the bonus card, or null when no offer applies. */
export async function giveBonus(db: any, tenantId: string, tenant: any, o: { channel: 'online' | 'desk'; forCard: any; buyer: { id?: string | null; name?: string | null; email?: string | null; phone?: string | null }; by: string; send?: boolean }) {
  if (!o.forCard || o.forCard.ownerRenterId || o.forCard.promo) return null;
  const { liveOffer, bonusFor, bonusDates, todayIn } = await import('@/lib/gift-offers');
  const today = todayIn(tenant?.timeZone || tenant?.timezone); const offer = liveOffer(tenant?.giftCardSettings, o.channel, today);
  const bonus = bonusFor(offer, Number(o.forCard.initialCents) || 0); if (!offer || bonus <= 0) return null;
  const d = bonusDates(offer, today); const email = o.buyer.email && /\S+@\S+\.\S+/.test(o.buyer.email) ? o.buyer.email : null; const phone = o.buyer.phone && String(o.buyer.phone).replace(/\D/g, '').length >= 10 ? o.buyer.phone : null;
  const r: any = await issueGiftCard(db, tenantId, { amountCents: bonus, by: o.by, source: 'offer', promo: { offerId: offer.id, offerName: offer.name, usableFrom: d.usableFrom, expiresAt: d.expiresAt, forCardId: o.forCard.id },
    recipient: { id: o.buyer.id || null, name: o.buyer.name || null, email, phone }, purchaser: { id: null, name: null }, design: o.forCard.design || null, line: 'BONUS',
    sendVia: email ? 'email' : phone ? 'text' : 'code', transactionId: o.forCard.transactionId || null, orderId: o.forCard.orderId || null });
  if (!r.ok) return null;
  if (o.send !== false && (email || phone)) await deliverGiftCard(db, tenantId, tenant, r.card).catch(() => null);
  await db.doc(`${T(tenantId)}/giftCards/${o.forCard.id}`).set({ bonusCardId: r.card.id, bonusCents: bonus }, { merge: true }).catch(() => {});
  return r.card;
}

/** Cards set to send on a later day (a birthday): the nightly run sends the ones due. */
export async function giftSendSweep(db: any, tenantId: string, tenant: any) {
  const s = await db.collection(`${T(tenantId)}/giftCards`).where('sendAt', '<=', new Date().toISOString()).limit(200).get(); let n = 0;
  for (const d of s.docs) { const g: any = { id: d.id, ...d.data() }; if (g.sentAt || !g.sendAt || !['text', 'email'].includes(g.sendVia) || g.status === 'void' || Date.parse(g.sendAt) > Date.now() || g.sendStatus === 'failed') continue;
    const r = await deliverGiftCard(db, tenantId, tenant, g); if (r.sent) n++; }
  return n;
}

/** After a card is used: tell the person it's for what's left, and — the first time — tell the buyer their gift was
 *  used (when the business keeps "Tell the buyer" on). Short, no marketing; a send that fails changes nothing. */
export async function notifyGiftUse(db: any, tenantId: string, id: string, cents: number, reqOrigin?: string | null) {
  const g: any = (await db.doc(`${T(tenantId)}/giftCards/${id}`).get()).data(); if (!g) return;
  const t: any = (await db.doc(T(tenantId)).get()).data() || {};
  const { linkOrigin } = await import('@/lib/app-origin'); const origin = linkOrigin(t, reqOrigin || ''); const link = origin ? `${origin}${giftPath(tenantId, id)}` : '';
  const biz = g.ownerName || t.name || 'us'; const $ = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  const { sendNotification } = await import('@/lib/notify');
  const usedFacts = (at: string) => `you have used ${$(cents)} of your gift card${at}. ${g.balanceCents > 0 ? `${$(g.balanceCents)} remains on your card.` : 'Your card has now been fully used. We hope you enjoyed it.'}${link && g.balanceCents > 0 ? ` To view your gift card, please visit ${link}` : ''}`;
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const usedSms = firstOf(g.recipientName) ? `Hi ${firstOf(g.recipientName)}, ${usedFacts('')}` : cap(usedFacts(''));
  const used = `${hiLine(g.recipientName)}\n\n${cap(usedFacts(` at ${biz}`))}\n\nKind regards,\n${t.name || biz}`;
  if (g.recipientEmail) await sendNotification(db, { tenantId, channel: 'email', to: String(g.recipientEmail), subject: g.balanceCents > 0 ? `Your gift card balance: ${$(g.balanceCents)} remaining` : 'Your gift card has been fully used', text: used, html: `<p style="font-size:16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${htmlText(used).replace(link, `<a href="${link}">${link}</a>`)}</p>`, kind: 'gift_card_used', recipientType: 'client', recipientName: g.recipientName || null } as any).catch(() => {});
  else if (g.recipientPhone) await sendNotification(db, { tenantId, channel: 'sms', to: String(g.recipientPhone), text: usedSms, kind: 'gift_card_used', recipientType: 'client', recipientName: g.recipientName || null } as any).catch(() => {});
  // The buyer, once — the first time their gift is used.
  const spends = (g.history || []).filter((h: any) => h.type === 'spend').length;
  if (spends === 1 && !g.buyerToldAt && t.giftCardSettings?.buyerThanks !== false && g.purchaserName && g.purchaserName !== g.recipientName) {
    let to = g.purchaserEmail || null; if (!to && g.purchaserId) to = (((await db.doc(`${T(tenantId)}/clients/${g.purchaserId}`).get()).data() as any) || {}).email || null;
    if (to) { const who = String(g.recipientName || 'They').split(' ')[0];
      const text = `${hiLine(g.purchaserName)}\n\n${who} has used the gift card you gave them at ${biz}. Thank you for sending them our way!\n\nKind regards,\n${t.name || biz}`;
      await sendNotification(db, { tenantId, channel: 'email', to: String(to), subject: `${who} has used your gift card`, text, html: `<p style="font-size:16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${htmlText(text)}</p>`, kind: 'gift_card_buyer_used', recipientType: 'client', recipientName: g.purchaserName } as any).catch(() => {});
      await db.doc(`${T(tenantId)}/giftCards/${id}`).set({ buyerToldAt: now() }, { merge: true }); }
  }
}

/** Tell the owner and managers (in the app) about something on gift cards worth a look. */
export async function alertManagers(db: any, tenantId: string, message: string, link = '/gift-cards', except?: string | null) {
  const t: any = (await db.doc(T(tenantId)).get()).data() || {};
  const st = await db.collection(`${T(tenantId)}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get();
  const ids = new Set<string>(st.docs.filter((d: any) => (d.data() as any)?.archived !== true).map((d: any) => d.id)); if (t.userId) ids.add(String(t.userId)); if (except) ids.delete(except);
  const b = db.batch(); for (const u of ids) { const r = db.collection(`${T(tenantId)}/notifications`).doc(); b.set(r, { id: r.id, userId: u, type: 'gift_alert', message, link, createdAt: now(), read: false }); }
  if (ids.size) await b.commit();
}

/** Wrong codes: after 8 misses in 15 minutes from one person (or one visitor), stop for 15 minutes and tell managers once. */
export async function codeTries(db: any, tenantId: string, who: string, missed: boolean) {
  const key = `gift_tries_${String(who).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'anon'}`; const ref = db.doc(`${T(tenantId)}/counters/${key}`);
  const d: any = (await ref.get()).data() || {}; const nowMs = Date.now();
  if (d.blockedUntil && Date.parse(d.blockedUntil) > nowMs) return { blocked: true };
  if (!missed) return { blocked: false };
  const fresh = !d.windowStart || nowMs - Date.parse(d.windowStart) > 15 * 60000; const count = fresh ? 1 : (Number(d.count) || 0) + 1;
  const blocked = count >= 8;
  await ref.set({ windowStart: fresh ? new Date(nowMs).toISOString() : d.windowStart, count: blocked ? 0 : count, ...(blocked ? { blockedUntil: new Date(nowMs + 15 * 60000).toISOString() } : {}) }, { merge: true });
  return { blocked, justBlocked: blocked };
}

/** Give a card to someone else (a manager): the new person's details, with the old ones kept in the history. */
export async function transferGiftCard(db: any, tenantId: string, o: { id: string; name: string; phone?: string | null; email?: string | null; clientId?: string | null; note?: string | null; by: string }) {
  const ref = db.doc(`${T(tenantId)}/giftCards/${o.id}`); const before = (await ref.get()).data()?.recipientId || null;
  const out: any = await transferTx(db, ref, o); if (out?.ok) { void syncClientGift(db, tenantId, before).catch(() => {}); void syncClientGift(db, tenantId, o.clientId).catch(() => {}); } return out;
}
async function transferTx(db: any, ref: any, o: any) {
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data(); if (!cur) return { ok: false as const, error: 'That gift card wasn’t found.' };
    if (cur.status === 'void') return { ok: false as const, error: 'That gift card was cancelled.' };
    const name = String(o.name || '').trim().slice(0, 80); if (!name) return { ok: false as const, error: 'Add who it’s going to.' };
    tx.update(ref, { recipientName: name, recipientId: o.clientId || null, recipientPhone: o.phone ? String(o.phone).slice(0, 30) : null, recipientEmail: o.email ? String(o.email).slice(0, 120) : null,
      history: [...(cur.history || []).slice(-80), { at: now(), type: 'transfer', cents: 0, balanceAfter: cur.balanceCents, by: o.by, note: `From ${cur.recipientName || 'no one'} to ${name}${o.note ? ` — ${String(o.note).slice(0, 120)}` : ''}`, from: { name: cur.recipientName || null, id: cur.recipientId || null, phone: cur.recipientPhone || null, email: cur.recipientEmail || null } }] });
    return { ok: true as const };
  });
}

/** Keep the client's gift card total on their record (giftBalanceCents) — so the desk, the planner and their profile can
 *  show "$75 on gift cards" without looking anything up. Studio cards only; called after any change to a card. */
export async function syncClientGift(db: any, tenantId: string, clientId?: string | null) {
  if (!clientId) return;
  const s = await db.collection(`${T(tenantId)}/giftCards`).where('recipientId', '==', clientId).get();
  const live = s.docs.map((d: any) => d.data()).filter((g: any) => g.status === 'active' && !g.ownerRenterId && g.balanceCents > 0 && !(g.expiresAt && Date.parse(g.expiresAt) < Date.now()));
  await db.doc(`${T(tenantId)}/clients/${clientId}`).set({ giftBalanceCents: live.reduce((a: number, g: any) => a + g.balanceCents, 0), giftAmountCents: live.filter((g: any) => g.kind !== 'service' && !g.promo).reduce((a: number, g: any) => a + g.balanceCents, 0), giftCardCount: live.length }, { merge: true }).catch(() => {});
}

/** A gentle note about money left on a card (Gift cards → "Remind people about money left"): only for cards with money
 *  on them that haven't been used in 60 days, at most every 90 days and 3 times in all, never to someone who has
 *  turned messages off, and only during the day. The nightly run calls it. */
export async function giftReminderSweep(db: any, tenantId: string, tenant: any) {
  if (tenant?.giftCardSettings?.balanceReminders === false) return 0;
  const s = await db.collection(`${T(tenantId)}/giftCards`).where('status', '==', 'active').get(); let n = 0; const nowMs = Date.now();
  const { sendNotification } = await import('@/lib/notify'); const { linkOrigin } = await import('@/lib/app-origin'); const origin = linkOrigin(tenant, '');
  for (const d of s.docs) { if (n >= 100) break; const g: any = { id: d.id, ...d.data() };
    if (!(g.balanceCents > 0) || g.ownerRenterId || (g.reminders || 0) >= 3 || (g.expiresAt && Date.parse(g.expiresAt) < nowMs)) continue;
    const last = Date.parse(g.lastUsedAt || g.sentAt || g.createdAt || ''); if (!Number.isFinite(last) || nowMs - last < 60 * 864e5) continue;
    if (g.lastReminderAt && nowMs - Date.parse(g.lastReminderAt) < 90 * 864e5) continue;
    if (g.sendAt && Date.parse(g.sendAt) > nowMs) continue;   // not even delivered yet
    let cl: any = null; if (g.recipientId) cl = ((await db.doc(`${T(tenantId)}/clients/${g.recipientId}`).get()).data() as any) || null;
    const email = g.recipientEmail || cl?.email || null; const phone = g.recipientPhone || cl?.phone || null;
    // Their message choices: nobody who unsubscribed; texts only to clients who agreed to texts from us.
    if (cl?.marketingOptOut === true) continue;
    const okEmail = !!email; const okText = !email && !!phone && cl?.smsMarketingOptIn === true;
    if (!okEmail && !okText) continue;
    const $ = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`; const link = origin ? `${origin}${giftPath(tenantId, g.id)}` : '';
    const name = g.recipientName || cl?.name || cl?.firstName || '';
    const smsText = `${firstOf(name) ? `Hi ${firstOf(name)}, this` : 'This'} is a friendly reminder that you have ${$(g.balanceCents)} remaining on your gift card.${link ? ` To see what it covers and book, please visit ${link}` : ''}`;
    const text = `${hiLine(name)}\n\nThis is a friendly reminder that you have ${$(g.balanceCents)} remaining on your gift card at ${tenant?.name || 'us'}.${link ? ` To see what it covers and book, please visit ${link}` : ''}\n\nKind regards,\n${tenant?.name || ''}`.trimEnd();
    const r: any = okEmail ? await sendNotification(db, { tenantId, channel: 'email', to: String(email), subject: `You have ${$(g.balanceCents)} remaining on your gift card`, text, html: `<p style="font-size:16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${htmlText(text).replace(link, `<a href="${link}">${link}</a>`)}</p>`, kind: 'gift_card_balance', recipientType: 'client', recipientId: g.recipientId || null, recipientName: g.recipientName || null } as any).catch(() => null)
      : await sendNotification(db, { tenantId, channel: 'sms', to: String(phone), text: smsText, kind: 'gift_card_balance', recipientType: 'client', recipientId: g.recipientId || null, recipientName: g.recipientName || null } as any).catch(() => null);
    if (r && ['sent', 'queued', 'delivered'].includes(String(r.status))) { await d.ref.set({ lastReminderAt: new Date().toISOString(), reminders: (g.reminders || 0) + 1 }, { merge: true }); n++; } }
  return n;
}

/** Which part of a bill each gift card may pay (the front desk): a studio card pays the studio's part first, then a
 *  renter's visit only when the business allows it (that part is owed to the renter); a renter's own card pays only
 *  that renter's visits. Amounts in cents; pure, so it can be checked on its own. */
export function planGiftUse(i: { cards: { id: string; code: string; wantCents: number; holdId: string | null; owner: string | null; ownerName?: string | null }[]; byRenter: Record<string, number>; studioLeft: number; salonForRenters: boolean }) {
  const byRenter = { ...i.byRenter }; let studioLeft = Math.max(0, i.studioLeft);
  const uses: { id: string; code: string; cents: number; holdId: string | null; owner: string | null; forRenters: Record<string, number> }[] = [];
  for (const c of i.cards) {
    let want = Math.max(0, Math.round(c.wantCents)); const use = { id: c.id, code: c.code, cents: 0, holdId: c.holdId, owner: c.owner, forRenters: {} as Record<string, number> };
    if (c.owner) { const take = Math.min(want, byRenter[c.owner] || 0); if (take <= 0) return { error: `Gift card ${c.code} is ${c.ownerName || 'a renter'}’s — it pays only for their services.`, uses: [] };
      byRenter[c.owner] -= take; use.cents = take; use.forRenters[c.owner] = take; }
    else { const a = Math.min(want, studioLeft); studioLeft -= a; want -= a; use.cents = a;
      if (want > 0 && i.salonForRenters) for (const rid of Object.keys(byRenter)) { const t = Math.min(want, byRenter[rid]); if (t > 0) { byRenter[rid] -= t; want -= t; use.cents += t; use.forRenters[rid] = (use.forRenters[rid] || 0) + t; } }
      if (use.cents <= 0 && c.wantCents > 0 && !uses.length) return { error: Object.keys(byRenter).length && !i.salonForRenters ? `Gift card ${c.code} can’t pay for a renter’s service here — take another payment for that part.` : `Nothing on this bill can be paid with gift card ${c.code}.`, uses: [] }; }
    if (use.cents > 0) uses.push(use);
  }
  return { error: null as string | null, uses };
}
