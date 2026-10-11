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
  amountCents: number; code?: string | null; balanceCents?: number; by: string; source: 'desk' | 'online' | 'import' | 'recovery' | 'renter';
  ownerRenterId?: string | null; ownerName?: string | null;   // a card a renter sold: paid to them, spent only with them
  purchaser?: { id?: string | null; name?: string | null } | null; recipient?: { id?: string | null; name?: string | null; phone?: string | null; email?: string | null } | null;
  message?: string | null; design?: string | null; line?: string | null; purchaserEmail?: string | null; orderId?: string | null;
  sendVia?: 'text' | 'email' | 'print' | 'code' | null; sendAt?: string | null; transactionId?: string | null; importId?: string | null; importedFrom?: string | null; createdAt?: string | null; lastUsedAt?: string | null;
}) {
  const initial = Math.round(Number(o.amountCents) || 0); if (!(initial > 0) || initial > 500000) return { ok: false as const, error: 'Gift cards are from $1 to $5,000.' };
  let code = o.code ? String(o.code).trim().slice(0, 40) : newCode();
  for (let i = 0; i < 5 && (await findByCode(db, tenantId, code)); i++) { if (o.code) return { ok: false as const, error: `A gift card with code ${code} is already here.`, duplicate: true }; code = newCode(); }
  const bal = o.balanceCents == null ? initial : Math.max(0, Math.min(initial, Math.round(Number(o.balanceCents) || 0)));
  const ref = db.collection(`${T(tenantId)}/giftCards`).doc(); const at = now();
  const doc: any = { id: ref.id, code, codeKey: codeKey(code), initialCents: initial, balanceCents: bal, status: bal > 0 ? 'active' : 'used', source: o.source,
    purchaserId: o.purchaser?.id || null, purchaserName: o.purchaser?.name || null, recipientId: o.recipient?.id || null, recipientName: o.recipient?.name || null,
    recipientPhone: o.recipient?.phone || null, recipientEmail: o.recipient?.email || null,
    ownerRenterId: o.ownerRenterId || null, ownerName: o.ownerRenterId ? o.ownerName || null : null, design: o.design || null, line: o.line ? String(o.line).slice(0, 30) : null, purchaserEmail: o.purchaserEmail || null, orderId: o.orderId || null, message: o.message ? String(o.message).slice(0, 400) : null,
    sendVia: o.sendVia || null, sendAt: o.sendAt || null, sentAt: null, transactionId: o.transactionId || null, importId: o.importId || null, importedFrom: o.importedFrom || null,
    createdAt: o.createdAt || at, createdBy: o.by, lastUsedAt: o.lastUsedAt || null, holds: {},
    history: [{ at, type: o.source === 'import' ? 'import' : 'issue', cents: bal, balanceAfter: bal, by: o.by, ...(o.transactionId ? { transactionId: o.transactionId } : {}) }] };
  await ref.set(doc); return { ok: true as const, card: doc as GiftCard };
}

/** Set an amount aside for a checkout that's open (30 minutes). Calling again for the same hold changes the amount. */
export async function holdGiftCard(db: any, tenantId: string, o: { code?: string; id?: string; holdId: string; cents: number }) {
  const g = o.id ? await db.doc(`${T(tenantId)}/giftCards/${o.id}`).get().then((d: any) => (d.exists ? { id: d.id, ...d.data() } : null)) : await findByCode(db, tenantId, String(o.code || ''));
  if (!g) return { ok: false as const, error: 'That gift card code wasn’t found. Check it and try again.' };
  if (g.status === 'void') return { ok: false as const, error: 'That gift card was cancelled.' };
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
export async function spendGiftCard(db: any, tenantId: string, o: { id: string; cents: number; holdId?: string | null; by: string; transactionRef?: string | null; appointmentId?: string | null; clientId?: string | null }) {
  const ref = db.doc(`${T(tenantId)}/giftCards/${o.id}`);
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data(); if (!cur) return { ok: false as const, error: 'That gift card wasn’t found.' };
    if (cur.status === 'void') return { ok: false as const, error: 'That gift card was cancelled.' };
    const want = Math.round(Number(o.cents) || 0); if (want <= 0) return { ok: true as const, cents: 0 };
    if (want > available(cur, o.holdId || null)) return { ok: false as const, error: `Only $${(available(cur, o.holdId || null) / 100).toFixed(2)} is left on gift card ${cur.code}.` };
    const bal = (Number(cur.balanceCents) || 0) - want; const holds = { ...(cur.holds || {}) }; if (o.holdId) delete holds[o.holdId];
    tx.update(ref, { balanceCents: bal, status: bal > 0 ? 'active' : 'used', lastUsedAt: now(), holds, recipientId: cur.recipientId || o.clientId || null,
      history: [...(cur.history || []).slice(-80), { at: now(), type: 'spend', cents: -want, balanceAfter: bal, by: o.by, ...(o.transactionRef ? { ref: o.transactionRef } : {}), ...(o.appointmentId ? { appointmentId: o.appointmentId } : {}) }] });
    return { ok: true as const, cents: want, balanceAfter: bal, code: cur.code };
  });
}

