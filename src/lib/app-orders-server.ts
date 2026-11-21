// src/lib/app-orders-server.ts — DELIVERY APP ORDERS AT THE COUNTER (server; lib/app-orders is the rules; design board
// "Delivery app orders"). The counter page's steps (api/counter):
//   appStart   a new order for an app, rung in from the same menu as any (lib/counter-server createCar, editOrder)
//   appSend    the app, its order code and when the courier gets here: to the kitchen to go, ready by then, with the
//              next free spot on the pickup shelf; it waits at the counter for the courier, paid on the app
//   (picked up: the counter's Handed over books it as the app's sale first: api/counter move, lib/counter-server payOrder)
//   appCancel  cancelled on the app before it was picked up: voided (lib/counter-server voidOrder, which also frees its
//              shelf spot and its code, as a manager's void does). Once the kitchen has started on it, a manager okays it.
//   appNightly the night after: codes from days ago cleared, and the managers told about any order still waiting
import { appOrdersOf, cleanAppCode, courierDue, freeShelf, appName, appClaimId } from '@/lib/app-orders';
import { sendOrder, voidOrder } from '@/lib/counter-server';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Who = { id: string | null; name: string };
type Fail = { ok: false; error: string; status: number; needsManager?: boolean };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
/** States that hold a shelf spot: being sent to the kitchen, and waiting for the courier. */
const ON_SHELF = ['sending', 'waiting'];

/** To the kitchen: which app, its code, and when the courier is due. The same code from the same app goes in once a day
 *  (a second tablet, or a tap twice, gets the order it already is). The code and the shelf spot are taken together, in
 *  one go, so two tablets never get the same spot; if the kitchen can't take it (sold out), both are let go again. */
export async function appSend(db: any, tenantId: string, tenant: any, orderId: string, input: { app: unknown; code: unknown; courierIn: unknown }, who: Who, now = Date.now()):
  Promise<{ ok: true; already?: boolean; shelf: string | null; due: string | null; name: string } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const A = appOrdersOf(tenant);
  if (!A.on) return fail('Delivery app orders aren’t on. A manager turns them on in the Menu page’s settings.', 409);
  const app = A.apps.find((x) => x.code === input.app);
  if (!app) return fail('Which app is it from?', 400);
  const code = cleanAppCode(input.code);
  if (!code) return fail('Type the order code from the app (letters and numbers).', 400);
  const courierAt = courierDue(now, input.courierIn);
  if (!courierAt) return fail('When does the courier get here?', 400);
  const T = `tenants/${tenantId}`; const day = todayIn(tenantTimeZone(tenant), new Date(now));
  const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
  const claimId = appClaimId(day, app.code, code);
  const claimRef = db.doc(`${T}/private/${claimId}`);
  const name = appName({ label: app.label, code });
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(orderRef)).data();
    const claim: any = (await tx.get(claimRef)).data();
    // A code typed before for this order (the send didn't go through, then the code was fixed): let go.
    const oldId = String(o?.app?.claimId || '');
    const old: any = oldId && oldId !== claimId && ID.test(oldId) ? (await tx.get(db.doc(`${T}/private/${oldId}`))).data() : null;
    // The spots on the shelf with an order on them now (today's app orders being sent, or waiting for their courier).
    const onShelf = (await tx.get(db.collection(`${T}/counterOrders`).where('app.state', 'in', ON_SHELF).where('day', '==', day).limit(100))).docs
      .filter((d: any) => d.id !== orderId).map((d: any) => d.data() || {});
    if (!o || !o.app) return fail('That isn’t an app order.', 404);
    if (claim && claim.orderId !== orderId) return fail(`${name} is already in, as ${claim.number || 'another order'}.`, 409);
    // (Sent already. One whose last step didn't finish, still 'sending', is finished below.)
    if (o.status !== 'building') return o.app.code === code && o.app.app === app.code ? { ok: true, already: true, finish: o.app.state === 'sending', shelf: o.app.shelf || null, due: o.dueAt || null } : fail('That order went to the kitchen already.', 409);
    if (!Array.isArray(o.lines) || !o.lines.length) return fail('Add what they ordered first.', 400);
    const shelf = o.app.shelf && o.app.code === code ? o.app.shelf : freeShelf(onShelf.map((w: any) => w.app?.shelf), A.shelves);
    if (old && old.orderId === orderId) tx.delete(db.doc(`${T}/private/${oldId}`));
    tx.set(claimRef, { orderId, number: o.number || null, at: new Date(now).toISOString(), appCodeDay: day });
    // No sales tax added: the app collects it. The total is what the items come to.
    tx.set(orderRef, { app: { state: 'sending', app: app.code, label: app.label, code, shelf, courierAt, sentBy: who.name, claimId }, tax: 0, taxLabel: null, total: Math.round(Number(o.subtotal || 0) * 100) / 100 }, { merge: true });
    return { ok: true, shelf };
  });
  // Waiting at the counter for the courier, paid on the app.
  const toShelf = async (shelf: string | null) => {
    const o: any = (await orderRef.get()).data() || {};
    await orderRef.set({ app: { state: 'waiting' } }, { merge: true });
    if (ID.test(String(o.carId || ''))) {
      const nowIso = new Date(now).toISOString();
      await db.doc(`${T}/driveThruCars/${o.carId}`).set({ stage: 'pickup', stageAt: { pickup: nowIso }, app: { label: app.label, code, shelf, courierAt: o.app?.courierAt || courierAt } }, { merge: true });
    }
  };
  if (r.ok && r.already) { if (r.finish) await toShelf(r.shelf || null); return { ok: true, already: true, shelf: r.shelf || null, due: r.due || null, name }; }
  if (!r.ok) return r;
  // To the kitchen, to go, ready for the courier. (Sold out, or off the menu: said, the code and the spot let go, and the
  // order is still being rung in.)
  const sent: any = await sendOrder(db, tenantId, tenant, orderId, who, { toGo: true, due: courierAt });
  if (sent.error) {
    await db.runTransaction(async (tx: any) => {
      const o: any = (await tx.get(orderRef)).data(); const c: any = (await tx.get(claimRef)).data();
      if (!o || o.status !== 'building') return;
      if (c && c.orderId === orderId) tx.delete(claimRef);
      // (The code goes too: an order that never went to the kitchen isn't an app order waiting for its courier.)
      tx.set(orderRef, { app: { state: 'taking', app: null, label: null, code: null, shelf: null, courierAt: null, claimId: null } }, { merge: true });
    }).catch(() => null);
    return fail(sent.error, sent.status || 409);
  }
  await toShelf(r.shelf || null);
  return { ok: true, shelf: r.shelf || null, due: sent.due || null, name };
}

