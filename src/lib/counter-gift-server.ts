// src/lib/counter-gift-server.ts — A GIFT CARD SOLD AT THE COUNTER OR THE WINDOW, MADE ONCE IT'S PAID (server; design
// board "Gift cards at the counter"; lib/counter-gift, lib/counter-server payOrder, api/counter 'giftIssue'). Each gift
// card on a paid order is made once, the same as the front desk's (lib/gift-cards, under its own id for this order and
// line, so asking again gives the same one), sent by text or email when that's how it goes, with the buyer's bonus
// while an offer is on (lib/gift-offers). Its code goes on its line, for the receipt and the screen. One that couldn't
// be made is marked so on its line, and asking again makes it.
import { randomBytes } from 'crypto';
import { isGiftLine, type GiftOnLine } from '@/lib/counter-gift';
import { issueGiftCard, deliverGiftCard, giveBonus } from '@/lib/gift-cards';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** Another try that claimed one is let be this long (it's making it now), then it's made here instead. */
const CLAIM_MS = 120000;

export type GiftMade = { lineId: string; name: string; to: string | null; cents: number; via: GiftOnLine['via']; code: string | null; sent: boolean; failed: boolean; bonusCode: string | null };
const madeOf = (l: any): GiftMade => ({ lineId: String(l.lineId), name: String(l.name || 'Gift card'), to: l.giftCard?.to || null, cents: Math.round(num(l.unitPrice) * 100), via: l.giftCard?.via || 'print',
  code: l.giftCard?.code || null, sent: l.giftCard?.sent === true, failed: !l.giftCard?.id && !!l.giftCard?.failed, bonusCode: l.giftCard?.bonusCode || null });

/** The right to send a gift card now: none while another try is sending it (10 minutes), or once it's sent. */
async function sendClaim(db: any, path: string): Promise<boolean> {
  const r = db.doc(path);
  return db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(r)).data(); if (!c || c.sentAt) return false;
    if (c.sendingAt && Date.parse(String(c.sendingAt)) > Date.now() - 600000) return false;
    tx.set(r, { sendingAt: new Date().toISOString() }, { merge: true }); return true;
  }).catch(() => false);
}

/** Paid orders whose gift cards aren't all made yet (the screen offers to make them), newest first. */
export async function giftsOpenOf(db: any, tenantId: string): Promise<{ orderId: string; number: string; channel: string }[]> {
  const snap = await db.collection(`tenants/${tenantId}/counterOrders`).where('giftsOpen', '==', true).limit(10).get().catch(() => ({ docs: [] as any[] }));
  return snap.docs.map((d: any) => ({ orderId: d.id, number: String(d.data()?.number || ''), channel: String(d.data()?.channel || 'counter'), paidAt: String(d.data()?.paidAt || '') }))
    .sort((a: any, b: any) => b.paidAt.localeCompare(a.paidAt)).map(({ paidAt: _p, ...x }: any) => x);
}

