// src/lib/retail-swap-server.ts — SWAPS ON THE SERVER. Offering a replacement, applying it, refunding instead, and
// the customer's answer (from their order page or a YES/NO text) all run here in transactions, so the stock, the order
// and the money move together, and two answers can't both win. The swap arithmetic itself is lib/retail-swap.
import { isClaimStale, shrinkStock } from './retail-orders';
import { choiceFor, variantIdsOf, variantPriceCents } from './variants';
import { discountedCents } from './retail-wholesale';
import { ensureCodeIndex } from './code-index';
import { nanoid } from 'nanoid';
import { taxShareCents } from './restocking';
import { SWAP_ANSWER_HOURS, lineIfOut, swapCapCents, swapLines, type SwapItem } from './retail-swap';
import { brandedEmailHtml } from './email-template';
import { effectiveUnitCents } from '@/lib/retail-swap';
import { autoRefund, refundWords } from './auto-refund';
import { queueAndSend } from './order-outbox';
import { TELL_AFTER_MS, changesKey, packChanges, untoldSince } from './pack-changes';

type Actor = { id: string; name: string };
const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const last10 = (p: string) => String(p || '').replace(/\D/g, '').slice(-10);
const orderRef = (db: any, t: string, id: string) => db.collection(`tenants/${t}/retailOrders`).doc(id);
const OPEN_STAGES = ['paid', 'picking'];

/** The replacement as the shop sells it today, read from the catalog, never from the caller: at the order's price (a
 *  wholesale order's wholesale price, less its account's discount, as checkout charged it). */
export async function catalogItem(db: any, t: string, productId: string, order?: any): Promise<SwapItem | null> {
  // Each variant points at its listing first (variants saved before that are pointed the first time anything asks).
  await ensureCodeIndex(db, t).catch(() => {});
  const s = await db.collection(`tenants/${t}/inventory`).doc(productId).get();
  if (!s.exists) return null; const i = { ...(s.data() as any), id: productId };
  // A variant sells as its listing and choice, for its own price or the listing's (lib/variants).
  let listing: any = null;
  if (i.parentId && i.parentId !== productId) { const ls = await db.collection(`tenants/${t}/inventory`).doc(String(i.parentId)).get(); const l = ls.exists ? { ...(ls.data() as any), id: ls.id } : null; if (l && choiceFor(l, productId)) listing = l; }
  const wholesale = order?.priceTier === 'wholesale';
  let pct = 0;
  if (wholesale) {
    pct = Number(order.wholesaleDiscountPct);
    if (!Number.isFinite(pct) && order.wholesaleAccountId) { const a = await db.collection(`tenants/${t}/wholesaleAccounts`).doc(String(order.wholesaleAccountId)).get().catch(() => null); pct = Number(a?.exists ? a.data()?.extraDiscountPercent : 0); }
    pct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  }
  const base = listing ? variantPriceCents(i, listing, wholesale ? 'wholesale' : 'retail')
    : wholesale && Number(i.wholesalePriceDollars) > 0 ? Math.round(Number(i.wholesalePriceDollars) * 100) : Math.round((Number(i.msrp) || 0) * 100);
  const price = wholesale ? discountedCents(base, pct) : base; if (price <= 0) return null;
  const c = listing ? choiceFor(listing, productId) : null;
  // Named as its listing and choice ("Rose cuticle oil · Clear"), the way the customer's messages and the order show it.
  return { productId, name: c ? `${listing.name || i.name || 'Item'} \u00b7 ${c.choice.label}` : String(i.name || 'Item'), ...(c ? { listingId: String(listing.id) } : {}), unitPriceCents: price, sku: i.sku || '', barcode: i.barcode || '', imageUrl: (Array.isArray(i.imageUrls) && i.imageUrls[0]) || i.imageUrl || (listing && Array.isArray(listing.imageUrls) && listing.imageUrls[0]) || '' };
}

/** A replacement the customer, or the packer, may use for `line` today: the product as the shop sells it (lib/variants),
 *  sold online, in stock, never a product the shop never swaps, never sold to licensed pros only on an item that wasn't,
 *  and never dearer than what was paid for the line (up to the shop's limit when it covers the difference itself,
 *  lib/retail-swap swapCapCents). The reason in the customer's words when it can't. */
