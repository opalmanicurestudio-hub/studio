// /api/retail/fulfil — EVERY STEP OF AN ONLINE ORDER, ON THE SERVER. Claiming, scanning, packing, ready, bringing it
// out, handing over, shipping, cancelling, returns and claims all run here (lib/retail-fulfill, lib/retail-returns,
// lib/waves), with the person's role checked first (lib/fulfilment-access) and the shop's rules re-checked inside each
// step's transaction. A browser can't move an order's stage or change its items itself (firestore.rules), so nothing
// on the order page or the boards can show a step that didn't happen. Screens call this through lib/fulfil-client.
//   POST { tenantId, action, ...args } → what the step answers ({ ok, message, … })
import { canChoose, whenInSentence } from '@/lib/delivery-retry';
import { NextRequest, NextResponse, after } from 'next/server';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { permissionsFor } from '@/lib/fulfilment-access';
import * as F from '@/lib/retail-fulfill';
import * as R from '@/lib/retail-returns';
import { setWaveStatus } from '@/lib/waves';
import { syncRenterCreditsForOrder } from '@/lib/renter-sales-server';
import { shareOrderTip } from '@/lib/order-tips';
import { resolveCreditReturn } from '@/lib/return-credit';
import { decideClaim } from '@/lib/claim-decide';
import { recordClaimLoss } from '@/lib/claim-loss';
import { settleClaim, type SettleHow } from '@/lib/claim-settle';
import { syncTracking } from '@/lib/order-tracking';
import { queueMessage, deliverMessage, type MessageKind } from '@/lib/order-outbox';
import { RETURN_REASONS, RETURN_RESOLUTIONS } from '@/lib/retail-orders';
import { failReason } from '@/lib/delivery-run';
import { deliveryFrom } from '@/lib/delivery-plan';

export const dynamic = 'force-dynamic';
// A payment page the customer opened for another delivery try is theirs to finish for this long (lib/delivery-retry-server).
const PAY_GRACE_MS = 5 * 60_000;
export const maxDuration = 60;

type Need = 'pick' | 'pack' | 'handover' | 'ship' | 'manage' | 'staff' | 'returns' | 'claims' | 'credit';
/** What each step needs. 'staff': anyone on the team (receiving stock releases backorders it covers). */
const ACTIONS: Record<string, Need> = {
  claimNext: 'pick', claimOrder: 'pick', takeOver: 'pick', releaseBatch: 'pick', sweepStale: 'staff',
  scanItem: 'pick', scanBox: 'pick', tapLine: 'pick', undoCount: 'pick', shortLine: 'pick', reopenLine: 'pick',
  scanPack: 'pack', markPacked: 'pack', markReady: 'pack', bringingOut: 'handover', handoffScan: 'handover', handoffPin: 'handover', handoffNoScan: 'handover',
  splitReady: 'pack', releaseBackorder: 'pack', releaseCovered: 'staff', waveStatus: 'pick',
  markShipped: 'ship', cancel: 'manage',
  deliveryOut: 'handover', deliveryDone: 'handover', deliveryFailed: 'handover', deliveryDoor: 'handover', deliverySkip: 'handover',
  openReturn: 'returns', receiveReturnLine: 'returns', resolveReturn: 'returns', trimReturn: 'returns', decideHold: 'returns', decideClaim: 'claims', requestClaimInfo: 'claims', giveCredit: 'credit',
};

const s = (v: any, n = 200) => String(v ?? '').slice(0, n);
const safeId = (v: any) => { const x = s(v, 160); return x && !x.includes('/') && x !== '.' && x !== '..' && !/^__.*__$/.test(x) ? x : ''; };

/** Who's asking, for the follow-ups a step starts (a message, a renter's share, store credit), kept for each request on
 *  its own: two requests on one server can never use each other's person. */
type Ctx = { actor: { id: string; name: string }; boss: boolean; base: string; auth: string; tenantId: string; queued: Promise<unknown>[] };
const ctxStore = new AsyncLocalStorage<Ctx>();
const ctx = (): Ctx | undefined => ctxStore.getStore();
/** A step's message to the customer (lib/order-outbox): queued before the step answers, so it's never lost with the
 *  request, then sent straight after it (with the caller's sign-in, and the server's key); one that doesn't go is tried
 *  again by the five-minute job. Sent from the app's own address when it's set, never one a caller could send. */
