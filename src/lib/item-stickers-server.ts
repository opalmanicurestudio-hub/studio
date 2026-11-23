// src/lib/item-stickers-server.ts — ITEM STICKERS, scanned and printed again (server; lib/item-stickers; design board
// "A sticker on each item, scanned into the bag", A). The stickers themselves print by the printer's own asking
// (lib/printing-server makeStickerJobs).
//   - scanSticker: one item's sticker scanned before the order goes: checked against the order (its signed code, lib/
//     order-qr), and kept on it. A sticker from another order says whose it is; one printed before the item's last
//     print is refused. The handover checks what's left (lib/food-bags-server bagsWaiting).
//   - printStickerAgain: a remade item, or a torn sticker: a new one, the next version, at the printer that printed it
//     (or another that prints stickers for its station); the old one stops scanning, and the item is to scan again.
import { FieldValue } from 'firebase-admin/firestore';
import { checkItemCode, makeItemCode } from '@/lib/order-qr';
import { parseItemCode, stickerDoc, stickerOf, stickersLeft, stickersOf, ticketOfKey } from '@/lib/item-stickers';
import { bagsLeft } from '@/lib/food-bags';
import { ticketFrom } from '@/lib/kitchen';
import { allergyLines } from '@/lib/printing';
import { printersCached, queueJob } from '@/lib/printing-server';
import { stationsOf } from '@/lib/table-service';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });

/** Is this a sticker's code (read before anything is checked)? */
export const isStickerCode = (raw: unknown) => !!parseItemCode(String(raw ?? '').trim().slice(0, 300));

/** One item's sticker scanned for an order (or for any of `orderIds`, when a car carries an order placed ahead too). */
export async function scanSticker(db: any, tenantId: string, tenant: any, orderIds: string[], raw: unknown):
  Promise<{ ok: true; orderId: string; k: string; name: string; itemsLeft: string[]; left: number[]; already: boolean } | Fail> {
  const T = `tenants/${tenantId}`; const code = String(raw ?? '').trim().slice(0, 300);
  const mine = orderIds.filter((x) => ID.test(x));
  const orderId = mine.find((id) => checkItemCode(tenantId, id, code) !== null);
  if (!orderId) {
    // Another order's item: whose it is.
    const tag = parseItemCode(code);
    if (tag && !mine.includes(tag.orderId) && ID.test(tag.orderId) && checkItemCode(tenantId, tag.orderId, code) !== null) {
      const other: any = (await db.doc(`${T}/counterOrders/${tag.orderId}`).get()).data();
      if (other) return fail(`Wrong item. This one is ${String(other.number || 'another order')}’s${other.guestName ? `, for ${String(other.guestName).split(/\s+/)[0]}` : ''}.`, 409);
    }
    return fail('That sticker is for another order.', 409);
  }
  const it = checkItemCode(tenantId, orderId, code)!;
  const ref = db.doc(`${T}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const or: any = (await tx.get(ref)).data();
    if (!or) return fail('That order isn’t here.', 404);
    if (or.status !== 'sent') return fail(or.status === 'done' ? 'That order was already handed over.' : 'That order isn’t with the kitchen.', 409);
    const s = stickersOf(or); const one = s?.list.find((x) => x.k === it.k);
    if (!s || !one) return fail('That item was taken off the order.', 409);
    if (it.v !== one.v) return fail(`That sticker for ${one.name} was replaced. Scan the new one.`, 409);
    const already = s.scanned.includes(it.k);
    if (!already) tx.set(ref, { stickers: { scanned: FieldValue.arrayUnion(it.k) } }, { merge: true });
    const after = { ...or, stickers: { ...or.stickers, scanned: [...s.scanned, it.k] } };
    // (What's left of it to scan: its stickers, and its bags as they stand.)
    return { ok: true as const, orderId, k: it.k, name: one.name, itemsLeft: stickersLeft(after, tenant).map((x) => x.k), left: bagsLeft(or, tenant), already };
  });
}

/** One item's sticker printed again: the next version, the old one no longer scans, and it's to scan again. */
export async function printStickerAgain(db: any, tenantId: string, orderId: string, k: string, by: string):
  Promise<{ ok: true; name: string; printer: string } | Fail> {
  const T = `tenants/${tenantId}`;
  if (!ID.test(orderId) || !/^[A-Za-z0-9_-]{1,160}\.\d{1,2}$/.test(k)) return fail('Which item?');
  const ticketId = ticketOfKey(k);
  const [or, tk, tn] = await Promise.all([db.doc(`${T}/counterOrders/${orderId}`).get(), db.doc(`${T}/kdsTickets/${ticketId}`).get(), db.doc(T).get()]);
  const order: any = or.data(); const raw: any = tk.data();
  if (!order || !raw || String(raw.orderId || '') !== orderId) return fail('That item isn’t on this order.', 404);
  // The printer that printed it, or else one that prints stickers for its station.
  const printers = (await printersCached(db, T)).filter((p) => p.stickers);
  const station = String(raw.madeAt || stationsOf(tn.data() || {})[0] || 'Kitchen').toLowerCase();
  const printer = printers.find((p) => p.id === raw.sticker?.printer) || printers.find((p) => !p.stations.length || p.stations.some((s) => s.toLowerCase() === station));
  if (!printer) return fail('No printer prints item stickers for this station now. Turn on Prints item stickers for one in Settings, Printers.', 409);
  const ref = db.doc(`${T}/counterOrders/${orderId}`);
  const r: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data();
    if (!cur) return fail('That order isn’t here.', 404);
    if (cur.status !== 'sent') return fail(cur.status === 'done' ? 'That order was already handed over.' : 'That order isn’t with the kitchen.', 409);
    const s = stickersOf(cur); const i = s ? s.list.findIndex((x) => x.k === k) : -1;
    if (!s || i < 0) return fail('That item was taken off the order.', 409);
    const coded = printer.kind === 'epson';
    const list = s.list.map((x, j) => (j === i ? { ...x, v: x.v + 1, c: coded } : x));
    tx.set(ref, { stickers: { list, scanned: s.scanned.filter((x) => x !== k), reprinted: { [k.replace('.', '_')]: { by: String(by || '').slice(0, 60), at: new Date().toISOString() } } } }, { merge: true });
    return { ok: true, one: list[i], cur };
  });
  if (r.ok === false) return r;
  const view = ticketFrom({ ...raw, id: ticketId }, 'kdsTickets');
  const code = r.one.c ? makeItemCode(tenantId, orderId, k, r.one.v) : null;
  // (Numbered as it was: its unit of the item's quantity.)
  await queueJob(db, T, printer.id, 'sticker', stickerDoc(stickerOf(r.cur, view, allergyLines([view]), Number(k.slice(k.lastIndexOf('.') + 1)), view.quantity, code)), { orderId, stickerKey: k });
  return { ok: true, name: r.one.name, printer: printer.name };
}

/** The stickers left on an order, for a screen that shows them ("1 of 2 scanned"). */
export const stickersView = (order: any, tenant: any) => { const all = stickersOf(order)?.list.filter((x) => x.c) || []; const left = stickersLeft(order, tenant); return all.length ? { of: all.length, left: left.length } : null; };
