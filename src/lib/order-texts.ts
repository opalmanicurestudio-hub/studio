// src/lib/order-texts.ts — A CUSTOMER'S TEXT ABOUT THEIR ORDER LANDS ON THAT ORDER. Someone who ordered from the shop
// texts back after the shop texted them about it (api/sms/inbound): their text joins the order's open case (or starts
// one), shows in the conversation on the order and in Problems under Messages, and the team is told. The shop answers
// from there; the customer gets it on their order page with a text pointing to it (lib/order-inbox). Server only.
//
// Whose text is it? A number on a paid order (from the last 30 days, or still on its way) that the shop last texted
// about an order: that order (the one the text named, or their newest). Anything else stays with the studio, as before:
// the last text was about an appointment, an offer or anything that isn't an order; or nothing was texted lately and
// it's a client the studio knows. A thank-you is kept on the conversation but never opens a case or pings anyone.
// Twilio sends a text again when it doesn't hear back: one text, once (by its id).
import { ORDER_PAGE_KINDS } from './order-inbox';

const DAY = 86400e3;
const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
export const last10 = (v: any) => String(v || '').replace(/\D+/g, '').slice(-10);
const e164 = (v: any) => { const d = last10(v); return d.length === 10 ? `+1${d}` : ''; };
const PAID_STAGES = ['paid', 'picking', 'packed', 'ready', 'arrived', 'shipped', 'completed', 'cancelled'];
const ON_ITS_WAY = ['paid', 'picking', 'packed', 'ready', 'arrived'];
const LIVE_APPT = ['confirmed', 'pending_payment', 'deposit_pending', 'requested', 'waiting', 'checked_in'];
/** A text about one of these is about an order (the order page's updates, and curbside texts). */
const orderKind = (k: any) => ORDER_PAGE_KINDS.has(String(k || '')) || String(k || '').startsWith('curbside_');
/** A short thank-you or okay: kept on the conversation, never a case or a ping on its own. */
export const justThanks = (s: string) => {
  const t = String(s || '').toLowerCase().replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ').replace(/[:;]-?[)D(p]|<3/g, ' ').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  return /^(ok(ay)?|k|kk|cool|great|perfect|awesome|amazing|sounds good|got it|will do|yes thanks?|(ok(ay)? |great |perfect |awesome |got it |cool )?(thanks?|thank you|thx|ty|tysm)( (so|very) much)?( again)?( you)?)$/.test(t);
};
const ANGRY = /furious|angry|unacceptable|ridiculous|scam|fraud|lawyer|dispute|chargeback|worst|terrible|awful|never again/i;

/** The order a text from this number is about, or null when it isn't about an order. */
export async function orderForText(db: any, t: string, from: string, o: { clientId?: string | null; now?: number } = {}): Promise<any | null> {
  const now = o.now ?? Date.now();
  const d = last10(from); if (d.length !== 10) return null;
  const since = new Date(now - 30 * DAY).toISOString();
  const col = db.collection(`tenants/${t}/retailOrders`);
  // Newest first; and anything still on its way however long ago it was placed (a pre-order, a backorder).
  const [recent, open] = await Promise.all([
    col.where('placedAt', '>=', since).orderBy('placedAt', 'desc').limit(300).get().catch(() => ({ docs: [] })),
    col.where('stage', 'in', ON_ITS_WAY).limit(300).get().catch(() => ({ docs: [] })),
  ]);
  const byId = new Map<string, any>();
  for (const x of [...recent.docs, ...open.docs]) byId.set(x.id, { ...(x.data() || {}), id: x.id });
  // Paid ones only: never a checkout left unpaid (a draft, or one that lapsed).
  const orders = [...byId.values()]
    .filter((x: any) => last10(x.customerPhone) === d && x.isDraft !== true && x.isTest !== true && PAID_STAGES.includes(String(x.stage)) && (!!x.paidAt || x.stage !== 'cancelled'))
    .sort((a: any, b: any) => ms(b.placedAt) - ms(a.placedAt));
  if (!orders.length) return null;
  // What the shop last texted them that went out (two weeks).
  const logs = (await db.collection(`tenants/${t}/messageLog`).where('to', '==', e164(from)).get().catch(() => ({ docs: [] }))).docs
    .map((x: any) => x.data() || {}).filter((m: any) => m.channel === 'sms' && !m.bouncedAt && !/^(failed|skipped)/.test(String(m.status || '')) && now - ms(m.sentAt) < 14 * DAY)
    .sort((a: any, b: any) => ms(b.sentAt) - ms(a.sentAt));
  const lastMsg = logs[0];
  const newest = orders.find((x: any) => !x.parentOrderId) || orders[0];
  if (lastMsg) {
    if (lastMsg.appointmentId) return null;
    const named = orders.find((x: any) => (lastMsg.orderId && x.id === lastMsg.orderId) || (lastMsg.recipientId && x.id === lastMsg.recipientId));
    if (named) return named;
    // An order the text named that's older than the ones read (a return or a refund on an order from months ago): that
    // order, read on its own, when it's theirs and paid; never another one in its place.
    const id = String(lastMsg.orderId || (orderKind(lastMsg.kind) ? lastMsg.recipientId || '' : ''));
    if (id && !id.includes('/')) {
      const os = await col.doc(id).get().catch(() => null);
      const x: any = os?.exists ? { ...(os.data() || {}), id } : null;
      if (x && last10(x.customerPhone) === d && x.isDraft !== true && x.isTest !== true && PAID_STAGES.includes(String(x.stage)) && (!!x.paidAt || x.stage !== 'cancelled')) return x;
      if (lastMsg.orderId) return null;
    }
    // About an order, but not one we can name: their newest. About anything else (an offer, aftercare, a thank-you for
    // their visit): the studio's.
    return orderKind(lastMsg.kind) ? newest : null;
  }
  // Nothing texted lately: a client the studio knows is the studio's; a number it doesn't know is a shop customer.
  if (o.clientId) return null;
  return newest;
}