function sendMessage(kind: MessageKind, a: { orderId?: string; lineId?: string; returnId?: string; claimId?: string; key?: string }, tenantId?: string): void {
  const c = ctx(); if (!c) return;
  const db = getAdminDb(); const t = tenantId || c.tenantId;
  c.queued.push(queueMessage(db, t, kind, a).then((id) => {
    if (id) after(async () => { await deliverMessage(db, id, { base: c.base, auth: c.auth }).catch((e: any) => console.warn('[fulfil] message', id, String(e?.message || e).slice(0, 160))); });
  }).catch((e: any) => console.error('[fulfil] message not queued', kind, String(e?.message || e).slice(0, 160))));
}
/** After a delivery step, the driver's route as the order pages see it (lib/delivery-live-server), straight away. */
function refreshRoute(db: any, tenantId: string, orderId: string): void {
  const job = async () => {
    const o: any = (await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get()).data() || {};
    const { refreshDriver } = await import('@/lib/delivery-live-server');
    if (o.delivery?.driverId) await refreshDriver(db, tenantId, String(o.delivery.driverId));
  };
  try { after(() => job().catch(() => null)); } catch { void job().catch(() => null); }
}

F.setFulfilEffects({
  // The shop's own alert about a customer left waiting comes from the board (api/retail/curbside-notify), not a step.
  curbside: (t, orderId, moment) => { if (moment !== 'staff_escalation') sendMessage(moment === 'ready' ? 'curbside_ready' : 'curbside_out', { orderId }, t); },
  short: (t, orderId, lineId) => sendMessage('order_short', { orderId, lineId }, t),
  renterCredits: (t, o) => { const name = ctx()?.actor.name || 'A team member'; if (o?.id && (o.lines || []).some((l: any) => l?.soldFor?.renterId)) after(async () => { await syncRenterCreditsForOrder(getAdminDb(), t, String(o.id), name).catch(() => 0); }); },
  tip: (t, o) => { if (o?.id && (Number(o.tipCents) || 0) > 0) after(async () => { await shareOrderTip(getAdminDb(), t, String(o.id)).catch(() => null); }); },
});
R.setReturnEffects({
  // The person who checked the return in, as the step was handed them; a manager's rights only from this request.
  credit: async (t, returnId, who) => resolveCreditReturn(getAdminDb(), t, returnId, { uid: who.id, name: who.name, isManager: ctx()?.actor.id === who.id && ctx()?.boss === true }) as any,
  notify: (t, returnId) => sendMessage('return_outcome', { returnId }, t),
  renterCredits: (t, orderId) => { const name = ctx()?.actor.name || 'A team member'; after(async () => { await syncRenterCreditsForOrder(getAdminDb(), t, orderId, name).catch(() => 0); }); },
});

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = s(b.tenantId, 120);
  const action = s(b.action, 40);
  const need = ACTIONS[action];
  if (!need) return NextResponse.json({ ok: false, message: 'Unknown step.' }, { status: 400 });
  const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  const a: any = g.actor;
  const perms = permissionsFor({ role: a.isTenantOwner ? 'owner' : a.isManager ? 'manager' : a.role, fulfilmentRole: a.fulfilmentRole || undefined });
  const boss = a.isTenantOwner === true || a.isManager === true || ['owner', 'admin'].includes(String(a.role || '').toLowerCase());
  const refunds = boss || (Array.isArray(a.caps) && a.caps.includes('checkout.refund'));
  // Handing over at the counter is front-desk work too: anyone on the team, unless a manager made them a picker or gave
  // them no part in orders.
  const explicit = String(a.fulfilmentRole || '').toLowerCase();
  const allowed = need === 'staff' ? true
    : need === 'pick' ? perms.canPick
    : need === 'pack' ? perms.canPack
    : need === 'handover' ? !(a.isRenter && action.startsWith('delivery')) && (perms.canPack || (!explicit || !['picker', 'none'].includes(explicit)))
    : need === 'ship' ? perms.canShip
    : need === 'manage' ? perms.canManage || refunds
    // Returns move stock back onto the shelf or write it off: the team's packers and up, never a renter, and never someone
    // a manager made a picker or gave no part in orders.
    : need === 'returns' ? !a.isRenter && (perms.canPack || perms.canManage || refunds || (!explicit || !['picker', 'none'].includes(explicit)))
    // Store credit for the trouble: the same team as returns (never a renter, a picker or someone with no part in
    // orders); how much is lib/goodwill-credit's.
    : need === 'credit' ? !a.isRenter && (perms.canPack || perms.canManage || refunds || (!explicit || !['picker', 'none'].includes(explicit)))
    : refunds && !a.isRenter;
  if (!allowed && a.isRenter && action.startsWith('delivery')) return NextResponse.json({ ok: false, message: 'Deliveries are made by the shop’s own team.' }, { status: 403 });
  if (!allowed) {
    const words: Record<Need, string> = {
      pick: 'Packing isn’t part of your role. Ask a manager to add it.', pack: 'Finishing orders isn’t part of your role. Ask a manager to add it.',
      handover: 'Handing orders over isn’t part of your role. Ask a manager to add it.',
      ship: 'Shipping isn’t part of your role. Ask a manager to make you a shipper.', manage: 'Canceling orders is for a manager.',
      staff: '', returns: 'Returns aren’t part of your role. Ask a manager to add it.', claims: 'Deciding on a report is for a manager or someone who can refund.',
      credit: 'Giving store credit isn’t part of your role. Ask a manager.',
    };
    return NextResponse.json({ ok: false, message: action === 'requestClaimInfo' ? 'Asking a customer about a report is for a manager or someone who can refund.' : words[need] }, { status: 403 });
  }
  // Who did it comes from the sign-in, never from the request.
  const actor = { id: String(a.uid), name: String(a.name || 'A team member') };
  const db = getAdminDb();
  const base = String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '') || req.nextUrl?.origin || '';
  return ctxStore.run({ actor, boss, base, auth: req.headers.get('authorization') || '', tenantId, queued: [] }, () => run(req, b, tenantId, action, actor, a, perms, boss, db));
}

