// src/lib/ready-text.ts — A TEXT WHEN IT'S READY (server; design board "Ready texts and order again"). A guest asks for
// one text when their order is ready: at the kiosk after paying (api/kiosk 'textMe'), ordering ahead (api/counter/ahead
// 'place' and 'textMe'), or by telling the counter (api/counter 'readyText'). It goes once, the moment every part of the
// order is ready on the kitchen screen (api/kitchen, after a ticket is marked ready: textWhenTicketsReady), and it's
// never used for anything else: the number is kept on the order only, and once the text has gone, the order is all
// picked up on the kitchen screen, voided or dropped, or it's been waiting six hours (sweepReadyTexts), only its last four
// digits are left. The business's text log keeps the last four digits only, and the text without its link (lib/sms
// `forget`); the STOP list and the first-text record keep the number, as for every text, so a STOP is always honored.
//   counterOrders/{id}.readyText = { to: '+1…' | null, last4, via: 'kiosk' | 'ahead' | 'counter', pendingSince: iso | null,
//     sentAt: iso | null, ok?: boolean, failed?: 'stopped' | 'not_sent' | null }
// Offered only where the business can text (lib/sms smsConfigured) and hasn't turned it off on the Menu page
// (tenant.readyTexts.off). A number that replied STOP gets nothing (lib/sms sendTenantSms).
import { sendTenantSms, smsConfigured, toE164 } from '@/lib/sms';
import { linkOrigin } from '@/lib/app-origin';
import { orderLangOf } from '@/lib/guest-lang';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });

/** The orders a guest can ask about: the counter's, a kiosk's and ones placed ahead (the drive-thru's cars wait at the window). */
export const READY_CHANNELS = ['counter', 'kiosk', 'ahead'];
export type ReadyVia = 'kiosk' | 'ahead' | 'counter';
/** A number not texted after this long (an order never finished) is let go. */
export const PENDING_HOURS = 6;
const LIVE_GONE = ['cancelled', 'voided'];
const READY = ['ready', 'delivered', 'served', 'done'];
const HANDED = ['delivered', 'served', 'done'];

/** Whether this business offers the text: it can text, and hasn't turned it off. */
export function readyTextsOn(tenant: any): boolean {
  return smsConfigured() && tenant?.readyTexts?.off !== true;
}

export const lastFour = (e164: string) => String(e164 || '').replace(/\D/g, '').slice(-4);

/** Ready to text: every part of it ready, and not all handed over already (then they have it). */
export function readyToText(order: any, tickets: any[]): boolean {
  if (!order || order.status !== 'sent') return false;
  const live = tickets.filter((t) => t && !LIVE_GONE.includes(String(t.status)));
  if (!live.length || !live.every((t) => READY.includes(String(t.status)))) return false;
  return !live.every((t) => HANDED.includes(String(t.status)));
}

/** How long a send may take before its answer is overdue: sent with no answer after this, it may not have gone. */
const ANSWER_MS = 2 * 60000;
/** What the guest sees on their order: asked (the last four digits), sent, or nothing. `failed`: it didn't go, or it was
 *  sent with no answer (the process stopped mid-send), so nothing ever says "texted" for one that may not have gone.
 *  (A number let go leaves `last4` and `via` behind with `to` and `pendingSince` cleared: that's not one waiting.) */
export function readyTextView(order: any, now = Date.now()): { last4: string; sent: boolean; failed: boolean } | null {
  const r = order?.readyText; if (!r || !r.last4) return null;
  if (!r.to && !r.sentAt) return null;   // let go without being sent (handed over, voided, dropped, or waited too long)
  const overdue = !!r.sentAt && r.ok !== true && r.ok !== false && now - (Date.parse(String(r.sentAt)) || now) > ANSWER_MS;
  return { last4: String(r.last4), sent: !!r.sentAt, failed: !!r.sentAt && (r.ok === false || overdue) };
}

/** What the text says (the business's name goes first: lib/sms). Placed ahead: how to pick it up, and the order's page.
 *  In Spanish when the guest ordered in Spanish (lib/guest-lang orderLangOf: the order-ahead page or the kiosk). */
