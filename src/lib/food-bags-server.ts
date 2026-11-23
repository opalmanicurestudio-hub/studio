// src/lib/food-bags-server.ts — BAG LABELS ON FOOD ORDERS, printed and scanned (server; lib/food-bags; design board
// "Bag labels, and a check before it goes", A).
//   - labelsWhenReady: an order the kitchen just finished prints its labels by itself, once, on the business's bag-label
//     printer (Settings, Printers). With none, nothing prints by itself: the counter prints them from the tablet.
//   - printLabels: printed (again) from the counter, here on the tablet or on that printer, with a new number of bags.
//     Printed here, the labels' codes come back to the screen: anyone at the counter can print them, which is the point.
//     The scan is there to catch the wrong bag going to the wrong guest, not to stop the team; a code is the same every
//     time it's printed.
//   - scanBag: one bag's label scanned before the order goes: checked against the order (its signed code, lib/order-qr),
//     and kept on it. The handover itself (api/counter 'move', lib/curbside-server cafeHanded) checks what's left.
//     An item's sticker scanned the same way goes to lib/item-stickers-server, and what's left counts its stickers too.
import { FieldValue } from 'firebase-admin/firestore';
import { checkBagCode, makeBagCode } from '@/lib/order-qr';
import { parseBagCode } from '@/lib/bag-tag';
import { printersCached, printsCodes, queueJob, type Printer } from '@/lib/printing-server';
import { bagsLeft, bagsOf, clampBags, defaultBags, labelDoc, labelOf, type BagLabel } from '@/lib/food-bags';
import { stickersLeft, stickersToScan, stickersWords } from '@/lib/item-stickers';
import { isStickerCode, scanSticker } from '@/lib/item-stickers-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });

/** The printer that prints bag labels (the first one set to), or none. */
export async function labelPrinter(db: any, T: string): Promise<Printer | null> {
  return (await printersCached(db, T)).find((p) => p.labels) || null;
}

/** An order whose kitchen tickets are all done (ready, or already out): its food is all there to bag. */
const allMade = (tickets: any[]) => { const live = tickets.filter((t) => !['cancelled', 'voided'].includes(String(t?.status))); return live.length > 0 && live.every((t) => ['ready', 'delivered'].includes(String(t?.status))); };

/** Prints an order's bag labels: `here` for the tablet's own print dialog (returned, each with its code), else on the
 *  bag-label printer. `count`: how many bags (else as before, or worked out from the items). `auto`: printed by itself
 *  as the kitchen finished it, once only. */
export async function printLabels(db: any, tenantId: string, orderId: string, o: { by: string; here?: boolean; count?: unknown; auto?: boolean }):
  Promise<{ ok: true; already?: boolean; count: number; coded: boolean; printer: string | null; labels: BagLabel[] } | Fail> {
  const T = `tenants/${tenantId}`;
  if (!ID.test(orderId)) return fail('Which order?');
  const printer = o.here ? null : await labelPrinter(db, T);
  if (!o.here && !printer) return fail('No printer prints bag labels yet. Print them here, or turn on Prints bag labels for a printer in Settings, Printers.', 409);
  // (A label printed on a Star printer on CloudPRNT is words only: it can't be scanned, so the order goes as before.)
  const coded = !!o.here || printsCodes(printer);
  const ref = db.doc(`${T}/counterOrders/${orderId}`);
  const r: any = await db.runTransaction(async (tx: any) => {
    const or: any = (await tx.get(ref)).data();
    if (!or) return fail('That order isn’t here.', 404);
    if (or.status !== 'sent') return fail(or.status === 'done' ? 'That order was already handed over.' : 'That order isn’t with the kitchen.', 409);
    const was = bagsOf(or);
    if (o.auto && was) return { already: true, or };
    const count = o.count !== undefined && o.count !== null ? clampBags(o.count) : was?.count || defaultBags(or);
    // What was scanned stays scanned while those bags are still there; a manager's skip doesn't carry over.
    tx.set(ref, { bags: { count, printedAt: new Date().toISOString(), coded, scanned: (was?.scanned || []).filter((n) => n <= count), skipped: null, by: String(o.by || '').slice(0, 60) } }, { merge: true });
    return { or, count };
  });
  if (r.ok === false) return r;
  if (r.already) return { ok: true, already: true, count: bagsOf(r.or)!.count, coded: bagsOf(r.or)!.coded, printer: null, labels: [] };
  const biz: any = (await db.doc(T).get()).data() || {};
  const labels = Array.from({ length: r.count }, (_, i) => labelOf(r.or, i + 1, r.count, coded ? makeBagCode(tenantId, orderId, i + 1) : null, String(biz.name || biz.businessName || '') || null));
  if (printer) for (const l of labels) await queueJob(db, T, printer.id, 'label', labelDoc(l), { orderId });
  return { ok: true, count: r.count, coded, printer: printer?.name || null, labels: o.here ? labels : [] };
}

/** The kitchen just finished these tickets: each order now all made prints its labels by itself, once, when a printer
 *  prints bag labels. Never in the way of the kitchen: a failure is logged, nothing more. */
