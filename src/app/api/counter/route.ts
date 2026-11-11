// src/app/api/counter/route.ts — QUICK-SERVICE ORDERS (L21): the drive-thru lane first, then the counter and kiosk. A
// lane tablet is set up once like the kitchen screen (api/kitchen 'pair', kind 'drive-thru') and carries its own key; a
// team member signed in on their own device can use it with no key. A PIN pass (api/kitchen 'pin') puts a name on
// what's done. Every price comes from the menu (lib/counter-orders, lib/menu-choices), never from a screen, and every
// change to an order goes through lib/counter-server (the voice assistant uses the same steps).
//   lane   { tenantId, key }                        → cars in the lane (at the speaker, paying, picking up, pulled
//                                                      forward), their orders and how the kitchen is getting on, today's
//                                                      times against the target (and where the time goes), and the menu
//   board  { tenantId, key }                        → the outdoor order board (its own kind of key, good for nothing
//                                                      else): the newest car's order as it's built, nothing else
//   car    { tenantId, key, carKey? }               → a car at the speaker: its number and an empty order (the same
//                                                      carKey sent twice is the same car)
//   add    { tenantId, key, orderId, itemId, quantity?, choices?, tapKey? } → a line, priced from the menu (the
//                                                      same tapKey twice adds it once)
//   remove { tenantId, key, orderId, lineId, tapKey? }  ·  qty { tenantId, key, orderId, lineId, quantity, tapKey? }
//   send   { tenantId, key, orderId }               → to the kitchen: one ticket a line, due by the channel's target
//                                                      (the drive-thru's is the tightest); stock and recipe parts once
//   paid   { tenantId, key, orderId, method: 'card'|'cash', tendered? } → paid at the window: the sale and its tax in
//                                                      the books, cash into the open drawer (with what was handed over
//                                                      and the change); the car moves on to pick up
//   move   { tenantId, key, carId, to: 'pickup'|'forward'|'gone', spot? } → along the lane, only ever forward;
//                                                      "forward" parks it (a numbered spot) so the cars behind keep
//                                                      moving; "gone" hands it over (paid, or never sent)
//   cancel { tenantId, key, orderId }               → an order not sent yet, dropped (the car leaves the lane)
//   void   { tenantId, key, orderId, reason, staffPass? } → a sent order that won't be paid (the car drove off), by a
//                                                      manager (their PIN, or signed in): lib/counter-server voidOrder
// Part of Lounge & hospitality: closed while it isn't part of the plan (lib/tool-lock).
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { accessLockOf } from '@/lib/tenant-access';
import { toolLocked } from '@/lib/tool-lock';
import { screenOf, teamInstead, workingNow } from '@/lib/screen-keys';
import { readMenu } from '@/lib/menu-server';
import { targetsOf, photoOf, CHANNEL_NAME, type Channel } from '@/lib/counter-orders';
import { createCar, editOrder, sendOrder, voidOrder } from '@/lib/counter-server';
import { stopCarCall } from '@/lib/drive-thru-voice';
import { startOfDay, todayIn, tenantTimeZone } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const STAGES = ['speaker', 'pay', 'pickup', 'forward', 'gone'] as const;
type Stage = typeof STAGES[number];
const LIVE: Stage[] = ['speaker', 'pay', 'pickup', 'forward'];
const MANAGER_ROLES = ['owner', 'admin', 'manager'];
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Today's lane numbers, worked out at most every 20 seconds a business (every tablet polls every 2), not on every read.
const statsCache = new Map<string, { at: number; stats: any }>();

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['lane', 'board', 'car', 'add', 'remove', 'qty', 'send', 'paid', 'move', 'cancel', 'void'].includes(action)) return bad('Unknown action.');
    const db = getAdminDb(); const T = `tenants/${tenantId}`;

    let screen: any = await screenOf(db, tenantId, b.key);
    let member: { id: string; name: string } | null = null;
    if (!screen && !b.key && action !== 'board') {
      const t: any = await teamInstead(req, db, tenantId);
      if (t.deny) return t.deny;
      if (t.renter) return bad('This is for the business’s own team.', 403);
      member = t.member; screen = { ref: null, name: member!.name, kind: 'drive-thru', passes: {} };
    }
    if (!screen) {
      const slow = await limitPublic(req, 'kitchen_key', tenantId, { perHour: 60, perDay: 2000 }); if (slow) return slow;
      return bad('This screen isn’t set up, or was stopped. A manager can set it up again here.', 401);
    }
    // Only a lane screen takes orders and payments here; the outdoor order board's key only shows the order at the
    // speaker. A kitchen or floor screen's key does nothing here.
    if (screen.ref && !(screen.kind === 'drive-thru' || (screen.kind === 'drive-thru-board' && action === 'board'))) return bad('This screen isn’t set up for the drive-thru. A manager can set it up here.', 401);
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (accessLockOf(tenant).locked) return NextResponse.json({ ok: false, closed: true, error: 'The lane screen is closed for now. The business owner can tell you more.' }, { status: 403 });
    // Handing over, taking payment for, or voiding an order already taken still works if the plan changes mid-service.
    if (!['paid', 'move', 'board', 'void'].includes(action)) { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }
    const staff = member || (b.staffPass ? await workingNow(db, tenantId, screen, b.staffPass) : null);
    const staffOk = b.staffPass && !member ? !!staff : undefined;
    const who = { id: staff?.id || null, name: staff?.name || screen.name };
    const by = who.name;
    const now = new Date(); const nowIso = now.toISOString();
    const tz = tenantTimeZone(tenant);

    if (action === 'lane') {
      // Only the cars in the lane now (a car is gone once it's handed over, left, or voided), oldest first.
      // (Read generously and sorted here, so however many were left behind, the cars that just arrived are always shown.)
      const [carSnap, menu] = await Promise.all([db.collection(`${T}/driveThruCars`).where('stage', 'in', LIVE).limit(300).get(), readMenu(db, tenantId)]);
      const live = carSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).sort((a: any, c: any) => String(a.arrivedAt).localeCompare(String(c.arrivedAt))).slice(-40);
      const orderIds = Array.from(new Set(live.map((c: any) => String(c.orderId || '')).filter((x: string) => ID.test(x))));
      const [orderSnaps, ticketSnaps] = await Promise.all([
        Promise.all(orderIds.map((id) => db.doc(`${T}/counterOrders/${id}`).get())),
        Promise.all(Array.from({ length: Math.ceil(orderIds.length / 30) }, (_, i) => orderIds.slice(i * 30, i * 30 + 30)).map((ids) => db.collection(`${T}/kdsTickets`).where('orderId', 'in', ids).get())),
      ]);
      const tickets = ticketSnaps.flatMap((s: any) => s.docs.map((d: any) => d.data() || {}));
      const orders: Record<string, any> = {};
      for (const s of orderSnaps) {
        const o: any = s.data(); if (!o) continue;
        const mine = tickets.filter((t: any) => t.orderId === s.id && t.status !== 'cancelled');
        const waitingOn = mine.filter((t: any) => t.status === 'pending' || t.status === 'in_progress').map((t: any) => ({ name: String(t.menuItemName || 'Item'), quantity: num(t.quantity) || 1 }));
        orders[s.id] = { id: s.id, number: o.number, channel: o.channel, status: o.status, lines: o.lines || [], subtotal: o.subtotal || 0, tax: o.tax || 0, taxLabel: o.taxLabel || 'Tax', total: o.total || 0,
          paidAt: o.paidAt || null, payMethod: o.payMethod || null, sentAt: o.sentAt || null, dueAt: o.dueAt || null,
          kitchen: o.status === 'building' ? 'not sent' : mine.length && !waitingOn.length ? 'ready' : 'making', waitingOn,
          readyCount: mine.filter((t: any) => t.status === 'ready' || t.status === 'delivered').length, ticketCount: mine.length };
      }
      const target = targetsOf(tenant)['drive-thru'];
      let cached = statsCache.get(tenantId);
      if (!cached || now.getTime() - cached.at > 20000 || cached.stats.target !== target) {
        // Served today (a car that left or was voided isn't a time), and where the time went: ordering at the speaker,
        // then from the order to the window, then waiting at the window or parked until it's handed over.
        const since = startOfDay(todayIn(tz, now), tz).toISOString(); const hourAgo = new Date(now.getTime() - 3600000).toISOString();
        const [goneSnap, hourSnap] = await Promise.all([
          db.collection(`${T}/driveThruCars`).where('goneAt', '>=', since).limit(3000).get(),
          db.collection(`${T}/driveThruCars`).where('arrivedAt', '>=', hourAgo).limit(1000).get(),
        ]);
        const gone = goneSnap.docs.map((d: any) => d.data() || {}).filter((c: any) => !c.left);
        const span = (c: any, from: string, to: string) => { const a = Date.parse(String(c.stageAt?.[from] || (from === 'speaker' ? c.arrivedAt : ''))), z = Date.parse(String(to === 'gone' ? c.goneAt : c.stageAt?.[to] || '')); const v = (z - a) / 1000; return Number.isFinite(v) && v >= 0 && v < 3600 ? v : null; };
        const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((s2, x) => s2 + x, 0) / v.length) : null; };
        cached = { at: now.getTime(), stats: { average: avg(gone.map((c: any) => span(c, 'speaker', 'gone'))), target,
          ordering: avg(gone.map((c: any) => span(c, 'speaker', 'pay'))), toWindow: avg(gone.map((c: any) => span(c, 'pay', 'pickup'))), atWindow: avg(gone.map((c: any) => span(c, 'pickup', 'gone'))),
          underTarget: gone.filter((c: any) => { const v = span(c, 'speaker', 'gone'); return v !== null && v <= target; }).length,
          thisHour: hourSnap.docs.filter((d: any) => !(d.data() || {}).left).length, servedToday: gone.length } };
        statsCache.set(tenantId, cached);
        if (statsCache.size > 500) statsCache.delete(statsCache.keys().next().value as string);
      }
      return ok({
        business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Drive-thru' }, screen: screen.name, staff: staff ? { id: staff.id, name: staff.name } : null, staffOk,
        cars: live.map((c: any) => ({ id: c.id, number: c.number, stage: c.stage, arrivedAt: c.arrivedAt, stageAt: c.stageAt || {}, orderId: c.orderId || null, takenBy: c.takenBy || null, spot: c.spot || null,
          // The voice assistant's call for this car, if it has one (api/counter/voice): its state and who took over.
          voice: c.voice?.callId ? { status: String(c.voice.status || ''), callId: String(c.voice.callId), takenOverBy: c.voice.takenOverBy || null } : null })),
        orders, stats: { ...cached.stats, inLane: live.length }, menu: menu.filter((m) => m.onMenu), now: nowIso,
      });
    }

    if (action === 'board') {
      // What a guest at the speaker sees: the newest car's order as it's built, and once it's sent, where to go and what
      // it comes to (for 20 seconds). An order nobody has touched for 10 minutes is never shown to the next car.
      const since = new Date(now.getTime() - 30 * 60000).toISOString();
      const carSnap = await db.collection(`${T}/driveThruCars`).where('arrivedAt', '>=', since).get();
      const newest: any = carSnap.docs.map((d: any) => d.data() || {}).sort((a: any, c: any) => String(c.arrivedAt).localeCompare(String(a.arrivedAt)))[0] || null;
      const o: any = newest && (newest.stage === 'speaker' || newest.stage === 'pay') && ID.test(String(newest.orderId || '')) ? (await db.doc(`${T}/counterOrders/${newest.orderId}`).get()).data() : null;
      const touched = o ? Date.parse(String(o.updatedAt || o.createdAt || '')) : NaN;
      const show = o && (o.status === 'building' ? now.getTime() - touched < 10 * 60000 : o.status === 'sent' && now.getTime() - Date.parse(String(o.sentAt || '')) < 20000);
      return ok({
        business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Drive-thru' },
        order: show ? { number: o.number, sent: o.status !== 'building', lines: (o.lines || []).map((l: any) => ({ name: l.name, quantity: l.quantity, choicesText: l.choicesText || null, price: Math.round(num(l.unitPrice) * num(l.quantity) * 100) / 100, imageUrl: photoOf(l) })),
          subtotal: num(o.subtotal), tax: num(o.tax), total: num(o.total) } : null,
        now: nowIso,
      });
    }

    // Anything that changes today's numbers lets them be worked out again on the next read.
    if (['car', 'move', 'cancel', 'void'].includes(action)) statsCache.delete(tenantId);

    if (action === 'car') { const c = await createCar(db, tenantId, tenant, b.carKey, who); statsCache.delete(tenantId); return ok({ ...c, staffOk }); }

    if (action === 'move') {
      const carId = String(b.carId || ''); const to = String(b.to || '') as Stage;
      if (!ID.test(carId) || !STAGES.includes(to) || to === 'speaker') return bad('Where to?');
      const carRef = db.doc(`${T}/driveThruCars/${carId}`);
      const r: any = await db.runTransaction(async (tx: any) => {
        const car: any = (await tx.get(carRef)).data(); if (!car) return { error: 'That car isn’t in the lane.', status: 404 };
        const order: any = car.orderId ? (await tx.get(db.doc(`${T}/counterOrders/${car.orderId}`))).data() : null;
        const tix = to === 'gone' && car.orderId ? (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', car.orderId))).docs : [];
        if (car.stage === 'gone') return { already: true };
        // Only ever forward (a tap on an old screen never puts a car back, or spoils its times).
        if (STAGES.indexOf(to) <= STAGES.indexOf(car.stage)) return { already: true };
        if (to === 'gone' && order && order.status !== 'building' && !order.paidAt) return { error: 'Take payment first. If they drove off, void the order.', status: 409 };
        if ((to === 'pickup' || to === 'forward') && order && !order.paidAt) return { error: 'Take payment first.', status: 409 };
        const spot = to === 'forward' ? String(b.spot ?? '').replace(/[^A-Za-z0-9 -]/g, '').trim().slice(0, 12) || null : undefined;
        tx.set(carRef, { stage: to, stageAt: { ...(car.stageAt || {}), [to]: nowIso }, ...(to === 'gone' ? { goneAt: nowIso, handedBy: by } : {}), ...(to === 'gone' && (!order || order.status === 'building') ? { left: true } : {}), ...(spot !== undefined ? { spot } : {}) }, { merge: true });
        if (to === 'gone' && order) {
          tx.set(db.doc(`${T}/counterOrders/${car.orderId}`), { status: order.status === 'building' ? 'cancelled' : 'done', doneAt: nowIso }, { merge: true });
          // Handed over: whatever the kitchen hadn't marked served is now.
          for (const d of tix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && t.status !== 'cancelled') tx.set(d.ref, { status: 'delivered', deliveredAt: nowIso, deliveredBy: { name: by, via: 'lane' } }, { merge: true }); }
        }
        return { ok: true };
      });
      statsCache.delete(tenantId);   // again once it's done, so a read in between never keeps the old numbers
      // Handed over or gone: the voice assistant (if it's still on with this car) hangs up.
      if (!r.error && to === 'gone') await stopCarCall(db, tenantId, carId, 'car gone');
      return r.error ? bad(r.error, r.status) : ok({ already: !!r.already, staffOk });
    }

    const orderId = String(b.orderId || ''); if (!ID.test(orderId)) return bad('Which order?');
    const orderRef = db.doc(`${T}/counterOrders/${orderId}`);

    if (action === 'add' || action === 'remove' || action === 'qty') {
      const r: any = await editOrder(db, tenantId, tenant, orderId, action === 'add' ? { action, itemId: String(b.itemId || ''), quantity: b.quantity, choices: b.choices, tapKey: b.tapKey }
        : action === 'remove' ? { action, lineId: String(b.lineId || ''), tapKey: b.tapKey } : { action, lineId: String(b.lineId || ''), quantity: b.quantity, tapKey: b.tapKey });
      return r.error ? bad(r.error, r.status) : ok({ order: r.order, staffOk });
    }

    if (action === 'cancel') {
      const r: any = await db.runTransaction(async (tx: any) => {
        const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
        const car: any = o.carId ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
        if (o.status === 'cancelled') return { ok: true };
        if (o.status !== 'building') return { error: 'That order has gone to the kitchen. If they drove off, void it.', status: 409 };
        tx.set(orderRef, { status: 'cancelled', cancelledAt: nowIso, cancelledBy: by }, { merge: true });
        if (car && car.stage !== 'gone') tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'gone', goneAt: nowIso, left: true, stageAt: { ...(car.stageAt || {}), gone: nowIso } }, { merge: true });
        return { ok: true, carId: o.carId || null };
      });
      statsCache.delete(tenantId);
      if (!r.error && r.carId) await stopCarCall(db, tenantId, String(r.carId), 'car left');
      return r.error ? bad(r.error, r.status) : ok({ staffOk });
    }

    if (action === 'send') {
      const r: any = await sendOrder(db, tenantId, tenant, orderId, who);
      return r.error ? bad(r.error, r.status) : ok({ already: !!r.already, dueAt: r.due || null, staffOk });
    }

    if (action === 'void') {
      // A manager only: their PIN on this screen, or signed in on their own device as one.
      let manager = false;
      if (staff) manager = await isManager(db, tenantId, staff.id);
      if (!manager) return NextResponse.json({ ok: false, needsManager: true, error: 'A manager’s PIN is needed to void an order.', staffOk }, { status: 403 });
      const reason = String(b.reason || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!reason) return bad('Why is it being voided?');
      const r: any = await voidOrder(db, tenantId, orderId, reason, who);
      statsCache.delete(tenantId);
      if (!r.error) { const carId = String(((await orderRef.get()).data() || {}).carId || ''); if (ID.test(carId)) await stopCarCall(db, tenantId, carId, 'voided'); }
      return r.error ? bad(r.error, r.status) : ok({ already: !!r.already, returned: r.returned, wasted: r.wasted, staffOk });
    }

    // paid
    const method = b.method === 'cash' ? 'cash' : b.method === 'card' ? 'card' : null; if (!method) return bad('Card or cash?');
    // Cash handed over, when the screen worked out the change: kept with the sale.
    const tendered = method === 'cash' && b.tendered !== undefined && b.tendered !== null ? Math.round(Number(b.tendered) * 100) / 100 : null;
    if (tendered !== null && (!Number.isFinite(tendered) || tendered < 0 || tendered > 100000)) return bad('How much did they hand over?');
    const r: any = await db.runTransaction(async (tx: any) => {
      const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
      const car: any = o.carId ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
      // The drawer that's open now, read in the same step (a drawer closed mid-sale never takes the cash).
      const till = method === 'cash' ? (await tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))).docs : [];
      // Paid already (another tablet, or the first answer was lost): say how, and the change that was given.
      if (o.paidAt) return { already: true, change: o.changeGiven ?? null, payMethod: o.payMethod || null };
      if (o.status !== 'sent' && o.status !== 'done') return { error: o.status === 'voided' ? 'That order was voided.' : 'Send the order to the kitchen first.', status: 409 };
      const total = num(o.total), subtotal = num(o.subtotal), tax = num(o.tax);
      if (tendered !== null && tendered < total) return { error: `That’s less than the total ($${total.toFixed(2)}).`, status: 400 };
      const saleRef = db.doc(`${T}/transactions/counter_${orderId}`); const taxRef = db.doc(`${T}/transactions/counter_${orderId}_tax`);
      const common = { date: nowIso, type: 'income', context: 'Business', paymentMethod: method, hasReceipt: true, clientOrVendor: `${CHANNEL_NAME[o.channel as Channel]} ${o.number}`, orderId, channel: o.channel, tenantId };
      tx.set(saleRef, { id: saleRef.id, ...common, description: `${CHANNEL_NAME[o.channel as Channel]} order ${o.number}`, category: 'Retail', amount: subtotal });
      if (tax > 0) tx.set(taxRef, { id: taxRef.id, ...common, description: o.taxLabel || 'Sales tax', category: 'Tax Collected', taxBucket: 'tax_collected', amount: tax, hasReceipt: false });
      // Cash goes into the one drawer that's open (two open, or none: it's kept on the order, for the drawer count).
      const drawer = method === 'cash' && till.length === 1 ? till[0].ref : null;
      if (drawer) tx.set(drawer, { expectedCash: FieldValue.increment(total), totalCashSales: FieldValue.increment(total) }, { merge: true });
      const change = tendered !== null ? Math.round((tendered - total) * 100) / 100 : null;
      tx.set(orderRef, { paidAt: nowIso, payMethod: method, paidBy: by, tillId: drawer ? drawer.id : null, ...(method === 'cash' && !drawer ? { cashNotInDrawer: true } : {}),
        ...(tendered !== null ? { cashTendered: tendered, changeGiven: change } : {}) }, { merge: true });
      if (car && (car.stage === 'speaker' || car.stage === 'pay')) tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'pickup', stageAt: { ...(car.stageAt || {}), pickup: nowIso } }, { merge: true });
      return { ok: true, drawer: !!drawer, change, payMethod: method };
    });
    return r.error ? bad(r.error, r.status) : ok({ already: !!r.already, inDrawer: r.drawer ?? null, change: r.change ?? null, payMethod: r.payMethod || null, staffOk });
  } catch (e: any) {
    console.error('[counter] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}

/** Someone a manager here (their own team record says so). */
async function isManager(db: any, tenantId: string, staffId: string | null): Promise<boolean> {
  if (!staffId || !ID.test(staffId)) return false;
  const [st, t] = await Promise.all([db.doc(`tenants/${tenantId}/staff/${staffId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
  const s: any = st.data() || {}; const tn: any = t.data() || {};
  if (s.isActive === false || s.archived === true || s.status === 'archived') return false;
  return MANAGER_ROLES.includes(String(s.role || '')) || s.isManager === true || (tn.ownerId && tn.ownerId === staffId);
}