async function run(req: NextRequest, b: any, tenantId: string, action: string, actor: { id: string; name: string }, a: any, perms: any, boss: boolean, db: any) {
  const orderId = safeId(b.orderId); const lineId = safeId(b.lineId);
  const need1 = (v: string, what: string) => (v ? null : NextResponse.json({ ok: false, message: `Which ${what}?` }, { status: 400 }));
  const touchedIds: string[] = [];
  try {
    let out: any;
    switch (action) {
      case 'claimNext': case 'claimOrder': {
        // How many batches one person may take from the queue at once (their role's limit), checked here, not only on
        // screen. Opening a particular order (a scan at the shelf, Start packing on its page) isn't held back by it.
        const mine = await db.collection(`tenants/${tenantId}/fulfillmentBatches`).where('active', '==', true).where('assignedTo', '==', actor.id).get();
        if (action === 'claimNext' && !boss && perms.claimLimit > 0 && mine.size >= perms.claimLimit) return NextResponse.json({ ok: false, message: `You’re already packing ${mine.size} at once, as many as your role holds. Finish or put one back first.` }, { status: 409 });
        if (action === 'claimNext') { const n = Math.floor(Number(b.maxOrders) || 0); out = await F.claimNextBatch(db, tenantId, actor, n > 0 ? Math.min(12, n) : undefined, b.policy && typeof b.policy === 'object' ? b.policy : undefined); break; }
        const m = need1(orderId, 'order'); if (m) return m; out = await F.claimSpecificOrder(db, tenantId, orderId, actor); break;
      }
      case 'takeOver': { const m = need1(orderId, 'order'); if (m) return m; out = await F.takeOverOrder(db, tenantId, orderId, actor); break; }
      case 'releaseBatch': {
        const id = safeId(b.batchId); const m = need1(id, 'batch'); if (m) return m;
        const snap = await db.doc(`tenants/${tenantId}/fulfillmentBatches/${id}`).get();
        if (!snap.exists) { out = { ok: true, message: 'Put back in the queue' }; break; }
        const batch: any = { ...(snap.data() || {}), id };
        // Someone else's batch is put back only by a manager.
        if (batch.assignedTo && batch.assignedTo !== actor.id && batch.assignedTo !== String(a.authUid || '') && !perms.canManage && !boss) return NextResponse.json({ ok: false, message: 'Someone else is packing that. A manager can put it back.' }, { status: 403 });
        await F.releaseBatch(db, tenantId, batch, 'manual', actor); touchedIds.push(...(batch.orderIds || [])); out = { ok: true, message: 'Put back in the queue' }; break;
      }
      case 'sweepStale': out = { ok: true, released: await F.sweepStaleClaims(db, tenantId) }; break;
      case 'scanItem': { const m = need1(orderId, 'order'); if (m) return m; out = await F.recordItemScan(db, tenantId, orderId, s(b.value, 200), actor); break; }
      case 'scanBox': { const m = need1(orderId, 'order'); if (m) return m; out = await F.recordBoxScan(db, tenantId, orderId, s(b.value, 200), actor, { secondScan: b.secondScan === true }); break; }
      case 'scanPack': { const m = need1(orderId, 'order'); if (m) return m; out = await F.recordPackScan(db, tenantId, orderId, s(b.value, 200), actor); break; }
      case 'tapLine': { const m = need1(orderId, 'order') || need1(lineId, 'item'); if (m) return m; out = await F.recordLineTap(db, tenantId, orderId, lineId, actor); break; }
      case 'undoCount': { const m = need1(orderId, 'order') || need1(lineId, 'item'); if (m) return m; out = await F.undoLineCount(db, tenantId, orderId, lineId, actor, b.what === 'box' || b.what === 'check' ? b.what : 'scan'); break; }
      case 'shortLine': { const m = need1(orderId, 'order') || need1(lineId, 'item'); if (m) return m; out = await F.resolveShortLine(db, tenantId, orderId, lineId, s(b.reason, 200) || 'Not on the shelf', b.resolution === 'backorder' ? 'backorder' : 'refund', actor); break; }
      case 'reopenLine': { const m = need1(orderId, 'order') || need1(lineId, 'item'); if (m) return m; out = await F.reopenShortedLine(db, tenantId, orderId, lineId, actor); break; }
      case 'markPacked': { const m = need1(orderId, 'order'); if (m) return m; out = await F.markPacked(db, tenantId, orderId, actor, { requirePackScan: await secondScanOn(db, tenantId) }); break; }
      case 'markReady': {
        const m = need1(orderId, 'order'); if (m) return m;
        out = await F.markReady(db, tenantId, orderId, actor);
        // The customer is told it's ready, from here: a curbside customer not already outside by text (it starts their
        // trip), anyone else collecting by the ready email. Each route sends its message once per order.
        if (out?.ok) {
          const o: any = (await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get()).data() || {};
          if (o.method === 'curbside') { if (out.notifyReady) F.notifyCurbside(tenantId, orderId, 'ready'); }
          // A delivery isn't collected: its customer hears when it's on the way, not that it's ready to pick up.
          else if (o.method !== 'ship' && o.method !== 'delivery') sendMessage('order_ready', { orderId });
        }
        break;
      }
      case 'bringingOut': { const m = need1(orderId, 'order'); if (m) return m; out = await F.markBringingOut(db, tenantId, orderId, actor, await photoOf(db, tenantId, actor.id)); if (out?.ok && !/already/.test(out.message || '')) F.notifyCurbside(tenantId, orderId, 'out'); delete out?.notify; break; }
      case 'handoffScan': out = await F.handoffByScan(db, tenantId, s(b.value, 300), actor, { orderId: orderId || undefined }); break;
      case 'handoffPin': { const m = need1(orderId, 'order'); if (m) return m; out = await F.handoffByPin(db, tenantId, orderId, s(b.pin, 12), actor); break; }
      // Local delivery (lib/delivery-run): each step the customer hears about queues its message, once per try.
      case 'deliveryOut': {
        const m = need1(orderId, 'order'); if (m) return m;
        // When the shop names its drivers (lib/delivery-plan), only they (or a manager) take a delivery out.
        if (!boss) {
          const drivers = deliveryFrom(((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.retailSettings).drivers;
          if (drivers.length && !drivers.includes(actor.id)) return NextResponse.json({ ok: false, message: 'Only the shop’s drivers take deliveries out. A manager can add you under Delivery.' }, { status: 403 });
        }
        // The customer was choosing another try on their order page and left its payment page open (lib/delivery-retry-
        // server): a page just opened is theirs to finish; one left a few minutes is closed, so it goes out now. Paid in
        // the meantime, the try they paid for stands, in the time they chose.
        {
          const pre: any = (await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get()).data() || {};
          const rp = pre.delivery?.retryPay;
          if (rp?.status === 'awaiting_payment' && canChoose(pre)) {
            const who = String(pre.customerName || 'The customer').split(' ')[0];
            const age = Date.now() - (Date.parse(String(rp.at || '')) || 0);
            if (age < PAY_GRACE_MS) return NextResponse.json({ ok: false, message: `${who} is paying for another try right now. Give it a few minutes, then send it out.` }, { status: 409 });
            const { cancelRetryPay } = await import('@/lib/delivery-retry-server');
            const c = await cancelRetryPay(db, tenantId, orderId);
            if (c.result === 'applied') return NextResponse.json({ ok: false, message: `${who} just paid for another try${rp.window?.label ? ` ${whenInSentence(String(rp.window.label))}` : ''}. Take it out then.` }, { status: 409 });
            if (c.result === 'pending') return NextResponse.json({ ok: false, message: `${who}’s payment page couldn’t be closed just now. Try again in a minute.` }, { status: 409 });
          }
        }
        out = await F.markOutForDelivery(db, tenantId, orderId, actor);
        if (out?.ok && out.tries && !/^Already/.test(out.message || '')) sendMessage('delivery_out', { orderId, key: `t${out.tries}` });
        if (out?.ok) refreshRoute(db, tenantId, orderId);
        break;
      }
      case 'deliveryDone': {
        const m = need1(orderId, 'order'); if (m) return m;
        // Only a manager marks it delivered without the proof the shop asks for (from the back office).
        out = await F.markDelivered(db, tenantId, orderId, actor, { photoUrl: s(b.photoUrl, 1200) || null, left: b.left === true, where: s(b.where, 120), pin: s(b.pin, 12), override: b.override === true && boss, manager: boss });
        if (out?.ok && !/^Already/.test(out.message || '')) sendMessage('delivery_done', { orderId });
        if (out?.ok) refreshRoute(db, tenantId, orderId);
        break;
      }
      case 'deliveryFailed': {
        const m = need1(orderId, 'order'); if (m) return m;
        const code = failReason(b.code)?.code || null;
        out = await F.markDeliveryFailed(db, tenantId, orderId, actor, s(b.reason, 140), code, boss);
        if (out?.ok && out.tries) sendMessage('delivery_failed', { orderId, key: `t${out.tries}` });
        if (out?.ok) refreshRoute(db, tenantId, orderId);
        break;
      }
      case 'deliveryDoor': {
        const m = need1(orderId, 'order'); if (m) return m;
        const r = failReason(b.code); if (!r) return NextResponse.json({ ok: false, message: 'Choose what happened.' }, { status: 400 });
        out = await F.markAtDoor(db, tenantId, orderId, actor, r.code);
        if (out?.ok && out.first && out.tries) sendMessage('delivery_door', { orderId, key: `t${out.tries}` });
        break;
      }
      case 'deliverySkip': { const m = need1(orderId, 'order'); if (m) return m; out = await F.markDeliverySkip(db, tenantId, orderId, actor); if (out?.ok) refreshRoute(db, tenantId, orderId); break; }
      case 'handoffNoScan': { const m = need1(orderId, 'order'); if (m) return m; out = await F.handoffWithoutScan(db, tenantId, orderId, s(b.verifiedBy, 140) || 'Checked name and phone', actor); break; }
      case 'splitReady': { const m = need1(orderId, 'order'); if (m) return m; out = await F.splitReadyFromWaiting(db, tenantId, orderId, actor); break; }
      case 'releaseBackorder': { const m = need1(orderId, 'order'); if (m) return m; out = await F.releaseBackorder(db, tenantId, orderId, actor, { onlyIfCovered: b.onlyIfCovered !== false }); break; }
      case 'releaseCovered': {
        const received = (Array.isArray(b.received) ? b.received : []).slice(0, 200).map((r: any) => ({ productId: safeId(r?.productId), qty: Math.max(0, Math.floor(Number(r?.qty) || 0)) })).filter((r: any) => r.productId && r.qty > 0);
        out = received.length ? await F.releaseCoverableBackorders(db, tenantId, received, actor) : { released: [] }; break;
      }
      case 'waveStatus': {
        const id = safeId(b.waveId); const m = need1(id, 'wave'); if (m) return m;
        const st = ['picking', 'packing', 'done', 'cancelled'].includes(b.status) ? b.status : '';
        if (!st) return NextResponse.json({ ok: false, message: 'Which way should the wave go?' }, { status: 400 });
        await setWaveStatus(db, tenantId, id, st, actor);
        { const w = (await db.doc(`tenants/${tenantId}/waves/${id}`).get()).data() || {}; touchedIds.push(...(Array.isArray(w.orders) ? w.orders.map((x: any) => String(x?.orderId || '')) : [])); }
        out = { ok: true }; break;
      }
      case 'markShipped': {
        const m = need1(orderId, 'order'); if (m) return m;
        const t = b.tracking && typeof b.tracking === 'object' ? b.tracking : {};
        out = await F.markShipped(db, tenantId, orderId, { carrier: s(t.carrier, 60) || undefined, number: s(t.number, 80) || undefined, url: s(t.url, 500) || undefined, extraNumbers: Array.isArray(t.extraNumbers) ? t.extraNumbers.slice(0, 20).map((x: any) => s(x, 80)).filter(Boolean) : undefined }, actor);
        // Tracking typed in from a label bought elsewhere: the carrier won't tell the customer, so the shop does. A label
        // bought in the app is announced by the carrier's first scan instead (api/retail/shippo-webhook).
        if (out?.ok) { const o: any = (await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get()).data() || {}; if (o.trackingNumber && !o.shippoTransactionId) sendMessage('order_shipped', { orderId }); }
        break;
      }
      case 'cancel': { const m = need1(orderId, 'order'); if (m) return m; out = await F.cancelOrder(db, tenantId, orderId, actor, s(b.reason, 300) || undefined); break; }
      case 'openReturn': {
        // A return opened at the desk: the order as it's saved, and what comes back worked out here (lib/retail-returns),
        // never sent by the screen.
        const m = need1(orderId, 'order'); if (m) return m;
        const os = await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get();
        if (!os.exists) return NextResponse.json({ ok: false, message: 'That order isn’t there any more.' }, { status: 404 });
        const order: any = { ...(os.data() || {}), id: orderId };
        if (!['shipped', 'completed'].includes(String(order.stage))) return NextResponse.json({ ok: false, message: `Order #${order.orderNumber} hasn’t gone out yet, so there’s nothing to return.` }, { status: 409 });
        const reasons = new Set<string>(RETURN_REASONS as readonly string[]);
        const selections = (Array.isArray(b.selections) ? b.selections : []).slice(0, 50)
          .map((x: any) => ({ lineId: safeId(x?.lineId), qty: Math.max(0, Math.floor(Number(x?.qty) || 0)), reason: reasons.has(String(x?.reason)) ? String(x.reason) : 'other' }))
          .filter((x: any) => x.lineId && x.qty > 0);
        const resolution = (RETURN_RESOLUTIONS as readonly string[]).includes(String(b.resolution)) ? String(b.resolution) : 'refund';
        out = await R.openReturn(db, tenantId, order, selections as any, resolution as any, s(b.notes, 500).trim(), actor);
        break;
      }
      case 'requestClaimInfo': {
        // Asking the customer for more about a report (a photo, the box): saved on the report here, in one step with what
        // it reads, and the customer is told from the queue (api/retail/claim-notify), so it's never lost. Only those who
        // can decide on a report write to the customer about it.
        const id = safeId(b.claimId); const m = need1(id, 'report'); if (m) return m;
        const text = s(b.text, 400).trim(); if (!text) return NextResponse.json({ ok: false, message: 'What should they send?' }, { status: 400 });
        const ref = db.doc(`tenants/${tenantId}/retailClaims/${id}`);
        const at = new Date().toISOString();
        const asked = await db.runTransaction(async (tx: any) => {
          const cs = await tx.get(ref);
          if (!cs.exists) return { status: 404, message: 'That report isn’t there any more.' };
          const was: any = cs.data() || {};
          if (['resolved', 'auto_resolved', 'declined', 'closed'].includes(String(was.status || ''))) return { status: 409, message: 'That report has been decided already.' };
          // A new question starts a new wait: the last one and its answer go into the report's history (kept, never
          // overwritten), so the report waits under Waiting on them until they answer this one.
          const hist = Array.isArray(was.infoHistory) ? was.infoHistory.slice(-9) : [];
          if (was.infoRequestText) hist.push({ asked: s(was.infoRequestText, 400), askedAt: was.infoRequestAt || null, by: was.infoRequestBy || null, answer: was.infoResponseText ? s(was.infoResponseText, 600) : null, answeredAt: was.infoResponseAt || null });
          tx.update(ref, { infoRequestText: text, infoRequestAt: at, infoRequestBy: actor.name, infoResponseText: null, infoResponseAt: null, infoHistory: hist });
          return { status: 200, orderId: String(was.orderId || '') };
        });
        if (asked.status !== 200) return NextResponse.json({ ok: false, message: asked.message }, { status: asked.status });
        sendMessage('claim_info', { claimId: id, key: at });
        out = { ok: true, message: 'Asked. They see it on their order page.', orderId: asked.orderId };
        break;
      }
      case 'receiveReturnLine': case 'resolveReturn': {
        // The return as it's saved, never as the screen sent it.
        const id = safeId(b.returnId); const m = need1(id, 'return'); if (m) return m;
        const snap = await db.doc(`tenants/${tenantId}/retailReturns/${id}`).get();
        if (!snap.exists) return NextResponse.json({ ok: false, message: 'That return isn’t there any more.' }, { status: 404 });
        const ret: any = { ...(snap.data() || {}), id };
        touchedIds.push(String(ret.orderId || ''));
        if (action === 'resolveReturn') { out = await R.resolveReturn(db, tenantId, ret, actor); break; }
        // The condition it came back in is always said, never assumed (a faulty item put back on the shelf by default
        // would be sold again).
        if (!['restock', 'open_box', 'quarantine', 'damaged', 'dispose', 'write_off'].includes(b.disposition)) return NextResponse.json({ ok: false, message: 'Say what condition it came back in.' }, { status: 400 });
        const lm = need1(lineId, 'item'); if (lm) return lm;
        out = await R.receiveReturnLine(db, tenantId, ret, lineId, b.disposition, actor); break;
      }
      case 'trimReturn': {
        // Only part of a return came back: what did, counted by the screen, and whether the rest is still coming
        // (lib/retail-returns trimReturn works out the rest and its money from the return as it's saved).
        const id = safeId(b.returnId); const m = need1(id, 'return'); if (m) return m;
        const rest = b.rest === 'keep' || b.rest === 'drop' ? b.rest : '';
        if (!rest) return NextResponse.json({ ok: false, message: 'Say whether the rest is still coming.' }, { status: 400 });
        const received = (Array.isArray(b.received) ? b.received : []).slice(0, 50)
          .map((x: any) => ({ lineId: safeId(x?.lineId), qty: Math.max(0, Math.floor(Number(x?.qty) || 0)) })).filter((x: any) => x.lineId);
        out = await R.trimReturn(db, tenantId, id, received, rest, actor);
        if (out?.orderId) touchedIds.push(String(out.orderId));
        break;
      }
      case 'giveCredit': {
        // Store credit for the trouble, on the order (lib/goodwill-credit): how much a person may give is worked out
        // there from who they are, and the customer gets their balance by email straight after.
        const m = need1(orderId, 'order'); if (m) return m;
        const { giveGoodwillCredit } = await import('@/lib/goodwill-credit');
        const r = await giveGoodwillCredit(db, tenantId, { orderId, cents: Number(b.cents), note: s(b.note, 300), key: s(b.key, 60), ticketId: safeId(b.ticketId) || null }, { id: actor.id, name: actor.name, boss });
        if (!r.ok) return NextResponse.json({ ok: false, message: r.message }, { status: r.status || 409 });
        touchedIds.push(orderId);
        const c = ctx();
        if (r.creditId && !r.already && c) after(async () => { try { await fetch(`${c.base}/api/retail/credit-notify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: c.auth }, body: JSON.stringify({ tenantId, creditId: r.creditId }) }); } catch (e: any) { console.warn('[fulfil] credit email', String(e?.message || e).slice(0, 160)); } });
        out = { ok: true, message: r.message, cents: r.cents, already: r.already === true };
        break;
      }
      case 'decideHold': {
        // An item held to check when it came back: what was found (lib/retail-returns decideHold).
        const id = safeId(b.returnId); const m = need1(id, 'return') || need1(lineId, 'item'); if (m) return m;
        if (!(R.HOLD_OUTCOMES as readonly string[]).includes(String(b.outcome))) return NextResponse.json({ ok: false, message: 'Say what you found.' }, { status: 400 });
        out = await R.decideHold(db, tenantId, id, lineId, b.outcome, actor, b.qty == null ? undefined : Math.max(0, Math.floor(Number(b.qty) || 0)));
        if (out?.orderId) touchedIds.push(String(out.orderId));
        break;
      }
      case 'decideClaim': {
        const id = safeId(b.claimId); const m = need1(id, 'report'); if (m) return m;
        // No amount: what it's worth. An amount given must be a real one above $0.00 (never read as $0, or as all of it).
        const given = b.cents !== null && b.cents !== undefined && b.cents !== '';
        const cents = given ? Number(b.cents) : null;
        if (b.approve === true && given && !(Number.isFinite(cents) && (cents as number) >= 1)) return NextResponse.json({ ok: false, message: 'Pick an amount above $0.00.' }, { status: 400 });
        // Put right with a refund (the default), by sending another, or with store credit (lib/claim-settle).
        const how = b.approve === true && ['replacement', 'store_credit'].includes(String(b.how)) ? String(b.how) as SettleHow : 'refund';
        if (how === 'refund') out = await decideClaim(db, tenantId, id, b.approve === true, { cents, declineWhy: s(b.declineWhy, 400), by: { id: actor.id, name: actor.name } });
        else {
          const r = await settleClaim(db, tenantId, id, how, { cents, by: { id: actor.id, name: actor.name, role: String(a.role || ''), isTenantOwner: a.isTenantOwner === true } });
          if (!r.ok) return NextResponse.json({ ok: false, message: r.message }, { status: r.status || 409 });
          out = r;
          if (r.replacementOrderId) touchedIds.push(r.replacementOrderId);
        }
        // The customer is told the decision (api/retail/claim-notify), once per decision.
        if (out?.ok) { const c: any = (await db.doc(`tenants/${tenantId}/retailClaims/${id}`).get()).data() || {}; sendMessage('claim_decided', { claimId: id, key: String(c.decidedAt || '') }); }
        // An approval is a loss: recorded here, after the answer, never from a screen (lib/claim-loss).
        if (out?.ok && b.approve === true) after(async () => { try { await recordClaimLoss(db, tenantId, id); } catch (e: any) { console.error('[fulfil] claim loss', id, String(e?.message || e).slice(0, 160)); } });
        break;
      }
    }
    // Someone else collected it: the customer is told who, and when (api/retail/collected-notify).
    if (out?.ok && out.collector && ['handoffScan', 'handoffPin', 'handoffNoScan'].includes(action)) sendMessage('order_collected', { orderId: safeId(out.orderId || orderId) });
    // The customer's order page changes as the step happens (lib/order-tracking): every order the step touched.
    if (out && out.ok !== false) {
      const touched = new Set<string>([orderId, out.orderId, out.childOrderId, ...(Array.isArray(out.orderIds) ? out.orderIds : []), ...(Array.isArray(out.released) ? out.released.map((x: any) => x?.orderId) : []), ...(Array.isArray(touchedIds) ? touchedIds : [])].map((x) => safeId(x)).filter(Boolean));
      for (const id of touched) after(async () => { await syncTracking(db, tenantId, id); });
    }
    // Every message the step queued is in the queue before it answers.
    await Promise.allSettled(ctx()?.queued || []);
    return NextResponse.json(out ?? { ok: false, message: 'That didn’t go through. Try again.' });
  } catch (e: any) {
    console.error('[fulfil]', action, String(e?.message || e).slice(0, 200));
    // A step that went through before something after it failed still tells the customer.
    await Promise.allSettled(ctx()?.queued || []);
    return NextResponse.json({ ok: false, message: 'That didn’t go through. Try again.' }, { status: 500 });
  }
}

/** The shop's second scan at packing (Orders settings), read here so a screen can't skip it. */
async function secondScanOn(db: any, tenantId: string): Promise<boolean> {
  const t = await db.doc(`tenants/${tenantId}`).get().catch(() => null);
  return (t?.data?.() || {})?.retailSettings?.requirePackScan === true;
}

/** The team member's photo for the "bringing it out" card, from their staff record. */
async function photoOf(db: any, tenantId: string, staffId: string): Promise<string | undefined> {
  const s1 = await db.doc(`tenants/${tenantId}/staff/${staffId}`).get().catch(() => null);
  const d = s1?.data?.() || {};
  return String(d.photoUrl || d.avatarUrl || d.imageUrl || '') || undefined;
}