/** Managers: put money back (a refunded visit), correct a balance, or cancel a card. */
export async function adjustGiftCard(db: any, tenantId: string, o: { id: string; kind: 'add' | 'set' | 'void'; cents?: number; note?: string; by: string }) {
  const ref = db.doc(`${T(tenantId)}/giftCards/${o.id}`);
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
  return { id: g.id, code: g.code, initialCents: g.initialCents, balanceCents: g.balanceCents, availableCents: available(g), status: g.status, recipientName: g.recipientName || null, purchaserName: g.purchaserName || null, message: g.message || null, design: g.design || null, line: g.line || null, ownerRenterId: g.ownerRenterId || null, ownerName: g.ownerName || null, lastUsedAt: g.lastUsedAt || null, createdAt: g.createdAt };
}

/** Text or email the card to the person it's for (now, or on the day chosen — the cron sends those). */
export async function deliverGiftCard(db: any, tenantId: string, tenant: any, g: any) {
  const { linkOrigin } = await import('@/lib/app-origin'); const origin = linkOrigin(tenant, '');
  const link = origin ? `${origin}${giftPath(tenantId, g.id)}` : ''; const biz = g.ownerName ? `${g.ownerName}${tenant?.name ? ` at ${tenant.name}` : ''}` : tenant?.name || 'us';
  const from = g.purchaserName ? String(g.purchaserName).split(' ')[0] : null; const amount = `$${(g.initialCents / 100).toFixed(g.initialCents % 100 ? 2 : 0)}`;
  const text = `${from ? `${from} sent you` : 'You’ve got'} a ${amount} gift card for ${biz}!${g.message ? ` “${String(g.message).slice(0, 160)}”` : ''} Your code: ${g.code}.${link ? ` See it and book: ${link}` : ''}`;
  const { sendNotification } = await import('@/lib/notify');
  let status = 'skipped';
  if (g.sendVia === 'text' && g.recipientPhone) status = (await sendNotification(db, { tenantId, channel: 'sms', to: String(g.recipientPhone), text, kind: 'gift_card', recipientType: 'client', recipientName: g.recipientName || null } as any).catch(() => ({ status: 'failed' })))?.status || 'failed';
  else if (g.sendVia === 'email' && g.recipientEmail) {
    const esc = (x: any) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
    const { brandAccent } = await import('@/lib/brand-accent'); const A = brandAccent(tenant);
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171a;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#6d7075;margin:0 0 6px">${esc(biz)}</p><h1 style="font-weight:400;font-size:28px;letter-spacing:-.02em;margin:0 0 18px">${from ? `${esc(from)} sent you a gift` : 'You’ve got a gift'}</h1>
<div style="border-radius:20px;background:${A};color:#fff;padding:24px 26px;margin:0 0 18px"><div style="font-size:12px;letter-spacing:.16em;opacity:.8">GIFT CARD${g.line ? ` · ${esc(g.line)}` : ''}</div><div style="font-size:44px;letter-spacing:-.03em;margin:12px 0 10px">${amount}</div><div style="font-family:Menlo,monospace;font-size:18px;letter-spacing:.14em">${esc(g.code)}</div><div style="font-size:13px;opacity:.85;margin-top:12px">FOR ${esc(String(g.recipientName || 'you').toUpperCase())} · EXPIRES NEVER</div></div>
${g.message ? `<p style="font-size:17px;line-height:1.55;font-style:italic;margin:0 0 6px">“${esc(String(g.message))}”</p><p style="font-size:13px;color:#6d7075;margin:0 0 18px">— ${esc(from || '')}</p>` : ''}
${link ? `<p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#16171a;color:#fff;text-decoration:none;border-radius:999px;padding:13px 24px;font-weight:600;font-size:15px">Open your gift card</a></p>` : ''}
<p style="font-size:13px;color:#6d7075;line-height:1.5;margin:0">Show the code when you pay, or book online and use it at your visit. The link always shows what’s left.</p></div>`;
    status = (await sendNotification(db, { tenantId, channel: 'email', to: String(g.recipientEmail), subject: `${from ? `${from} sent you` : 'You’ve got'} a gift card for ${biz}`, text, html, kind: 'gift_card', recipientType: 'client', recipientName: g.recipientName || null } as any).catch(() => ({ status: 'failed' })))?.status || 'failed';
  }
  const sent = ['sent', 'queued', 'delivered'].includes(String(status));
  await db.doc(`${T(tenantId)}/giftCards/${g.id}`).set({ sentAt: sent ? now() : null, sendStatus: status, ...(g.sendAt ? { scheduledFor: g.sendAt, sendAt: null } : {}) }, { merge: true });
  return { sent, status };
}

/** Cards set to send on a later day (a birthday): the nightly run sends the ones due. */
export async function giftSendSweep(db: any, tenantId: string, tenant: any) {
  const s = await db.collection(`${T(tenantId)}/giftCards`).where('sendAt', '<=', new Date().toISOString()).limit(200).get(); let n = 0;
  for (const d of s.docs) { const g: any = { id: d.id, ...d.data() }; if (g.sentAt || !g.sendAt || !['text', 'email'].includes(g.sendVia) || g.status === 'void' || Date.parse(g.sendAt) > Date.now() || g.sendStatus === 'failed') continue;
    const r = await deliverGiftCard(db, tenantId, tenant, g); if (r.sent) n++; }
  return n;
}
