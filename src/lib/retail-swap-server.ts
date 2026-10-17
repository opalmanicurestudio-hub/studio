// src/lib/retail-swap-server.ts — SWAPS ON THE SERVER. Offering a replacement, applying it, refunding instead, and
// the customer's answer (from their order page or a YES/NO text) all run here in transactions, so the stock, the order
// and the money move together, and two answers can't both win. The swap arithmetic itself is lib/retail-swap.
import { nanoid } from 'nanoid';
import { taxShareCents } from './restocking';
import { SWAP_ANSWER_HOURS, normaliseIfUnavailable, swapLines, type SwapItem } from './retail-swap';
import { brandedEmailHtml } from './email-template';

type Actor = { id: string; name: string };
const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const last10 = (p: string) => String(p || '').replace(/\D/g, '').slice(-10);
const orderRef = (db: any, t: string, id: string) => db.collection(`tenants/${t}/retailOrders`).doc(id);
const OPEN_STAGES = ['paid', 'picking'];

/** The replacement as the shop sells it today, read from the catalog, never from the caller. */
export async function catalogItem(db: any, t: string, productId: string): Promise<SwapItem | null> {
  const s = await db.collection(`tenants/${t}/inventory`).doc(productId).get();
  if (!s.exists) return null; const i = s.data() as any;
  const price = Math.round((Number(i.msrp) || 0) * 100); if (price <= 0) return null;
  return { productId, name: String(i.name || 'Item'), unitPriceCents: price, sku: i.sku || '', barcode: i.barcode || '', imageUrl: (Array.isArray(i.imageUrls) && i.imageUrls[0]) || i.imageUrl || '' };
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
        tx.update(origRef, { totalStock: Math.max(0, (Number(it.totalStock) || 0) - r.qty), stockReserved: Math.max(0, (Number(it.stockReserved) || 0) - r.qty) });
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
      const items = qty * (Number(line.unitPriceCents) || 0); const cents = items + taxShareCents(o, items);
      const lines = [...o.lines]; lines[idx] = { ...line, qtyShorted: (Number(line.qtyShorted) || 0) + qty, status: 'refunded', shortReason: why };
      if (iSnap.exists) {
        const it = iSnap.data() as any;
        tx.update(iRef, { totalStock: Math.max(0, (Number(it.totalStock) || 0) - qty), stockReserved: Math.max(0, (Number(it.stockReserved) || 0) - qty) });
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
  if (o.customerPhone) { try { await sendNotification(db, { tenantId: t, channel: 'sms', to: o.customerPhone, text: `${shop}: ${sms}${link && !sms.includes('http') ? ` ${link}` : ''}`, kind: 'order_swap', recipientType: 'client', recipientId: o.clientId || null } as any); } catch { /* email still goes */ } }
  if (o.customerEmail) {
    try {
      const html = brandedEmailHtml({ studioName: shop, title, bodyLines: [...body, `Kind regards, ${shop}`], cta: link ? { label: 'View my order', url: link } : null, footerNote: `You are receiving this because you placed order #${String(o.orderNumber).padStart(4, '0')} with ${shop}.` });
      await sendNotification(db, { tenantId: t, channel: 'email', to: o.customerEmail, subject, html, kind: 'order_swap', recipientType: 'client' } as any);
    } catch { /* best effort */ }
  }
}

/** Staff found an item missing and picked a replacement. "Similar" customers get it straight away; everyone else is
 *  asked first, by text and email, and has SWAP_ANSWER_HOURS to answer. */
export async function offerSwap(db: any, t: string, orderId: string, lineId: string, productId: string, actor: Actor, origin: string, forceAsk = false): Promise<{ ok: boolean; message: string; asked?: boolean }> {
  const sub = await catalogItem(db, t, productId); if (!sub) return { ok: false, message: 'That item isn’t for sale right now.' };
  const snap = await orderRef(db, t, orderId).get(); if (!snap.exists) return { ok: false, message: 'Order not found.' };
  const o = { ...(snap.data() as any), id: orderId };
  const line = (o.lines || []).find((l: any) => l.lineId === lineId); if (!line) return { ok: false, message: 'That item isn’t on this order.' };
  const first = String(o.customerName || '').split(' ')[0] || 'there';
  const pref = normaliseIfUnavailable(o.ifUnavailable);
  const orig = Number(line.unitPriceCents) || 0; const cheaper = sub.unitPriceCents < orig;
  if (pref === 'similar' && !forceAsk) {
    const r = await applySwap(db, t, orderId, lineId, sub, actor, 'customer chose swaps at checkout');
    if (r.ok) await tell(db, t, o, origin, `we were out of ${line.name}, so we've packed ${sub.name} instead, as you asked.${r.refundCents ? ` ${money(r.refundCents)} is coming back to you.` : ''}`, `Order #${String(o.orderNumber).padStart(4, '0')}: a swap in your order`, 'A swap in your order', [`Hi ${first},`, `We were out of ${line.name}, so we have packed ${sub.name} instead, as you asked at checkout.`, r.refundCents ? `It costs less, so ${money(r.refundCents)} is coming back to the card you paid with.` : 'There is nothing extra to pay.', 'If you would rather have a refund, reply to this email or open your order and let us know.']);
    return r;
  }
  if (!o.customerPhone && !o.customerEmail) return { ok: false, message: 'There’s no way to reach this customer. Refund it or send it later.' };
  const offer = { lineId, lineName: line.name, sub, at: new Date().toISOString(), expiresAt: new Date(Date.now() + SWAP_ANSWER_HOURS * 3600e3).toISOString(), status: 'waiting', by: actor.name };
  await orderRef(db, t, orderId).set({ swapOffer: offer, swapPendingPhone: last10(o.customerPhone || '') || null }, { merge: true });
  const ev = orderRef(db, t, orderId).collection('events').doc();
  await ev.set({ id: ev.id, type: 'note', at: offer.at, actorId: actor.id, actorName: actor.name, meta: { kind: 'swap_offered', text: `Asked ${first} about swapping ${line.name} for ${sub.name}` } });
  const extra = cheaper ? ` and refund the ${money((orig - sub.unitPriceCents) * Math.max(1, (Number(line.qtyOrdered) || 1) - (Number(line.qtyScanned) || 0) - (Number(line.qtyShorted) || 0)))} difference` : ' at no extra cost';
  await tell(db, t, o, origin, `we're out of ${line.name}. We can send ${sub.name} instead${extra}. Reply YES to swap or NO for a refund.`, `Order #${String(o.orderNumber).padStart(4, '0')}: can we swap one item?`, 'Can we swap one item?', [`Hi ${first},`, `We are out of ${line.name}. We can send ${sub.name} instead${extra}.`, `Open your order to choose, or reply YES or NO to our text. If we don't hear back within ${SWAP_ANSWER_HOURS} hours, we will refund that item so your order isn't held up.`]);
  return { ok: true, asked: true, message: `Asked ${first}. They have ${SWAP_ANSWER_HOURS} hours to answer; no answer means a refund.` };
}

/** The customer's answer, from their order page or a text. A late answer after the shop has moved on changes nothing. */
export async function decideSwap(db: any, t: string, orderId: string, accept: boolean, via: 'page' | 'text', origin: string): Promise<{ ok: boolean; message: string }> {
  const snap = await orderRef(db, t, orderId).get(); if (!snap.exists) return { ok: false, message: 'Order not found.' };
  const o = { ...(snap.data() as any), id: orderId };
  const offer = o.swapOffer; if (!offer || offer.status !== 'waiting') return { ok: false, message: 'There’s nothing waiting for an answer on this order.' };
  const who = { id: 'customer', name: String(o.customerName || 'Customer') };
  const r = accept ? await applySwap(db, t, orderId, offer.lineId, offer.sub, who, via === 'text' ? 'customer said yes by text' : 'customer said yes')
    : await refundInstead(db, t, orderId, offer.lineId, who, 'Customer chose a refund');
  if (!r.ok) return r;
  return { ok: true, message: accept ? `Thanks! We'll send ${offer.sub.name}.${r.refundCents ? ` ${money(r.refundCents)} is coming back to you.` : ''}` : `No problem. ${money(r.refundCents || 0)} for ${offer.lineName} is coming back to your card.` };
}

/** Answers that never came: refund those items so the orders can go. Run by the shop's regular job. */
export async function expireSwapOffers(db: any, t: string): Promise<number> {
  const snap = await db.collection(`tenants/${t}/retailOrders`).where('swapOffer.status', '==', 'waiting').limit(50).get();
  let n = 0;
  for (const d of snap.docs) {
    const o = d.data() as any; if (Date.parse(o.swapOffer?.expiresAt || '') > Date.now()) continue;
    const r = await refundInstead(db, t, d.id, o.swapOffer.lineId, { id: 'system', name: 'Automatic' }, 'No answer about a swap'); if (!r.ok) continue; n++;
    const base = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
    if (base) { try { await fetch(`${base}/api/retail/short-notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: t, orderId: d.id, lineId: o.swapOffer.lineId }) }); } catch { /* the order page shows it */ } }
  }
  return n;
}