/** The gift cards on a paid order, made (the ones not made yet) and sent: each one as it is now. */
export async function issueCounterGifts(db: any, tenantId: string, orderId: string, by: string): Promise<GiftMade[]> {
  if (!ID.test(orderId)) return [];
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  const token = randomBytes(6).toString('hex'); const claimAt = new Date().toISOString();
  // 1. The ones not made yet, claimed in one step (two screens asking at once make each one once, and send it once).
  const c: any = await db.runTransaction(async (tx: any) => {
    // (Paid with money: never a staff meal or a delivery app's order, which can't carry one.)
    const o: any = (await tx.get(ref)).data(); if (!o?.paidAt || o.status === 'voided' || o.staffMeal || o.payMethod === 'staff' || o.payMethod === 'app') return null;
    const lines: any[] = Array.isArray(o.lines) ? o.lines : [];
    let mine = 0;
    const next = lines.map((l) => {
      if (!isGiftLine(l) || l.giftCard.id) return l;
      const cl = l.giftCard.claim; if (cl && Date.parse(String(cl.at)) > Date.now() - CLAIM_MS) return l;
      mine++; return { ...l, giftCard: { ...l.giftCard, claim: { token, at: claimAt } } };
    });
    if (mine) tx.set(ref, { lines: next }, { merge: true });
    return { o, lines: next, mine };
  });
  if (!c) return [];
  const o: any = c.o; const gifts: any[] = c.lines.filter(isGiftLine);
  if (!c.mine) return gifts.map(madeOf);
  const tenant: any = (await db.doc(T).get()).data() || {};
  // The buyer: their rewards code on the order (never a number someone only said), for the bonus and the card's record.
  const member = o.clientId && o.points?.verified === true && ID.test(String(o.clientId)) ? String(o.clientId) : null;
  const client: any = member ? (await db.doc(`${T}/clients/${member}`).get()).data() || null : null;
  const buyer = { id: client ? member : null, name: String(client?.name || o.guestName || '').slice(0, 60) || null, email: client?.email || null, phone: client?.phone || null };
  // 2. Each one claimed here: made, sent, and the bonus.
  const done = new Map<string, Partial<GiftOnLine>>();
  for (const l of gifts) {
    const g: GiftOnLine = l.giftCard;
    if (g.id || g.claim?.token !== token) continue;
    try {
      const r: any = await issueGiftCard(db, tenantId, { docId: `cgift_${orderId}_${String(l.lineId).replace(/[^A-Za-z0-9_-]/g, '')}`, amountCents: Math.round(num(l.unitPrice) * 100), by, source: 'desk',
        purchaser: { id: buyer.id, name: buyer.name }, recipient: { id: null, name: g.to, phone: g.phone, email: g.email }, sendVia: g.via, transactionId: `counter_${orderId}_giftsale`, orderId, locationId: o.locationId ? String(o.locationId) : null });
      if (!r.ok) throw new Error(r.error || 'not made');
      const card: any = r.card;
      let sent = !!card.sentAt;
      // (Sent once: a try still sending, past its claim on the line, is let be.)
      if (!sent && (g.via === 'text' || g.via === 'email') && await sendClaim(db, `${T}/giftCards/${card.id}`)) sent = !!(await deliverGiftCard(db, tenantId, tenant, card).catch(() => ({ sent: false }))).sent;
      // (Made already by a try whose answer was lost: its bonus was given then.)
      let bonusCode: string | null = null;
      if (card.bonusCardId && ID.test(String(card.bonusCardId))) bonusCode = (await db.doc(`${T}/giftCards/${card.bonusCardId}`).get()).data()?.code || null;
      else { const b: any = await giveBonus(db, tenantId, tenant, { channel: 'desk', forCard: card, buyer, by }).catch(() => null); bonusCode = b?.code || null; }
      done.set(String(l.lineId), { id: card.id, code: card.code, sent, failed: null, claim: null, ...(bonusCode ? { bonusCode } : {}) });
    } catch (e: any) {
      console.error('[counter-gift] not made', orderId, l.lineId, e?.message);
      done.set(String(l.lineId), { failed: 'not made', claim: null });
    }
  }
  // 3. Each one's code onto its line, as the order is now (only the ones this try claimed).
  const after: any = await db.runTransaction(async (tx: any) => {
    const o2: any = (await tx.get(ref)).data() || {};
    const lines2 = (Array.isArray(o2.lines) ? o2.lines : []).map((l: any) => { const d = done.get(String(l.lineId)); return d && isGiftLine(l) && l.giftCard.claim?.token === token ? { ...l, giftCard: { ...l.giftCard, ...d } } : l; });
    const ids = lines2.filter(isGiftLine).map((l: any) => l.giftCard.id).filter(Boolean);
    tx.set(ref, { lines: lines2, ...(ids.length ? { giftCardIds: ids } : {}), giftsOpen: lines2.some((l: any) => isGiftLine(l) && !l.giftCard.id) }, { merge: true });
    return lines2;
  });
  return after.filter(isGiftLine).map(madeOf);
}