/** Cancelled on the app before the courier picked it up: voided (what the kitchen hadn't started goes back), nothing in
 *  the books, its shelf spot and its code free again. Anyone at the counter while the kitchen hasn't started on it; once
 *  it has, food would be thrown out with no sale, so a manager okays it (manager: one signed in, or their PIN). */
export async function appCancel(db: any, tenantId: string, orderId: string, who: Who, opts: { manager?: boolean } = {}):
  Promise<{ ok: true; already?: boolean; returned: number; wasted: number; name: string; label: string } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  const o: any = (await ref.get()).data();
  if (!o?.app?.code) return fail('That isn’t an app order.', 404);
  const name = appName(o.app); const label = String(o.app.label || 'the app');
  if (o.app.state === 'cancelled') return { ok: true, already: true, returned: 0, wasted: 0, name, label };
  if (o.paidAt || o.app.state === 'picked') return fail(`${name} was picked up already.`, 409);
  const v: any = await voidOrder(db, tenantId, orderId, `Cancelled on ${label}`, who, { nothingMade: !opts.manager });
  if (v.error) return v.code === 'made' ? { ok: false, needsManager: true, error: `The kitchen started on ${name}, so a manager okays taking it off. Their PIN, or ask one to.`, status: 403 } : fail(v.error, v.status || 409);
  return { ok: true, already: !!v.already, returned: v.returned || 0, wasted: v.wasted || 0, name, label };
}

/** The night after: codes from two days ago and before are cleared, and an app order still waiting from an earlier day
 *  (nobody tapped picked up or cancelled) is told to the managers once, to check on the app. */
export async function appNightly(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<{ cleared: number; told: number }> {
  const T = `tenants/${tenantId}`; const today = todayIn(tenantTimeZone(tenant), new Date(now));
  const before = todayIn(tenantTimeZone(tenant), new Date(now - 2 * 86400000));
  let cleared = 0, told = 0;
  const old = await db.collection(`${T}/private`).where('appCodeDay', '<', before).limit(300).get();
  for (const d of old.docs) { await d.ref.delete().catch(() => null); cleared++; }
  const left = (await db.collection(`${T}/counterOrders`).where('app.state', 'in', ON_SHELF).limit(100).get()).docs
    .filter((d: any) => { const o: any = d.data() || {}; return String(o.day || '') < today && o.status === 'sent' && !o.paidAt && !o.app?.toldAt; });
  if (left.length) {
    const names = left.map((d: any) => appName(d.data()?.app)).filter(Boolean);
    const { tellManagers } = await import('@/lib/tell-managers');
    const n = await tellManagers(db, tenantId, tenant, { type: 'app_order_waiting', link: '/counter',
      message: `${names.length === 1 ? `${names[0]} is` : `${names.length} delivery app orders are`} still waiting at the counter from an earlier day${names.length > 1 ? ` (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', and more' : ''})` : ''}. Check the app, then mark each one picked up by the courier or cancelled on the app.` });
    if (n >= 0) { const at = new Date(now).toISOString(); for (const d of left) await d.ref.set({ app: { toldAt: at } }, { merge: true }); told = left.length; }
  }
  return { cleared, told };
}