export async function labelsWhenReady(db: any, tenantId: string, ticketIds: string[]): Promise<void> {
  try {
    const T = `tenants/${tenantId}`;
    const ids = Array.from(new Set(ticketIds.filter((x) => ID.test(String(x))))).slice(0, 60);
    if (!ids.length || !(await labelPrinter(db, T))) return;
    const snaps: any[] = await db.getAll(...ids.map((id) => db.doc(`${T}/kdsTickets/${id}`)));
    const orders = Array.from(new Set(snaps.map((s) => s.data?.() || null).filter((t: any) => t?.channel && ID.test(String(t.orderId || ''))).map((t: any) => String(t.orderId))));
    for (const orderId of orders) {
      const [or, tix] = await Promise.all([db.doc(`${T}/counterOrders/${orderId}`).get(), db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId).get()]);
      const o: any = or.data(); if (!o || o.status !== 'sent' || bagsOf(o)) continue;
      if (!allMade(tix.docs.map((d: any) => d.data() || {}))) continue;
      const p = await printLabels(db, tenantId, orderId, { by: 'Kitchen', auto: true });
      if (!p.ok) console.error('[food-bags] labels not printed', orderId, p.error);
    }
  } catch (e: any) { console.error('[food-bags] labels when ready', e?.message); }
}

/** One bag's label scanned for an order (or for any of `orderIds`, when a car carries an order placed ahead too). */
export async function scanBag(db: any, tenantId: string, tenant: any, orderIds: string[], raw: unknown):
  Promise<{ ok: true; orderId: string; n?: number; k?: string; name?: string; of?: number; left: number[]; itemsLeft: string[]; already: boolean } | Fail> {
  const T = `tenants/${tenantId}`; const code = String(raw ?? '').trim().slice(0, 300);
  // (An item's sticker: lib/item-stickers-server.)
  if (isStickerCode(code)) return scanSticker(db, tenantId, tenant, orderIds, code);
  const mine = orderIds.filter((x) => ID.test(x));
  const orderId = mine.find((id) => checkBagCode(tenantId, id, code) !== null);
  if (!orderId) {
    // Another order's bag: whose it is. Anything else: not a bag label.
    const tag = parseBagCode(code);
    if (tag && !mine.includes(tag.orderId) && ID.test(tag.orderId) && checkBagCode(tenantId, tag.orderId, code) !== null) {
      const other: any = (await db.doc(`${T}/counterOrders/${tag.orderId}`).get()).data();
      if (other) return fail(`Wrong bag. This one is ${String(other.number || 'another order')}${other.guestName ? ` for ${String(other.guestName).split(/\s+/)[0]}` : ''}.`, 409);
    }
    return fail(tag ? 'That label is for another order.' : 'That isn’t a bag label or an item sticker. Scan the code on it.', 409);
  }
  const n = checkBagCode(tenantId, orderId, code)!;
  const ref = db.doc(`${T}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const or: any = (await tx.get(ref)).data();
    if (!or) return fail('That order isn’t here.', 404);
    if (or.status !== 'sent') return fail(or.status === 'done' ? 'That order was already handed over.' : 'That order isn’t with the kitchen.', 409);
    const b = bagsOf(or);
    if (!b) return fail('That order has no labels yet.', 409);
    if (n > b.count) return fail('That label is from an earlier print. Scan the ones printed last.', 409);
    const already = b.scanned.includes(n);
    if (!already) tx.set(ref, { bags: { scanned: FieldValue.arrayUnion(n) } }, { merge: true });
    const after = { ...or, bags: { ...or.bags, scanned: [...b.scanned, n] } };
    return { ok: true as const, orderId, n, of: b.count, left: bagsLeft(after, tenant), itemsLeft: stickersLeft(or, tenant).map((x) => x.k), already };
  });
}

export type ScanWait = { orderId: string; number: string; of: number; left: number[]; items?: { k: string; name: string; done: boolean }[] };
/** What's left to scan on these orders, for a handover refused until it's done (each order's number, its bags and those
 *  left, and its item stickers, each ticked or not); none when nothing is. */
export function bagsWaiting(orders: { id: string; data: any }[], tenant: any): ScanWait[] {
  return orders.filter((o) => o.data && o.data.status === 'sent').map((o) => {
    const items = stickersToScan(o.data, tenant);
    return { orderId: o.id, number: String(o.data.number || ''), of: bagsOf(o.data)?.count || 0, left: bagsLeft(o.data, tenant), ...(items.length ? { items } : {}) };
  }).filter((x) => x.left.length > 0 || (x.items || []).some((i) => !i.done));
}
/** "Scan bag 2 of D15 first.", "For D15, scan bag 2 and the sticker on Large oat latte first." */
export function waitingWords(w: ScanWait[]): string {
  const bags = (x: ScanWait) => (x.of > 1 ? (x.left.length === x.of ? `all ${x.of} bags` : x.left.length === 1 ? `bag ${x.left[0]}` : `bags ${x.left.join(' and ')}`) : 'the bag');
  const items = (x: ScanWait) => (x.items || []).filter((i) => !i.done);
  if (w.every((x) => !items(x).length)) return `Scan ${w.map((x) => `${bags(x)} of ${x.number}`).join(', and ')} first.`;
  return w.map((x) => `For ${x.number}, scan ${[x.left.length ? bags(x) : '', items(x).length ? stickersWords(items(x)) : ''].filter(Boolean).join(' and ')} first.`).join(' ');
}

