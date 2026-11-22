// src/app/api/ordering/route.ts — WHAT TO ORDER, AND RECEIVING IT (lib/ordering; design canvas "Ordering"; the page at
// /inventory/ordering). Managers and owners. Orders are Inventory's own purchase orders (tenants/{t}/orders), booked to
// the books as Inventory books them: the order as a supplies expense on account, a cancelled order (or the part that never
// came) given back, and a delivery that cost more or less than ordered set right.
//   plan     { tenantId, at? } → for each supplier, what to order (from the last two weeks' stock history, what's on the
//            shelf and what's still to come), the things with no supplier yet, the ones not counted yet, the orders still
//            to come, and the suppliers the business already uses. `at`, with more than one location: for that store
//            alone (lib/ordering-store: its own shelf, its own pace, its own set numbers, what's on its way to it, and
//            another store's spare); `notHere`: what isn't counted at that store yet.
//   order    { tenantId, supplier, lines: [{ itemId, qty }], at? } → an order placed (each line's name, container and cost
//            as they are now); the business sends it its own way (the page copies it). `at`: ordered for that store
//            (where it's put away unless it came to another).
//   receive  { tenantId, orderId, lines?: [{ itemId, qty, cost? }], at? } → it came in: each line on the shelf as a batch at
//            its cost, on the stock history, and the order marked received (or partly, with the rest still to come), all
//            at once. Without `lines`, everything still to come as ordered. A cost typed here is what the business pays
//            from now on. The answer's `moved`: anything that came in at 5% more or less than the delivery before, with
//            the dishes it pushed over the aim (lib/price-creep); the managers are told about those (once a delivery).
//            `at`, with more than one location (required then): the store it came to (the plan's `stores`); what's
//            counted there goes on that store's shelf too (lib/store-stock).
//   cancel   { tenantId, orderId } → not coming after all: an order with nothing in yet is cancelled; one partly in is
//            closed with what came.
//   supplier { tenantId, itemId, supplier } → who the business buys that from.
//   par      { tenantId, itemId, par, at? } → keep this many containers on hand (0 or empty: from what's used instead);
//            `at`: at that store.
//   cover    { tenantId, days } → how many days an order should last (1 to 30).
// Never changes a price the business sells at.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { buildEntry } from '@/lib/stock-ledger';
import { checkDeliveries } from '@/lib/price-creep-server';
import { moveWords } from '@/lib/price-creep';
import { ledgerUnit } from '@/lib/food-cost';
import { storesOf } from '@/lib/store-stock-server';
import { receivedTo, storeMoveNested } from '@/lib/store-stock';
import { countedAt, parAtOf, storeRates, suggestAt } from '@/lib/ordering-store';
import { cleanReceived, cleanSupplier, containerOf, COVER_MAX, COVER_MIN, coverDaysOf, deliveryDiff, isOpen, LOOKBACK_DAYS, notCounted, OPEN_STATUSES, orderable, orderNumber, orderTotal, perOf, planBySupplier, remainingOf, spanDays, spreadReceived, suggestFor, usedPerDay, type OrderItem, type SupplyOrder } from '@/lib/ordering';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
class Stop { constructor(public msg: string, public status = 400) {} }

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'plan');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['plan', 'order', 'receive', 'cancel', 'supplier', 'par', 'cover'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const by = String(g.actor?.name || 'A manager').slice(0, 60); const actorId = String(g.actor?.uid || 'manager');
  const now = new Date().toISOString();
  try {
    if (action === 'cover') {
      const d = Math.round(Number(b.days));
      if (!Number.isInteger(d) || d < COVER_MIN || d > COVER_MAX) return bad(`Pick ${COVER_MIN} to ${COVER_MAX} days.`);
      await db.doc(T).set({ ordering: { coverDays: d }, updatedAt: now }, { merge: true });
      return ok({ coverDays: d });
    }
    if (action === 'supplier' || action === 'par') {
      const itemId = String(b.itemId || ''); if (!ID.test(itemId)) return bad('Which item?');
      const ref = db.doc(`${T}/inventory/${itemId}`); const x: any = (await ref.get()).data();
      if (!x || !orderable(itemId, x)) return bad('That isn’t something that’s ordered.', 404);
      if (action === 'supplier') {
        const s = cleanSupplier(b.supplier); if (!s) return bad('Who do you buy it from?');
        await ref.set({ supplier: s, updatedAt: now }, { merge: true });
        return ok({ supplier: s });
      }
      const raw = b.par; const par = raw === null || raw === '' || raw === undefined ? 0 : Number(raw);
      if (!Number.isFinite(par) || par < 0 || par > 10000) return bad('How many to keep? 0 to 10,000.');
      if (b.at !== undefined && b.at !== null && b.at !== '') {
        // At one store: its own set number (read now, so a location added a moment ago counts).
        const store = (await storesOf(db, tenantId, true)).find((x) => x.id === String(b.at));
        if (!store) return bad('That store isn’t one of your locations now. Reload and pick it again.', 409);
        await db.runTransaction(async (tx: any) => {
          const cur: any = (await tx.get(ref)).data() || {}; const m = parAtOf(cur);
          if (par > 0) m[store.id] = Math.round(par * 100) / 100; else delete m[store.id];
          tx.update(ref, { parAt: m, updatedAt: now });
        });
        return ok({ par: par > 0 ? par : null, at: store.id });
      }
      await ref.set({ parLevel: par > 0 ? Math.round(par * 100) / 100 : null, updatedAt: now }, { merge: true });
      return ok({ par: par > 0 ? par : null });
    }

    if (action === 'order') {
      const supplier = cleanSupplier(b.supplier); if (!supplier) return bad('Who is this order from?');
      // For one store (read now, so a location added a moment ago counts).
      const forStore = b.at ? (await storesOf(db, tenantId, true)).find((x) => x.id === String(b.at)) || null : null;
      if (b.at && !forStore) return bad('That store isn’t one of your locations now. Reload and pick it again.', 409);
      const want = new Map<string, number>();
      for (const l of Array.isArray(b.lines) ? b.lines.slice(0, 200) : []) {
        const id = String(l?.itemId || ''); const q = Number(l?.qty);
        if (!ID.test(id)) continue; if (!Number.isInteger(q) || q < 0 || q > 10000) return bad('Each line is a whole number, up to 10,000.');
        if (q > 0) want.set(id, (want.get(id) || 0) + q);
      }
      if (!want.size) return bad('Add something to the order first.');
      const snaps = await db.getAll(...Array.from(want.keys()).map((id) => db.doc(`${T}/inventory/${id}`)));
      const items: OrderItem[] = [];
      for (const s of snaps) {
        const x: any = s.exists ? s.data() : null; if (!x || !orderable(s.id, x)) return bad(`${x?.name || 'An item'} isn’t something that’s ordered any more. Refresh and try again.`, 409);
        items.push({ productId: s.id, productName: String(x.name || 'Item').slice(0, 80), quantity: want.get(s.id)!, costPerUnit: Math.max(0, num(x.costPerUnit)), receivedQuantity: 0, container: containerOf(x), typical: x.typicalCost === true });
      }
      const ref = db.collection(`${T}/orders`).doc();
      const order: SupplyOrder = { id: ref.id, supplier, orderDate: now, status: 'Placed', items, number: orderNumber(ref.id), orderedBy: by, source: 'ordering', ...(forStore ? { storeId: forStore.id, storeName: forStore.name } : {}) };
      const total = orderTotal(items.map((i) => ({ qty: i.quantity, cost: i.costPerUnit })));
      const w = db.batch();
      w.set(ref, order);
      // Booked as Inventory books an order: a supplies expense, on account.
      if (total > 0) w.set(db.collection(`${T}/transactions`).doc(), { description: `Purchase Order: ${supplier}`, clientOrVendor: supplier, type: 'expense', context: 'Business', category: 'Supplies', amount: total, paymentMethod: 'On Account', hasReceipt: false, relatedOrderId: ref.id, date: now });
      await w.commit();
      await logAuditAdmin(db, tenantId, { action: 'inventory.order', targetType: 'order', targetId: ref.id, summary: `${by} ordered ${items.length} ${items.length === 1 ? 'item' : 'items'} from ${supplier}${forStore ? ` for ${forStore.name}` : ''} ($${total.toFixed(2)}).`, actor: { type: 'user', id: actorId, name: by } } as any).catch(() => {});
      return ok({ order, total });
    }

    if (action === 'receive' || action === 'cancel') {
      const orderId = String(b.orderId || ''); if (!ID.test(orderId)) return bad('Which order?');
      const oRef = db.doc(`${T}/orders/${orderId}`);
      // The store it came to, with more than one location.
      // (Read now, so a location added a moment ago counts. With several, a delivery always says which store.)
      const stores = action === 'receive' ? await storesOf(db, tenantId, true) : [];
      const store = stores.find((x) => x.id === String(b.at || '')) || null;
      if (stores.length && !b.at) return bad('Pick the store it came to. Reload the page if you don’t see your stores.', 409);
      if (stores.length && !store) return bad('That store isn’t one of your locations now. Pick the store it came to again.');
      const money = (amount: number, type: 'expense' | 'reversal', description: string, supplier: string) =>
        ({ description, clientOrVendor: supplier, type, context: 'Business', category: 'Supplies', amount: Math.round(amount * 100) / 100, paymentMethod: 'On Account', hasReceipt: false, relatedOrderId: orderId, date: now });
      const r: any = await db.runTransaction(async (tx: any) => {
        const o: any = (await tx.get(oRef)).data();
        if (!o) throw new Stop('That order isn’t there any more.', 404);
        const supplier = String(o.supplier || 'a supplier'); const number = String(o.number || orderNumber(orderId));
        const items: OrderItem[] = Array.isArray(o.items) ? o.items : [];
        if (!isOpen(o)) return { already: true, status: String(o.status || '') };
        if (action === 'cancel') {
          // What never came is given back on the books; an order partly in is closed with what came.
          const rest = orderTotal(items.map((i) => ({ qty: remainingOf(i), cost: num(i.costPerUnit) })));
          const anyIn = items.some((i) => num(i.receivedQuantity) > 0);
          tx.set(oRef, { status: anyIn ? 'Received' : 'Cancelled', notes: `${anyIn ? 'The rest didn’t come' : 'Cancelled'}, ${now.slice(0, 10)}, by ${by}.${o.notes ? `\n---\n${o.notes}` : ''}`, closedAt: now, closedBy: by }, { merge: true });
          if (rest > 0) tx.set(db.collection(`${T}/transactions`).doc(), money(rest, 'reversal', anyIn ? `Didn’t come: order #${number}, ${supplier}` : `Reversal for Order: ${supplier}`, supplier));
          return { status: anyIn ? 'Received' : 'Cancelled', number, supplier, given: rest };
        }
        const got = cleanReceived(o, b.lines);
        if (!got) throw new Stop('Each line is a whole number up to 10,000, and a cost of more than $0.');
        // What the screen showed as still to come: if the order changed since (another delivery put away from another
        // screen), it's looked at again rather than put away twice.
        if (b.expect && typeof b.expect === 'object' && got.some((l) => b.expect[l.productId] !== undefined && Number(b.expect[l.productId]) !== l.remaining))
          throw new Stop('This order changed while you were looking at it. Look again, then put away what came.', 409);
        // Reads first, then writes.
        const refs = got.map((l) => db.doc(`${T}/inventory/${l.productId}`));
        const snaps = await Promise.all(refs.map((x) => tx.get(x)));
        const received: { itemId: string; qty: number; cost: number }[] = []; const missing: string[] = []; let units = 0;
        // Counted at other stores but not at this one yet: on the total, waiting in "Not at a store yet".
        const unplaced: string[] = [];
        got.forEach((l, i) => {
          const x: any = snaps[i].exists ? snaps[i].data() : null;
          if (!(l.qty > 0)) return;
          if (!x) { missing.push(items.find((it) => it.productId === l.productId)?.productName || 'An item'); return; }
          received.push({ itemId: l.productId, qty: l.qty, cost: l.cost });
          const per = perOf(x) || 1; const name = String(x.name || 'Item');
          if (store && receivedTo(x, stores, store.id) === 'unplaced') unplaced.push(name);
          // (Put away at a typical price, before the business said what it pays: kept, but never a price to compare with.)
          const batch = { id: `order-${orderId}-${i}-${Date.now().toString(36)}`, stock: l.qty, costPerUnit: l.cost, receivedDate: now, note: `Order #${number} from ${supplier}`, ...(x.typicalCost === true && !l.typed ? { typical: true } : {}) };
          tx.set(refs[i], {
            totalStock: Math.max(0, num(x.totalStock)) + l.qty, batches: [...(Array.isArray(x.batches) ? x.batches : []), batch],
            // Its cost changes when one is typed here (what the business pays now), or when it had none; never back to an
            // order's older price.
            ...(l.cost > 0 && (l.typed || !(num(x.costPerUnit) > 0)) ? { costPerUnit: l.cost } : {}),
            // A delivery starts the count of something not counted yet; a cost typed in is what the business pays.
            ...(x.countStock === false ? { countStock: true } : {}),
            ...(l.typed && x.typicalCost === true ? { typicalCost: false } : {}),
            // On the shelf of the store it came to, for one counted there (a delivery never starts a store's count).
            ...(store ? storeMoveNested(x, store.id, { stock: l.qty }) : {}),
            lastReceivedAt: now, updatedAt: now,
          }, { merge: true });
          // On the history in what it measures (a gallon of milk is 3,785 ml), so a count compares like with like.
          tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: l.productId, type: 'received', delta: l.qty * per, unit: ledgerUnit(x),
            reason: `Received: ${l.qty} × ${name}, order #${number} from ${supplier}${store ? `, at ${store.name}` : ''}`.slice(0, 200), actorId, actorName: by, ref: { kind: 'po', id: orderId },
            ...(store ? { storeId: store.id } : {}),
            ...(per === 1 ? { balanceAfter: Math.max(0, num(x.totalStock)) + l.qty } : {}) }));
          units += l.qty;
        });
        if (!units) throw new Stop(missing.length ? `${missing.join(', ')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} in Inventory any more, so there’s nothing to put away. Close the order if that’s all.` : 'Nothing to put away: every line is at 0. Cancel the order if it isn’t coming.');
        const nextItems = spreadReceived(items, new Map(received.map((x) => [x.itemId, { qty: x.qty, cost: x.cost }])));
        const done = nextItems.every((it) => remainingOf(it) === 0);
        tx.set(oRef, { items: nextItems, status: done ? 'Received' : 'Partially Received', receivedAt: now, receivedBy: by }, { merge: true });
        // A delivery that cost more or less than booked when it was ordered (another price, or more than was ordered)
        // sets the books right.
        const diff = deliveryDiff(got.filter((l) => received.some((x) => x.itemId === l.productId)));
        if (Math.abs(diff) >= 0.01) tx.set(db.collection(`${T}/transactions`).doc(), money(Math.abs(diff), diff > 0 ? 'expense' : 'reversal', `Order #${number} from ${supplier} cost ${diff > 0 ? 'more' : 'less'} than ordered`, supplier));
        return { status: done ? 'Received' : 'Partially Received', received, units, supplier, number, missing, ...(store ? { storeName: store.name, unplaced } : {}) };
      });
      if (!r.already) await logAuditAdmin(db, tenantId, { action: action === 'receive' ? 'inventory.receive' : 'inventory.order_cancel', targetType: 'order', targetId: orderId,
        summary: action === 'receive' ? `${by} received order #${r.number} from ${r.supplier}${r.storeName ? ` at ${r.storeName}` : ''}: ${r.units} ${r.units === 1 ? 'container' : 'containers'}.` : `${by} closed order #${r.number} from ${r.supplier}${r.given ? `; $${Number(r.given).toFixed(2)} given back` : ''}.`, actor: { type: 'user', id: actorId, name: by } } as any).catch(() => {});
      // What came in at another price than last time, and what that did to the menu (never holds up the delivery).
      let moved: any[] = [];
      if (!r.already && action === 'receive' && Array.isArray(r.received) && r.received.length) {
        const tenant: any = (await db.doc(T).get()).data() || {};
        moved = (await checkDeliveries(db, tenantId, tenant, r.received.map((x: any) => String(x.itemId)), new Date(Date.parse(now) - 1000).toISOString()).catch((e: any) => { console.error('[ordering] price check', e?.message || e); return []; }))
          .map((m) => ({ id: m.id, name: m.name, up: m.up, words: moveWords(m), dishes: m.dishes.filter((d) => d.crossed || d.over).slice(0, 3).map((d) => ({ name: d.name, share: d.shareAfter, was: d.shareBefore, fix: d.fix })), options: m.options.slice(0, 2).map((o) => ({ item: o.item, option: o.option, cost: o.costAfter, charges: o.charges })) }));
      }
      return ok({ ...r, moved });
    }

    // PLAN
    // For one store, with more than one location.
    const stores = await storesOf(db, tenantId);
    const store = b.at ? stores.find((x) => x.id === String(b.at)) || null : null;
    if (b.at && !store) return bad('That store isn’t one of your locations now. Pick another, or order for every store.', 409);
    const tenant: any = (await db.doc(T).get()).data() || {};
    const cover = coverDaysOf(tenant);
    // From the same moment as now: two weeks is exactly fourteen days (never a hair less, which rounds an order up a case).
    const since = new Date(Date.parse(now) - LOOKBACK_DAYS * 86400000).toISOString();
    const LIMIT = 20000;
    const [inv, open, moves] = await Promise.all([
      db.collection(`${T}/inventory`).limit(3000).get(),
      db.collection(`${T}/orders`).where('status', 'in', [...OPEN_STATUSES]).limit(200).get(),
      // The last two weeks of what went and came back, newest first. Without the index for kind and date together, the
      // whole history of the stretch, kept to those kinds here.
      db.collection(`${T}/stockCorrections`).where('type', 'in', ['sold', 'used', 'spoiled', 'returned']).where('date', '>=', since).orderBy('date', 'desc').limit(LIMIT).get()
        .catch((e: any) => { console.warn('[ordering] the history by kind and date needs an index; reading by date', e?.message || e); return db.collection(`${T}/stockCorrections`).where('date', '>=', since).orderBy('date', 'desc').limit(LIMIT).get(); }),
    ]);
    const moved = moves.docs.map((d: any) => d.data() || {}).map((m: any) => ({ productId: String(m.productId || ''), type: String(m.type || ''), change: num(m.change), date: String(m.date || ''), unit: String(m.unit || ''),
      // (Kept at a store only when it's one of the stores now; anywhere else, it's shared between them.)
      storeId: stores.some((x) => x.id === m.storeId) ? String(m.storeId) : '' }));
    const all = new Map<string, any>(inv.docs.map((d: any) => [d.id, d.data() || {}]));
    // Over the stretch the history covers: two weeks, or since the business started when that's sooner (a quiet fortnight
    // stays a fortnight), or what was read when the read was cut short.
    const cut = moves.docs.length >= LIMIT;
    const oldestRead = moved.reduce((m: string, x: any) => (x.date && x.date < m ? x.date : m), now);
    const startedAt = typeof tenant.createdAt === 'string' ? tenant.createdAt : tenant.createdAt?.toDate?.()?.toISOString?.() || null;
    const days = spanDays(now, since, { startedAt, oldestRead, cut });
    const from = new Date(Date.parse(now) - days * 86400000).toISOString();
    const rate = usedPerDay(moved, from < since ? since : from, days, (id) => perOf(all.get(id)) || 1);
    const orders: SupplyOrder[] = open.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id })).filter((o: any) => Array.isArray(o.items))
      .map((o: any) => ({ ...o, number: String(o.number || orderNumber(o.id)) })).sort((a: any, z: any) => String(z.orderDate || '').localeCompare(String(a.orderDate || '')));
    // What's still to come, in what each thing's history measures.
    // (For one store: what's on its way to it, and what's on orders for every store together, apart.)
    const onOrder = new Map<string, number>(); const onOrderAll = new Map<string, number>();
    for (const o of orders) {
      // (One for a store that isn't a location any more: as if for every store, so it's never ordered again unseen.)
      const sid = String(o.storeId || ''); const known = stores.some((x) => x.id === sid);
      const to = store ? (sid === store.id ? onOrder : !known ? onOrderAll : null) : onOrder; if (!to) continue;
      for (const i of o.items) { const x = all.get(i.productId); if (x) to.set(i.productId, (to.get(i.productId) || 0) + remainingOf(i) * (perOf(x) || 1)); }
    }
    const items: ReturnType<typeof suggestFor>[] = []; const uncounted: { id: string; name: string }[] = []; const notHere: { id: string; name: string }[] = [];
    const byStore = store ? storeRates(moved, from < since ? since : from, days, (id) => perOf(all.get(id)) || 1) : null;
    let shared = false;
    for (const [id, x] of all) {
      if (!orderable(id, x)) continue;
      if (notCounted(x)) { uncounted.push({ id, name: String(x.name || 'Item') }); continue; }
      if (store && byStore) {
        if (!countedAt(x, stores).some((s) => s.id === store.id)) { notHere.push({ id, name: String(x.name || 'Item') }); continue; }
        const s = suggestAt(id, x, store, stores, byStore, onOrder.get(id) || 0, onOrderAll.get(id) || 0, cover); if (s.shared) shared = true;
        items.push(s); continue;
      }
      items.push(suggestFor(id, x, rate.get(id) || 0, onOrder.get(id) || 0, cover));
    }
    const plan = planBySupplier(items);
    // The suppliers it already uses, once each however each item spells it.
    const suppliers = plan.filter((x) => x.key !== '').map((x) => x.name).sort((a, z) => a.localeCompare(z)).slice(0, 200);
    // With more than one location, the stores a delivery can come to (and an order can be for).
    return ok({ coverDays: cover, lookback: Math.round(days), plan, uncounted: uncounted.sort((a, z) => a.name.localeCompare(z.name)), orders, suppliers, business: String(tenant.name || tenant.businessName || ''), stores,
      ...(store ? { at: store.id, atName: store.name, shared, notHere: notHere.sort((a, z) => a.name.localeCompare(z.name)) } : {}) });
  } catch (e: any) {
    if (e instanceof Stop) return bad(e.msg, e.status);
    console.error('[ordering]', e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