export async function swapCandidate(db: any, t: string, productId: string, line: any, order: any, rs: any): Promise<{ ok: true; item: SwapItem } | { ok: false; message: string }> {
  const id = String(productId || '');
  if (!id || id === String(line?.productId || '')) return { ok: false, message: 'Pick a different item as the backup.' };
  const s = await db.collection(`tenants/${t}/inventory`).doc(id).get();
  if (!s.exists) return { ok: false, message: 'That backup isn’t for sale any more. Pick another.' };
  const i: any = s.data() || {};
  // A product as it's sold: never a listing that sells as its variants, never something that isn't a shop product.
  if (i.type !== 'retail' || variantIdsOf({ ...i, id }).length > 0) return { ok: false, message: 'Pick one color or size as the backup.' };
  let l: any = null;
  if (i.parentId && i.parentId !== id) { const ls = await db.collection(`tenants/${t}/inventory`).doc(String(i.parentId)).get(); l = ls.exists ? ls.data() : null; }
  const shown = (x: any) => !!x && x.status !== 'archived' && x.showOnline === true;
  if (i.status === 'archived' || (l ? !shown(l) || l.status === 'archived' : !shown(i)) || i.digital === true || i.giftCard === true) return { ok: false, message: 'That backup isn’t for sale online. Pick another.' };
  if (i.noSwap === true || l?.noSwap === true) return { ok: false, message: 'That product isn’t used as a swap. Pick another.' };
  if ((i.prosOnly === true || l?.prosOnly === true) && line?.prosOnly !== true) return { ok: false, message: 'That’s for licensed pros only. Pick another.' };
  if ((Number(i.totalStock) || 0) - (Number(i.stockReserved) || 0) <= 0) return { ok: false, message: 'That backup is out too. Pick another.' };
  const item = await catalogItem(db, t, id, order);
  if (!item) return { ok: false, message: 'That backup isn’t for sale right now. Pick another.' };
  if (item.unitPriceCents > swapCapCents(Number(line?.unitPriceCents) || 0, rs)) return { ok: false, message: `${item.name} costs more than what was paid for this item. Pick one at the same price or less.` };
  return { ok: true, item };
}

/** Sold to licensed pros only: the product, or the listing a variant sells in (lib/pro-license). */
async function forProsOnly(db: any, t: string, productId: string): Promise<boolean> {
  const s = await db.collection(`tenants/${t}/inventory`).doc(productId).get(); if (!s.exists) return false;
  const i: any = s.data() || {}; if (i.prosOnly === true) return true;
  if (!i.parentId || i.parentId === productId) return false;
  const l = await db.collection(`tenants/${t}/inventory`).doc(String(i.parentId)).get();
  return l.exists && (l.data() as any)?.prosOnly === true;
}

function correction(productId: string, change: number, reason: string, orderId: string, actor: Actor) {
  return { productId, change, unit: 'units', reason, date: new Date().toISOString(), orderId, actorId: actor.id, actorName: actor.name, source: 'retail_engine' };
}