export function readyWords(order: any, link: string | null): string {
  const n = String(order?.number || '').trim(); const es = orderLangOf(order) === 'es';
  const what = es ? (n ? `Su pedido ${n} está listo.` : 'Su pedido está listo.') : n ? `Order ${n} is ready.` : 'Your order is ready.';
  const page = link ? (es ? ` Su pedido: ${link}` : ` Your order: ${link}`) : '';
  if (order?.channel !== 'ahead') return `${what} ${es ? 'Recójalo en el mostrador.' : 'Pick it up at the counter.'}`;
  const way = order?.ahead?.way;
  // Delivered by the business's drivers (lib/food-delivery): told when it leaves, not when it's ready.
  if (way === 'delivery') return es ? `${n ? `Su pedido ${n}` : 'Su pedido'} va en camino.${page}` : `${n ? `Order ${n}` : 'Your order'} is on its way.${page}`;
  const then = es ? (way === 'drive-thru' ? ' Entre al drive-thru y diga su código en la bocina.' : way === 'curbside' ? ' Toque Ya llegué al estacionarse y se lo llevamos.' : ' Muestre su código en el mostrador.')
    : way === 'drive-thru' ? ' Pull into the drive-thru and say your code at the speaker.'
    : way === 'curbside' ? ' Tap I’m here when you park, and we’ll bring it out.'
    : ' Show your code at the counter.';
  return `${what}${then}${page}`;
}

/** Ask for the text (or `phone` null: don't text after all). Already ready: it goes now. */
export async function askReadyText(db: any, tenantId: string, tenant: any, orderId: string, phone: unknown, via: ReadyVia): Promise<{ ok: true; last4: string | null; sent: boolean } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  if (phone === null || phone === '' || phone === undefined) {
    const r = await db.runTransaction(async (tx: any) => {
      const or: any = (await tx.get(ref)).data();
      if (!or || !READY_CHANNELS.includes(String(or.channel))) return fail('That order isn’t here.', 404);
      if (or.readyText?.sentAt) return fail('It’s ready, and the text has gone already.', 409, 'sent');
      if (or.readyText) tx.set(ref, { readyText: { to: null, last4: null, pendingSince: null } }, { merge: true });
      return { ok: true as const, last4: null, sent: false };
    });
    return r;
  }
  if (!readyTextsOn(tenant)) return fail('Texts aren’t available here.', 409, 'off');
  const digits = String(phone ?? '').replace(/\D/g, '').slice(-10);
  const to = digits.length === 10 ? toE164(digits) : null;
  if (!to) return fail('A 10-digit mobile number, please.', 400, 'phone');
  const nowIso = new Date().toISOString();
  const r: any = await db.runTransaction(async (tx: any) => {
    const or: any = (await tx.get(ref)).data();
    if (!or || !READY_CHANNELS.includes(String(or.channel))) return fail('That order isn’t here.', 404);
    if (or.status === 'voided' || or.status === 'done' || or.status === 'cancelled') return fail('That order is done.', 409, 'done');
    if (or.readyText?.sentAt) return fail('It’s ready, and the text has gone already.', 409, 'sent');
    // (Nothing for the kitchen to make, only what was rung in that isn't on the menu: it's ready already, so no text.)
    if (or.kitchenNone === true) return fail('It’s ready now. There’s nothing for the kitchen to make.', 409, 'ready');
    tx.set(ref, { readyText: { to, last4: lastFour(to), via, pendingSince: nowIso, sentAt: null, ok: null, failed: null } }, { merge: true });
    return { ok: true as const, last4: lastFour(to), sent: false };
  });
  if (!r.ok) return r;
  // Asked once it's all ready already (the kiosk's paid screen, the order page): the text goes now.
  const sent = (await textIfReady(db, tenantId, [orderId])) > 0;
  return { ...r, sent };
}

/** These orders' texts, if they're ready now (each claimed in one step, so it never goes twice). How many went.
 *  `onWay`: a delivery just left with its driver (lib/food-delivery-server), its text goes now; a delivery's text never
 *  goes when it's only ready. */