export type TextResult = { orderId: string; caseId: string; created: boolean; reopened: boolean; quiet: boolean; duplicate?: boolean };

/** Puts a customer's text on the order: their open case, or the newest one (reopened, unless it's only a thank-you), or
 *  a new case. Returns where it went, or null when it isn't about an order. */
export async function textIntoOrder(db: any, t: string, m: { from: string; body: string; mediaCount?: number; mediaUrls?: string[]; clientId?: string | null; senderName?: string | null; sid?: string | null; now?: number }): Promise<TextResult | null> {
  const now = m.now ?? Date.now();
  const order = await orderForText(db, t, m.from, { clientId: m.clientId, now });
  if (!order) return null;
  const at = new Date(now).toISOString();
  const photos = Math.max(0, Number(m.mediaCount) || 0);
  // Their words only (they see their own messages on the order page); photos sent by text are counted for the team,
  // who find them in the shop's Twilio messages (their links are kept for when photos come straight in).
  const text = String(m.body || '').trim().slice(0, 1600) || (photos ? (photos === 1 ? 'Sent a photo' : `Sent ${photos} photos`) : '');
  const note = text || `${photos === 1 ? 'A photo' : `${photos} photos`} sent by text`;
  const num = `#${String(order.orderNumber ?? '').padStart(4, '0')}`;
  const sid = String(m.sid || '').replace(/[^\w-]/g, '').slice(0, 64);
  const thanks = justThanks(m.body) && !photos;
  const media = (Array.isArray(m.mediaUrls) ? m.mediaUrls : []).map(String).filter((u) => /^https:\/\//.test(u)).slice(0, 5);
  const { FieldValue } = await import('firebase-admin/firestore');
  const oRef = db.doc(`tenants/${t}/retailOrders/${order.id}`);
  const col = db.collection(`tenants/${t}/retailSupport`);
  // One text, once; and two texts at the same moment can't both start a case (the order is read and written in the
  // same step, so they take turns).
  const evRef = sid ? db.doc(`tenants/${t}/retailOrders/${order.id}/events/sms-${sid}`) : db.collection(`tenants/${t}/retailOrders/${order.id}/events`).doc();
  const res: TextResult = await db.runTransaction(async (tx: any) => {
    const os = await tx.get(oRef);
    const ev = sid ? await tx.get(evRef) : null;
    if (ev?.exists) return { orderId: order.id, caseId: String(ev.data()?.meta?.caseId || ''), created: false, reopened: false, quiet: true, duplicate: true };
    const cases = (await tx.get(col.where('orderId', '==', order.id))).docs.map((x: any) => ({ ...(x.data() || {}), id: x.id }));
    const latestOf = (xs: any[]) => [...xs].sort((a, b) => Math.max(ms(b.lastCustomerAt), ms(b.createdAt)) - Math.max(ms(a.lastCustomerAt), ms(a.createdAt)))[0] || null;
    const open = latestOf(cases.filter((c: any) => c.status !== 'resolved'));
    const latest = latestOf(cases);
    const follow: any = { at, message: text, photoUrls: [], kind: 'sms', ...(photos ? { smsPhotos: photos } : {}), ...(sid ? { smsSid: sid } : {}), ...(media.length ? { mediaUrls: media } : {}) };
    let out: TextResult;
    if (open) {
      // A thank-you after the shop's last word is only kept; anything else waits on the shop.
      const lastReply = Math.max(0, ...(Array.isArray(open.replies) ? open.replies : []).map((r: any) => ms(r.at)));
      // (A quiet one never moves when they last wrote, so a second thank-you is quiet too, and it isn't waiting.)
      const quiet = thanks && lastReply > Math.max(ms(open.lastCustomerAt), ms(open.createdAt));
      tx.set(col.doc(open.id), quiet ? { followUps: FieldValue.arrayUnion({ ...follow, quiet: true }) }
        : { followUps: FieldValue.arrayUnion(follow), lastCustomerAt: at, customerMessagesSinceStaffReply: FieldValue.increment(1), ...(ANGRY.test(text) ? { priority: 'urgent' } : {}) }, { merge: true });
      out = { orderId: order.id, caseId: open.id, created: false, reopened: false, quiet };
    } else if (thanks) {
      // Nothing open: a thank-you is kept with the last conversation, if there is one, and that's all.
      if (latest) tx.set(col.doc(latest.id), { followUps: FieldValue.arrayUnion({ ...follow, quiet: true }) }, { merge: true });
      out = { orderId: order.id, caseId: latest?.id || '', created: false, reopened: false, quiet: true };
    } else if (latest && now - Math.max(ms(latest.resolvedAt), ms(latest.lastCustomerAt), ms(latest.createdAt)) < 14 * DAY) {
      tx.set(col.doc(latest.id), { followUps: FieldValue.arrayUnion(follow), lastCustomerAt: at, customerMessagesSinceStaffReply: FieldValue.increment(1), status: 'open', resolvedAt: null, resolvedBy: null, ...(ANGRY.test(text) ? { priority: 'urgent' } : {}) }, { merge: true });
      out = { orderId: order.id, caseId: latest.id, created: false, reopened: true, quiet: false };
    } else {
      const ref = col.doc();
      tx.set(ref, {
        id: ref.id, tenantId: t, orderId: order.id, orderNumber: order.orderNumber ?? null,
        customerName: order.customerName || 'Customer', customerEmail: order.customerEmail || '', customerPhone: order.customerPhone || '',
        stageAtRequest: order.stage || '', message: text, via: 'sms', ...(photos ? { smsPhotos: photos } : {}), ...(sid ? { smsSid: sid } : {}), status: 'open', createdAt: at, lastCustomerAt: at,
        category: 'other', caseRef: `${order.orderNumber ?? ''}-${cases.length + 1}`,
        followUps: [], customerMessagesSinceStaffReply: 1, priority: ANGRY.test(text) ? 'urgent' : 'normal', photoUrls: [], replies: [],
        ...(media.length ? { mediaUrls: media } : {}),
      });
      out = { orderId: order.id, caseId: ref.id, created: true, reopened: false, quiet: false };
    }
    tx.set(evRef, { id: evRef.id, type: 'note', at, actorId: 'customer', actorName: order.customerName || 'Customer', meta: { kind: 'customer_text', caseId: out.caseId, text: `Customer texted: ${note.slice(0, 120)}` } });
    tx.update(oRef, { textsIn: (Number(os.data()?.textsIn) || 0) + 1 });
    return out;
  });
  if (res.duplicate) return res;
  // Kept with the studio's record of texts too (the client's conversation, the evening report), marked as answered on
  // the order, so it isn't waiting in the studio's inbox.
  try {
    const inbox = db.collection(`tenants/${t}/smsInbox`); const iRef = sid ? inbox.doc(`sms_${sid}`) : inbox.doc();
    await iRef.set({ id: iRef.id, tenantId: t, at, from: m.from, fromName: m.senderName || order.customerName || m.from, senderType: m.clientId ? 'client' : 'unknown', channel: 'sms',
      clientId: m.clientId || null, clientName: m.clientId ? m.senderName || null : null, body: m.body || null, mediaCount: photos, readAt: at, readBy: 'On the order', routedOrderId: order.id, routedCaseId: res.caseId || null }, { merge: true });
  } catch { /* the order has it */ }
  if (!res.quiet) {
    try {
      const n = db.collection(`tenants/${t}/notifications`).doc();
      await n.set({ id: n.id, type: 'sms', read: false, createdAt: at, link: `/retail-orders/problems?order=${order.id}`, message: `${String(order.customerName || 'A customer').split(' ')[0]} texted about order ${num}: “${note.slice(0, 120)}”` });
    } catch { /* it's on the order and in Problems either way */ }
  }
  return res;
}