export async function applySwap(db: any, t: string, orderId: string, lineId: string, sub: SwapItem, actor: Actor, via: string): Promise<{ ok: boolean; message: string; refundCents?: number; order?: any }> {
  const ref = orderRef(db, t, orderId);
  try {
    return await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref); if (!snap.exists) return { ok: false, message: 'Order not found.' };
      const o = { ...(snap.data() as any), id: orderId };
      if (!OPEN_STAGES.includes(o.stage)) return { ok: false, message: 'This order has already moved on.' };
      const line = (o.lines || []).find((l: any) => l.lineId === lineId); if (!line) return { ok: false, message: 'That item isn’t on this order.' };
      const origRef = db.collection(`tenants/${t}/inventory`).doc(String(line.productId));
      const subRef = db.collection(`tenants/${t}/inventory`).doc(sub.productId);
      const [origSnap, subSnap] = await Promise.all([tx.get(origRef), tx.get(subRef)]);
      const r = swapLines(o, lineId, sub, `line-${nanoid(8)}`);
      if (subSnap.exists) {
        const it = subSnap.data() as any; const free = (Number(it.totalStock) || 0) - (Number(it.stockReserved) || 0);
        if (free < r.qty) return { ok: false, message: `Only ${Math.max(0, free)} of ${sub.name} left. Pick something else.` };
        tx.update(subRef, { stockReserved: (Number(it.stockReserved) || 0) + r.qty });
      }
      if (origSnap.exists) {
        const it = origSnap.data() as any;
        tx.update(origRef, { ...shrinkStock(it, r.qty), stockReserved: Math.max(0, (Number(it.stockReserved) || 0) - r.qty) });
        tx.set(db.collection(`tenants/${t}/stockCorrections`).doc(), correction(String(line.productId), -r.qty, `Not on the shelf, swapped (Order #${o.orderNumber})`, orderId, actor));
      }
      tx.update(ref, { lines: JSON.parse(JSON.stringify(r.lines)), pendingRefundCents: (Number(o.pendingRefundCents) || 0) + r.refundCents, swapOffer: null, swapPendingPhone: null });
      const ev = ref.collection('events').doc();
      tx.set(ev, { id: ev.id, type: 'note', at: new Date().toISOString(), actorId: actor.id, actorName: actor.name, meta: { kind: 'line_swapped', text: `${line.name} swapped for ${sub.name} (${via})${r.refundCents ? `, ${money(r.refundCents)} to refund` : ''}`, lineId, newLineId: r.newLine.lineId } });
      return { ok: true, refundCents: r.refundCents, order: o, message: `Swapped for ${sub.name}.${r.refundCents ? ` ${money(r.refundCents)} difference queued to refund.` : ''}` };
    });
  } catch (e: any) { return { ok: false, message: e?.message || 'Couldn’t swap that item.' }; }
}

export async function refundInstead(db: any, t: string, orderId: string, lineId: string, actor: Actor, why: string): Promise<{ ok: boolean; message: string; refundCents?: number; order?: any }> {
  const ref = orderRef(db, t, orderId);
  try {
    return await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref); if (!snap.exists) return { ok: false, message: 'Order not found.' };
      const o = { ...(snap.data() as any), id: orderId };
      if (!OPEN_STAGES.includes(o.stage)) return { ok: false, message: 'This order has already moved on.' };
      const idx = (o.lines || []).findIndex((l: any) => l.lineId === lineId); if (idx < 0) return { ok: false, message: 'That item isn’t on this order.' };
      const line = o.lines[idx];
      const qty = (Number(line.qtyOrdered) || 0) - (Number(line.qtyScanned) || 0) - (Number(line.qtyShorted) || 0);
      if (qty <= 0) return { ok: false, message: 'Nothing left to refund on that item.' };
      const iRef = db.collection(`tenants/${t}/inventory`).doc(String(line.productId));
      const iSnap = await tx.get(iRef);
      const items = qty * effectiveUnitCents(line); const cents = items + taxShareCents(o, items);
      const lines = [...o.lines]; lines[idx] = { ...line, qtyShorted: (Number(line.qtyShorted) || 0) + qty, status: 'refunded', shortReason: why };
      if (iSnap.exists) {
        const it = iSnap.data() as any;
        tx.update(iRef, { ...shrinkStock(it, qty), stockReserved: Math.max(0, (Number(it.stockReserved) || 0) - qty) });
        tx.set(db.collection(`tenants/${t}/stockCorrections`).doc(), correction(String(line.productId), -qty, `Not on the shelf (Order #${o.orderNumber})`, orderId, actor));
      }
      tx.update(ref, { lines: JSON.parse(JSON.stringify(lines)), pendingRefundCents: (Number(o.pendingRefundCents) || 0) + cents, swapOffer: null, swapPendingPhone: null });
      const ev = ref.collection('events').doc();
      tx.set(ev, { id: ev.id, type: 'line_shorted', at: new Date().toISOString(), actorId: actor.id, actorName: actor.name, meta: { lineId, qtyShorted: qty, reason: why, resolution: 'refund' } });
      return { ok: true, refundCents: cents, order: o, message: `${money(cents)} queued to refund.` };
    });
  } catch (e: any) { return { ok: false, message: e?.message || 'Couldn’t refund that item.' }; }
}