export async function textIfReady(db: any, tenantId: string, orderIds: string[], opts: { onWay?: boolean } = {}): Promise<number> {
  let went = 0;
  for (const id of Array.from(new Set(orderIds)).filter((x) => ID.test(x)).slice(0, 20)) {
    try {
      const ref = db.doc(`tenants/${tenantId}/counterOrders/${id}`);
      const pre: any = (await ref.get()).data();
      if (!pre?.readyText?.to || pre.readyText.sentAt) continue;
      const delivery = pre.ahead?.way === 'delivery';
      if (delivery !== !!opts.onWay) continue;
      // Voided, handed over or dropped meanwhile: nothing to tell them, and the number goes. (A delivery is done for the
      // kitchen as it leaves: that's when its text goes.)
      if (['voided', 'cancelled'].includes(String(pre.status)) || (!delivery && pre.status === 'done')) { await ref.set({ readyText: { to: null, pendingSince: null } }, { merge: true }); continue; }
      const tickets = (await db.collection(`tenants/${tenantId}/kdsTickets`).where('orderId', '==', id).get()).docs.map((d: any) => d.data() || {});
      const live = tickets.filter((t: any) => !LIVE_GONE.includes(String(t.status)));
      // Handed over before it was ever marked ready (or nothing to make): nothing to tell them, and the number goes.
      if (!delivery && live.length && live.every((t: any) => HANDED.includes(String(t.status)))) { await ref.set({ readyText: { to: null, pendingSince: null } }, { merge: true }); continue; }
      // (Nothing left for the kitchen, only what was rung in that isn't on the menu, once the rest came off: ready now.)
      const nothingToMake = pre.kitchenNone === true && pre.status === 'sent' && !live.length;
      if (!delivery && !readyToText(pre, tickets) && !nothingToMake) continue;
      const claim = await db.runTransaction(async (tx: any) => {
        const or: any = (await tx.get(ref)).data();
        if (!or?.readyText?.to || or.readyText.sentAt) return null;
        if (delivery ? or.ahead?.delivery?.state !== 'out' : or.status !== 'sent') { tx.set(ref, { readyText: { to: null, pendingSince: null } }, { merge: true }); return null; }
        tx.set(ref, { readyText: { to: null, pendingSince: null, sentAt: new Date().toISOString() } }, { merge: true });
        return { or: { ...or, id }, to: String(or.readyText.to) };
      });
      if (!claim) continue;
      let link: string | null = null;
      if (claim.or.channel === 'ahead') {
        const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
        const { aheadSig } = await import('@/lib/counter-ahead');
        const s = aheadSig(tenantId, id); const base = linkOrigin(tenant, null);
        if (s && base) link = `${base}/order/${encodeURIComponent(tenantId)}?o=${encodeURIComponent(id)}&s=${encodeURIComponent(s)}${orderLangOf(claim.or) === 'es' ? '&lang=es' : ''}`;
      }
      // The text log keeps the last four digits and the words without the order's link (lib/sms `forget`).
      let r: any;
      try { r = await sendTenantSms(db, tenantId, claim.to, readyWords(claim.or, link), undefined, { kind: 'order_ready', recipientType: 'other', skipMessageLog: true, forget: true, logBody: readyWords(claim.or, null) }); }
      catch (e: any) { r = { ok: false, error: e?.message }; }
      await ref.set({ readyText: { ok: !!r?.ok, failed: r?.ok ? null : r?.optedOut ? 'stopped' : 'not_sent' } }, { merge: true });
      if (r?.ok) went++;
    } catch (e: any) { console.error('[ready-text]', id, e?.message); }
  }
  return went;
}

/** After kitchen tickets are marked ready (or picked up): the texts for their orders, if each order is now all ready; an
 *  order all picked up before it was ever ready lets its number go. */
export async function textWhenTicketsReady(db: any, tenantId: string, ticketIds: string[]): Promise<number> {
  try {
    const ids = Array.from(new Set(ticketIds.filter((x) => ID.test(x)))).slice(0, 200); if (!ids.length) return 0;
    const docs = await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/kdsTickets/${id}`)));
    const orders = new Set<string>();
    for (const d of docs) { const t: any = d.exists ? d.data() || {} : null; if (t && (t.status === 'ready' || t.status === 'delivered') && READY_CHANNELS.includes(String(t.channel)) && ID.test(String(t.orderId || ''))) orders.add(String(t.orderId)); }
    return orders.size ? await textIfReady(db, tenantId, Array.from(orders)) : 0;
  } catch (e: any) { console.error('[ready-text] tickets', e?.message); return 0; }
}

/** Numbers left waiting too long (an order never finished): let go. A sweep (cron/retail-payments). */
export async function sweepReadyTexts(db: any, tenantId: string, now = Date.now()): Promise<number> {
  const before = new Date(now - PENDING_HOURS * 3600000).toISOString();
  const snap = await db.collection(`tenants/${tenantId}/counterOrders`).where('readyText.pendingSince', '<', before).limit(200).get();
  for (const d of snap.docs) await d.ref.set({ readyText: { to: null, pendingSince: null } }, { merge: true });
  return snap.size;
}