async function tell(db: any, t: string, o: any, origin: string, sms: string, subject: string, title: string, body: string[]) {
  const { sendNotification } = await import('./notify');
  const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {};
  const shop = String(tenant.businessName || tenant.name || 'The shop');
  const link = origin ? `${origin}/shop/${t}/order/${o.id}` : '';
  if (o.customerPhone) { try { await sendNotification(db, { tenantId: t, channel: 'sms', to: o.customerPhone, text: `${shop}: ${sms}${link && !sms.includes('http') ? ` ${link}` : ''}`, kind: 'order_swap', orderId: o.id, recipientType: 'client', recipientId: o.clientId || null } as any); } catch { /* email still goes */ } }
  if (o.customerEmail) {
    try {
      const html = brandedEmailHtml({ studioName: shop, title, bodyLines: [...body, `Kind regards, ${shop}`], cta: link ? { label: 'View my order', url: link } : null, footerNote: `You are receiving this because you placed order #${String(o.orderNumber).padStart(4, '0')} with ${shop}.` });
      await sendNotification(db, { tenantId: t, channel: 'email', to: o.customerEmail, subject, html, kind: 'order_swap', orderId: o.id, recipientType: 'client' } as any);
    } catch { /* best effort */ }
  }
}

/** Staff found an item missing and picked a replacement, as the customer chose at checkout for that item
 *  (lib/retail-swap lineIfOut): their own backup, or the best match, goes in straight away, never dearer than what they
 *  paid (swapCandidate), and they hear once, when packing is done, what changed (lib/pack-changes); an item they asked
 *  to have refunded isn't swapped. Only an order placed when customers could ask to be asked is still asked, by text
 *  and email, with SWAP_ANSWER_HOURS to answer. */
export async function offerSwap(db: any, t: string, orderId: string, lineId: string, productId: string, actor: Actor, origin: string, forceAsk = false): Promise<{ ok: boolean; message: string; asked?: boolean }> {
  const snap = await orderRef(db, t, orderId).get(); if (!snap.exists) return { ok: false, message: 'Order not found.' };
  const o = { ...(snap.data() as any), id: orderId };
  const line = (o.lines || []).find((l: any) => l.lineId === lineId); if (!line) return { ok: false, message: 'That item isn’t on this order.' };
  const first = String(o.customerName || '').split(' ')[0] || 'there';
  const choice = lineIfOut(o, line);
  // Asked first only for an order placed when customers could ask to be asked: never to get round what they chose.
  if (choice.how !== 'ask') {
    if (choice.how === 'refund') return { ok: false, message: `${first} asked for a refund if this is out, so it isn’t swapped. Refund it, or send it when it’s back.` };
    if (choice.how === 'backup' && String(productId) !== String(choice.backup?.productId || '')) return { ok: false, message: `${first} picked ${choice.backup?.name || 'a backup'} at checkout. Swap it for that, or refund it.` };
    const rs = ((await db.doc(`tenants/${t}`).get()).data() as any)?.retailSettings || {};
    const c = await swapCandidate(db, t, productId, line, o, rs);
    if (!c.ok) return { ok: false, message: choice.how === 'backup' ? `${first}’s backup can’t go in: ${c.message.replace(/ Pick (another|one at the same price or less)\.$/, '')} Refund it, as they chose.` : c.message };
    // A product for licensed pros goes only on an order sold on a license on file (lib/pro-license).
    if (await forProsOnly(db, t, productId) && !o.proLicense) return { ok: false, message: 'That’s for licensed pros, and this order wasn’t placed with a license on file. Pick something else.' };
    const r = await applySwap(db, t, orderId, lineId, c.item, actor, choice.how === 'backup' ? 'their backup from checkout' : 'best match, as they chose at checkout');
    return r.ok ? { ok: true, message: `Swapped for ${c.item.name}. Scan it in. ${first} hears what changed when packing is done.` } : r;
  }
  const sub = await catalogItem(db, t, productId, o); if (!sub) return { ok: false, message: 'That item isn’t for sale right now.' };
  // A product for licensed pros goes only on an order sold on a license on file (lib/pro-license).
  if (await forProsOnly(db, t, productId) && !o.proLicense) return { ok: false, message: 'That’s for licensed pros, and this order wasn’t placed with a license on file. Pick something else.' };
  // Never dearer than what they paid, asked or not (lib/retail-swap swapCapCents).
  { const rs = ((await db.doc(`tenants/${t}`).get()).data() as any)?.retailSettings || {}; if (sub.unitPriceCents > swapCapCents(Number(line.unitPriceCents) || 0, rs)) return { ok: false, message: `${sub.name} costs more than what was paid for this item. Pick one at the same price or less.` }; }
  // What a swap gives back is what the swap itself works out (lib/retail-swap): the price paid, after any promo, less
  // the replacement's, with its tax. The message says the same amount.
  let back = 0; try { back = swapLines(o, lineId, sub, 'preview').refundCents; } catch { back = 0; }
  const cheaper = back > 0;
  if (!o.customerPhone && !o.customerEmail) return { ok: false, message: 'There’s no way to reach this customer. Refund it or send it later.' };
  const offer = { lineId, lineName: line.name, sub, at: new Date().toISOString(), expiresAt: new Date(Date.now() + SWAP_ANSWER_HOURS * 3600e3).toISOString(), status: 'waiting', by: actor.name };
  await orderRef(db, t, orderId).set({ swapOffer: offer, swapPendingPhone: last10(o.customerPhone || '') || null }, { merge: true });
  const ev = orderRef(db, t, orderId).collection('events').doc();
  await ev.set({ id: ev.id, type: 'note', at: offer.at, actorId: actor.id, actorName: actor.name, meta: { kind: 'swap_offered', text: `Asked ${first} about swapping ${line.name} for ${sub.name}` } });
  const extra = cheaper ? ` and refund the ${money(back)} difference` : ' at no extra cost';
  await tell(db, t, o, origin, `we're out of ${line.name}. We can send ${sub.name} instead${extra}. Reply YES to swap or NO for a refund.`, `Order #${String(o.orderNumber).padStart(4, '0')}: can we swap one item?`, 'Can we swap one item?', [`Hi ${first},`, `We are out of ${line.name}. We can send ${sub.name} instead${extra}.`, `Open your order to choose, or reply YES or NO to our text. If we don't hear back within ${SWAP_ANSWER_HOURS} hours, we will refund that item so your order isn't held up.`]);
  return { ok: true, asked: true, message: `Asked ${first}. They have ${SWAP_ANSWER_HOURS} hours to answer; no answer means a refund.` };
}

/** A question about a swap still needs an answer: it's waiting, the order is still being packed, and the item still
 *  has units to send. One that stopped applying (the order was cancelled or sent, the item was found or refunded) is
 *  closed rather than left waiting. */
export function offerStillOpen(o: any): boolean {
  const offer = o?.swapOffer;
  if (!offer || offer.status !== 'waiting' || !OPEN_STAGES.includes(String(o?.stage || ''))) return false;
  const line = (o.lines || []).find((l: any) => l.lineId === offer.lineId);
  return !!line && (Number(line.qtyOrdered) || 0) - (Number(line.qtyScanned) || 0) - (Number(line.qtyShorted) || 0) > 0;
}

/** Closes a question that no longer applies, so it stops showing on the order page and a YES or NO text can't land
 *  on it (the reply finds the customer's order by the number waiting for an answer). */
export async function closeOffer(db: any, t: string, orderId: string, why: string): Promise<boolean> {
  const ref = orderRef(db, t, orderId);
  try {
    return await db.runTransaction(async (tx: any) => {
      const s = await tx.get(ref); if (!s.exists) return false;
      const o: any = s.data() || {};
      if (o.swapOffer?.status !== 'waiting' || offerStillOpen(o)) return false;
      tx.update(ref, { swapOffer: { ...o.swapOffer, status: 'closed', closedAt: new Date().toISOString(), closedWhy: why }, swapPendingPhone: null });
      return true;
    });
  } catch { return false; }
}

/** The customer's answer, from their order page or a text. A late answer after the shop has moved on changes nothing. */
export async function decideSwap(db: any, t: string, orderId: string, accept: boolean, via: 'page' | 'text', origin: string): Promise<{ ok: boolean; message: string }> {
  const snap = await orderRef(db, t, orderId).get(); if (!snap.exists) return { ok: false, message: 'Order not found.' };
  const o = { ...(snap.data() as any), id: orderId };
  const offer = o.swapOffer; if (!offer || offer.status !== 'waiting') return { ok: false, message: 'There’s nothing waiting for an answer on this order.' };
  if (!offerStillOpen(o)) {
    await closeOffer(db, t, orderId, 'no longer needed');
    return { ok: false, message: `${offer.lineName || 'That item'} has already been sorted out on your order, so there’s nothing to choose any more.` };
  }
  const who = { id: 'customer', name: String(o.customerName || 'Customer') };
  const r = accept ? await applySwap(db, t, orderId, offer.lineId, offer.sub, who, via === 'text' ? 'customer said yes by text' : 'customer said yes')
    : await refundInstead(db, t, orderId, offer.lineId, who, 'Customer chose a refund');
  if (!r.ok) return r;
  // What comes back goes back on its own when it's within the shop's automatic amount (lib/auto-refund).
  const sent = (r.refundCents || 0) > 0 ? await autoRefund(db, t, orderId, origin) : null;
  return { ok: true, message: accept
    ? `Thanks! We'll send ${offer.sub.name}.${r.refundCents ? ` ${refundWords(r.refundCents, sent)}` : ''}`
    : `No problem, we’ve taken ${offer.lineName} off your order. ${refundWords(r.refundCents || 0, sent)}` };
}

/** Answers that never came: refund those items so the orders can go. Run by the shop's regular job. A question that
 *  stopped applying (the order was cancelled or sent, the item found) is closed, so it neither waits forever nor
 *  crowds out the ones that need an answer. */
export async function expireSwapOffers(db: any, t: string): Promise<number> {
  const snap = await db.collection(`tenants/${t}/retailOrders`).where('swapOffer.status', '==', 'waiting').limit(50).get();
  let n = 0;
  for (const d of snap.docs) {
    const o = { ...(d.data() as any), id: d.id };
    if (!offerStillOpen(o)) { await closeOffer(db, t, d.id, ['paid', 'picking'].includes(String(o.stage)) ? 'item sorted out' : `order ${o.stage}`); continue; }
    if (Date.parse(o.swapOffer?.expiresAt || '') > Date.now()) continue;
    const r = await refundInstead(db, t, d.id, o.swapOffer.lineId, { id: 'system', name: 'Automatic' }, 'No answer about a swap'); if (!r.ok) continue; n++;
    const base = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
    // Within the shop's automatic amount it goes back now, before the customer is told, so the notice can say it went.
    await autoRefund(db, t, d.id, base);
    // Queued, so it's tried again if it doesn't go (lib/order-outbox).
    await queueAndSend(db, t, 'order_short', { orderId: d.id, lineId: o.swapOffer.lineId }, { base }).catch(() => 'none');
  }
  return n;
}

/** AN ORDER SET ASIDE AFTER SOMETHING IN IT WAS FOUND OUT (lib/pack-changes): still waiting to be packed TELL_AFTER_MS
 *  after the first change the customer hasn't heard about, what's owed back goes in one refund (within the shop's
 *  automatic amount, lib/auto-refund) and they're told what changed, once (api/retail/changes-notify); when it's packed
 *  later, only anything new is told. From the payments timer (cron/retail-payments). How many were told. */
export async function sweepUntoldChanges(db: any, t: string, base: string): Promise<number> {
  const snap = await db.collection(`tenants/${t}/retailOrders`).where('stage', 'in', ['paid', 'picking']).limit(300).get();
  let n = 0;
  for (const d of snap.docs) {
    const o: any = d.data() || {};
    const since = untoldSince(o);
    if (!since || Date.now() - since < TELL_AFTER_MS) continue;
    // Still being packed by someone (a claim that isn't stale): they hear when it's packed, with nothing sent mid-pack.
    if (o.batchId) {
      const bs = await db.doc(`tenants/${t}/fulfillmentBatches/${String(o.batchId)}`).get().catch(() => null);
      const bd: any = bs?.exists ? bs.data() : null;
      if (bd && bd.active === true && !isClaimStale(bd)) continue;
    }
    if ((Number(o.pendingRefundCents) || 0) > 0) await autoRefund(db, t, d.id, base).catch(() => null);
    // Named for these changes, so a later message about new ones is its own (lib/order-outbox messageId).
    await queueAndSend(db, t, 'order_changes', { orderId: d.id, key: changesKey(packChanges(o)) }, { base, orderId: d.id }).catch(() => null);
    n++;
  }
  return n;
}
