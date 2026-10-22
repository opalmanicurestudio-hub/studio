import { labelFormatOf, shippoFileType, withOrderRef } from '@/lib/label-format';
import { SHIP_DENIED, mayShip } from '@/lib/fulfilment-guard';
import { shippoKeyFor } from '@/lib/retail-secrets';
import { recordPostage } from '@/lib/postage';
import { addressKey, openRequest } from '@/lib/address-flow';
import { paidServiceRate } from '@/lib/paid-service';
import { groundFilter } from '@/lib/ground-only';
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { boxesOf, claimLabelBuy, labelsCol, newLabelRecord, noteBuyRates, releaseLabelBuy } from '@/lib/label-records';
import { labelKey, type RecordBox } from '@/lib/label-boxes';
import { STANDARD_BOX, boxFrom, itemsOz, parcelsFor, presetsOf, type PackBox, type Parcel } from '@/lib/ship-run';
import { boxesFrom, buyBoxes, isBoxRates, rateBoxes, rateIdsOf } from '@/lib/box-shipments';

import {
  insurableValueCents, insuredParcels, protectionFor, protectionPolicy,
} from '@/lib/shipment-protection';

// ─── /api/retail/shipping-labels-bulk ─────────────────────────────────────────
// POST { tenantId, orders: [{ orderId, qrToken }], preview? }
//
// One tap buys a label for EVERY packed ship order. Each order is priced for the boxes chosen at the bench (lib/ship-run;
// the shop's first saved size when none was chosen), the items' real weights shared across them plus each box's own
// weight, with the same signature and insurance rules the ship sheet applies, and the service the customer paid for
// (the cheapest when they chose plain shipping). An order in several boxes gets one label per box, each box on its own
// shipment (lib/box-shipments: USPS takes one box per shipment), exactly as the ship sheet buys it, and each label gets
// its record (lib/label-records) like any other.
//
// `preview: true` prices them and buys nothing: Ship today shows each service and how many, the boxes, the insurance
// and what it costs, the signatures and the total before anyone pays, and lists any order that can't get a label yet
// and why (an address change waiting, a service that isn't offered today, no rates).
//
// PNG_4x6 on purpose: the bulk flow ends at /print/labels, a stack of 4x6 pages. Auth is per-order link possession
// (qrToken), same bar as the single route; an order that fails is reported and skipped, never blocking the rest.
// Buying is one order after another (Shippo rate-limits bursts); a preview prices a few at a time. Each order is
// claimed before its label is bought, so an order someone is buying a label for on its own ship sheet is skipped, not
// bought twice, and the rates being bought go on the claim first, so a purchase cut off before its label is saved is
// found and voided the next time the order is claimed. No new order is started once BUDGET_MS has gone by: the rest
// come back as not tried, and the screen sends them again, so a run never stops part way through a purchase.

export const maxDuration = 300;
const BUDGET_MS = 100_000;
const SHIPPO_MS = 30_000;

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-bulk-labels';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

const ADDRESS_ASKED = 'The customer asked to change the address. Answer that on the order first.';

/** Why an order can't get a label from here right now, or null when it can. */
function notReady(order: any, qrToken: string): string | null {
  if (String(order.qrToken || '') !== qrToken) return 'Not authorized';
  if (order.stage !== 'packed') return `Not packed yet (${order.stage})`;
  if (openRequest(order)) return ADDRESS_ASKED;
  if (order.method !== 'ship' || !order.shippingAddress) return 'Not a ship order';
  return null;
}

type Rate = { id: string; provider: string; service: string; amountCents: number; insuranceFeeCents: number; boxCents: number[] };
type Plan = { parcels: Parcel[]; decision: ReturnType<typeof protectionFor>; rate: Rate; how: 'matched' | 'any'; shipmentId: string; weightOz: number };

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const started = Date.now();
  const tenantId = String(body.tenantId || '').trim();
  const preview = body.preview === true;
  const reqOrders: { orderId: string; qrToken: string }[] = (Array.isArray(body.orders) ? body.orders : [])
    .map((o: any) => ({ orderId: String(o?.orderId || '').trim(), qrToken: String(o?.qrToken || '').trim() }))
    .filter((o: any) => o.orderId && o.qrToken)
    .slice(0, 25);
  if (!tenantId || reqOrders.length === 0) {
    return NextResponse.json({ error: 'tenantId and at least one order are required' }, { status: 400 });
  }

  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!mayShip(auth.actor)) return NextResponse.json({ error: SHIP_DENIED }, { status: 403 });

  const db = getAdminDb();
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const tenant = tenantSnap.data() as any;
  const rs = tenant.retailSettings || {};
  const apiKey = await shippoKeyFor(db, tenantId, tenant);
  if (!apiKey) return NextResponse.json({ error: 'Shippo is not connected — add your API key in Shop Settings.' }, { status: 400 });
  const from = rs.shipFrom || {};
  if (!from.street1 || !from.city || !from.state || !from.zip) {
    return NextResponse.json({ error: 'Ship-from address is incomplete — set it in Shop Settings.' }, { status: 400 });
  }
  const addressFrom = {
    name: from.name || String(tenant.businessName || tenant.name || 'Shop'),
    street1: from.street1, street2: from.street2 || '',
    city: from.city, state: from.state, zip: from.zip, country: 'US',
    phone: from.phone || '', email: from.email || '',
  };
  // The box when none was chosen at the bench: the shop's first saved size, else what the screen sent, else standard.
  const presets = presetsOf(rs);
  const pd = body.parcelDefaults || {};
  const fallback: PackBox = presets[0] ? boxFrom(presets[0])
    : Number(pd.lengthIn) > 0 ? { ...STANDARD_BOX, lengthIn: Number(pd.lengthIn), widthIn: Math.max(1, Number(pd.widthIn) || 8), heightIn: Math.max(1, Number(pd.heightIn) || 4), weightOz: Math.max(0, Number(pd.boxWeightOz) || 3) }
    : STANDARD_BOX;

  // Load every order first, then every distinct product's weight in one pass.
  const orderSnaps = await Promise.all(
    reqOrders.map((o) => db.collection(`tenants/${tenantId}/retailOrders`).doc(o.orderId).get())
  );
  const productIds = new Set<string>();
  orderSnaps.forEach((s: any) => {
    if (!s.exists) return;
    ((s.data() as any).lines || []).forEach((l: any) => { if (l.productId && l.digital !== true) productIds.add(String(l.productId)); });
  });
  const weightByProduct = new Map<string, number>();
  await Promise.all([...productIds].map(async (pid) => {
    try {
      const it = await db.collection(`tenants/${tenantId}/inventory`).doc(pid).get();
      if (it.exists) weightByProduct.set(pid, Number((it.data() as any).weightOz) || 0);
    } catch { /* falls back to the 4oz default */ }
  }));

  // Prices one order for its boxes, with its protection, and picks the service to buy.
  const planFor = async (order: any): Promise<Plan | { error: string }> => {
    const cust = order.shippingAddress;
    const addressTo = {
      name: cust.name || order.customerName || 'Customer',
      street1: cust.line1, street2: cust.line2 || '',
      city: cust.city, state: cust.state, zip: cust.postalCode || cust.zip, country: cust.country || 'US',
      phone: order.customerPhone || '', email: order.customerEmail || '',
    };
    const parcels = parcelsFor(order, itemsOz(order, (pid) => weightByProduct.get(pid) || 0), fallback);
    const decision = protectionFor(order, protectionPolicy(rs));
    // Several boxes: each is insured for its own share of the goods, never the whole value again.
    const insured = insuredParcels(decision, parcels.map((p) => ({ length: String(p.lengthIn), width: String(p.widthIn), height: String(p.heightIn), distance_unit: 'in', weight: String(p.weightOz), mass_unit: 'oz' })));
    const extra = withOrderRef(insured.extra, rs, order);
    // One shipment per box (lib/box-shipments): a service is offered when every box can go by it.
    const priced = await rateBoxes(apiKey, { from: addressFrom, to: addressTo, parcels: insured.parcels, extra, ms: SHIPPO_MS });
    const rates: Rate[] = groundFilter(priced.rates, order.groundOnly === true)
      .map((r: any) => ({ id: String(r.object_id || ''), provider: String(r.provider || ''), service: String(r.servicelevel?.name || ''), amountCents: Math.round(parseFloat(r.amount) * 100),
        // Shippo prices the insurance into the rate and says how much of it that is.
        insuranceFeeCents: Math.max(0, Math.round(parseFloat(r.included_insurance_price || '0') * 100) || 0),
        boxCents: Array.isArray(r.boxCents) ? r.boxCents : [] }))
      .filter((r: Rate) => r.id && Number.isFinite(r.amountCents) && r.amountCents > 0)
      .sort((a: Rate, b: Rate) => a.amountCents - b.amountCents);
    if (rates.length === 0) return { error: order.groundOnly ? 'Ground only, and no ground rate came back' : 'No rates came back. Check the address and the box size on its ship sheet.' };
    // The service the customer paid for at checkout (lib/paid-service); the cheapest only when they chose plain shipping.
    const paid = paidServiceRate(rates, order.shippingService, order.shippingCarrier);
    if (!paid.rate) return { error: `They paid for ${order.shippingService}, and it isn’t offered for this box today. Choose a service on its ship sheet.` };
    return { parcels, decision, rate: paid.rate, how: paid.how === 'matched' ? 'matched' : 'any', shipmentId: priced.shipmentIds[0] || '', weightOz: parcels.reduce((a, p) => a + p.weightOz, 0) };
  };

  // ── Preview: priced, nothing bought ──
  if (preview) {
    const plans: any[] = []; const left: { orderId: string; why: string }[] = [];
    const one = async (i: number) => {
      const { orderId, qrToken } = reqOrders[i];
      const snap = orderSnaps[i];
      try {
        if (!snap.exists) { left.push({ orderId, why: 'Order not found' }); return; }
        const order = snap.data() as any;
        if (order.trackingNumber || order.labelUrl) return;
        const why = notReady(order, qrToken);
        if (why) { left.push({ orderId, why }); return; }
        const p = await planFor(order);
        if ('error' in p) { left.push({ orderId, why: p.error }); return; }
        plans.push({ orderId, orderNumber: order.orderNumber ?? null, customerName: String(order.customerName || ''), carrier: p.rate.provider, service: p.rate.service, how: p.how,
          amountCents: p.rate.amountCents, insuranceFeeCents: p.decision.insuranceCents > 0 ? p.rate.insuranceFeeCents : 0, insuredCents: p.decision.insuranceCents, signature: p.decision.signature, boxes: p.parcels.length });
      } catch (e: any) { left.push({ orderId, why: String(e?.message || 'Couldn’t price it').replace(/^Shippo:\s*/, 'Shippo said: ').slice(0, 200) }); }
    };
    // A few at a time: quick, without a burst Shippo would turn away.
    for (let i = 0; i < reqOrders.length; i += 4) await Promise.all(reqOrders.slice(i, i + 4).map((_, k) => one(i + k)));
    const order = new Map(reqOrders.map((o, i) => [o.orderId, i]));
    plans.sort((a, b) => (order.get(a.orderId) ?? 0) - (order.get(b.orderId) ?? 0));
    return NextResponse.json({ ok: true, preview: true, plans, left });
  }

  // ── Buy ──
  const results: any[] = [];
  const notTried: string[] = [];
  const by = { id: auth.actor.uid, name: auth.actor.name };
  for (let i = 0; i < reqOrders.length; i++) {
    const { orderId, qrToken } = reqOrders[i];
    // Out of time for another purchase: the rest go back to the screen to send again.
    if (Date.now() - started > BUDGET_MS) { notTried.push(...reqOrders.slice(i).map((o) => o.orderId)); break; }
    // Read again here, not from the list loaded at the start: buying labels one after another takes a while, and an
    // address can change in the meantime.
    const snap = await db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get();
    const fail = (error: string) => results.push({ orderId, ok: false, error });
    try {
      if (!snap.exists) { fail('Order not found'); continue; }
      const order = snap.data() as any;
      if (String(order.qrToken || '') !== qrToken) { fail('Not authorized'); continue; }
      if (order.trackingNumber || order.labelUrl) {
        results.push({ orderId, ok: true, skipped: true, labelUrl: order.labelUrl || '', trackingNumber: order.trackingNumber || '', message: 'Already has a label' });
        continue;
      }
      const why = notReady(order, qrToken);
      if (why) { fail(why); continue; }
      // Claimed, and checked again as the order is now: a label bought on its own ship sheet a moment ago is seen here.
      const claim = await claimLabelBuy(db, snap.ref, auth.actor.name, Date.now(), (cur) => (cur.trackingNumber || cur.labelUrl ? 'It got a label meanwhile' : openRequest(cur) ? ADDRESS_ASKED : null));
      if ('error' in claim) {
        if (/label meanwhile/.test(claim.error)) { results.push({ orderId, ok: true, skipped: true, message: 'Already has a label' }); continue; }
        fail(claim.error); continue;
      }
      const token = claim.token;
      let doubtful: string[] = [];
      try {
        // An earlier purchase for this order that was cut off may have bought a label nobody saved: voided first. One
        // Shippo is still making (or couldn't be asked about) holds this order back until it's settled.
        const earlier = claim.doubt.length ? await (await import('@/lib/label-void')).settleDoubtfulBuy(db, tenantId, apiKey, snap.ref, orderId, order, claim.doubt, by).catch(() => ({ note: '', wait: true })) : { note: '', wait: false };
        if (earlier.wait) { fail(`${earlier.note ? `${earlier.note} ` : ''}A label from an earlier try is still being made, or Shippo couldn’t be asked about it. Try again in a minute.`); continue; }
        const plan = await planFor(order);
        if ('error' in plan) { fail(plan.error); continue; }
        const { rate, decision, parcels } = plan;
        const rateIds = rateIdsOf(rate.id);
        if (!(await noteBuyRates(db, snap.ref, token, rateIds))) { fail('That didn’t go through, so nothing was bought. Try again in a minute.'); continue; }
        const got = await buyBoxes(apiKey, rate.id, shippoFileType(labelFormatOf(rs), { stack: true }), SHIPPO_MS);
        if (!got.ok) {
          if (got.unanswered) doubtful = rateIds.slice(got.bought.length, got.bought.length + 1);
          let undone = '';
          if (got.bought.length) {
            // Boxes bought before one that didn't go through are voided straight away (kept on record, refunds followed).
            const part = boxesFrom(got.bought, parcels, rate.boxCents);
            const { voidUnsavedLabel, unsavedNote } = await import('@/lib/label-void');
            const v = await voidUnsavedLabel(db, tenantId, apiKey, { orderId, order, boxes: part, cents: part.reduce((a, b) => a + (Number(b.cents) || 0), 0), carrier: rate.provider, service: rate.service, rateId: rateIds[0], rateIds: rateIds.slice(0, part.length), by, how: 'bulk', why: 'voided straight away: another box’s label didn’t go through' }).catch(() => null);
            undone = ` The ${part.length === 1 ? 'box' : `${part.length} boxes`} already bought: ${unsavedNote(v, part[0].tracking)}.`;
          }
          fail(`${got.error || 'Label purchase failed'}${undone}`);
          continue;
        }
        const txn = got.txns[0];
        // Each box on its own shipment, or one box; a rate for several boxes on one shipment (UPS and FedEx can) has
        // its other labels found through it.
        const boxes: RecordBox[] = isBoxRates(rate.id) || parcels.length <= 1
          ? boxesFrom(got.txns, parcels, rate.boxCents.length ? rate.boxCents : [rate.amountCents])
          : await boxesOf(apiKey, txn, rate.id, parcels, plan.shipmentId);
        if (boxes.length !== parcels.length) console.warn('[shipping-labels-bulk] boxes bought', tenantId, orderId, boxes.length, 'of', parcels.length);
        const labelId = labelKey(boxes[0].txn);
        const carrier = String(txn.rate?.provider || rate.provider || 'Carrier');

        const now = new Date().toISOString();
        const orderRef = snap.ref;
        const evRef = orderRef.collection('events').doc();
        const boughtFor = addressKey(order.shippingAddress);
        const save = async (tx: any) => {
          const cur: any = (await tx.get(orderRef)).data() || {};
          // Still this run's to save: a claim taken over meanwhile means someone else has the order now.
          if (addressKey(cur.shippingAddress) !== boughtFor || openRequest(cur) || (cur.shippoTransactionId && cur.labelUrl) || cur.labelBuying?.token !== token) return false;
          tx.set(db.doc(`${labelsCol(tenantId)}/${labelId}`), newLabelRecord({
            id: labelId, order: cur, orderId, carrier, service: rate.service, rateId: rateIds[0], rateIds,
            boxes, amountCents: rate.amountCents,
            // What the insurance cost, as Shippo priced it into the rate.
            protection: { signature: decision.signature, insuranceCents: decision.insuranceCents, feeCents: decision.insuranceCents > 0 ? rate.insuranceFeeCents : 0 },
            at: now, by, how: 'bulk',
          }));
          tx.set(orderRef, {
            shipmentProtection: {
              signature: decision.signature,
              insuranceCents: decision.insuranceCents,
              insurableValueCents: insurableValueCents(order),
              expectedWeightOz: plan.weightOz,
              decidedAt: now,
            },
            trackingNumber: boxes[0].tracking, carrier, trackingUrl: boxes[0].trackingUrl, labelUrl: boxes[0].labelUrl, shippoTransactionId: boxes[0].txn,
            extraLabelUrls: boxes.slice(1).map((b) => b.labelUrl), extraTrackingNumbers: boxes.slice(1).map((b) => b.tracking), extraTrackingUrls: boxes.slice(1).map((b) => b.trackingUrl),
            packageCount: boxes.length,
            labelsChecked: [], labelCheckedAt: null,
            labelTxns: boxes.map((b) => b.txn), labelRecs: boxes.map(() => labelId), labelVoidIds: [], relabelOpen: false,
          }, { merge: true });
          tx.set(evRef, {
            id: evRef.id, type: 'label_generated', at: now,
            actorId: 'shippo', actorName: 'Shippo',
            meta: {
              carrier, trackingNumber: boxes[0].tracking, packages: boxes.length, labelId,
              signature: decision.signature, insuranceCents: decision.insuranceCents, expectedWeightOz: plan.weightOz,
              text: `Bulk purchase — ${plan.how === 'matched' ? 'the service they paid for' : 'cheapest rate'} (${rate.provider} ${rate.service}, $${(rate.amountCents / 100).toFixed(2)})${boxes.length > 1 ? ` · ${boxes.length} boxes` : ''}${decision.reasons.length ? ' · ' + decision.reasons.join(' · ') : ''}`,
            },
          });
          return true;
        };
        // A save the database didn't answer may have gone through all the same: the order says which.
        let saved: boolean | null;
        try { saved = await db.runTransaction(save); }
        catch (e: any) {
          const { carriesLabel } = await import('@/lib/label-void');
          saved = await carriesLabel(orderRef, boxes[0].txn);
          if (saved === null) {
            // Saved or not, it was bought: its postage goes into the books (once), and the person checks the order. Its
            // rates stay on the order: if the label isn't on it, the next purchase voids it before buying another.
            await recordPostage(db, tenantId, { id: orderId, orderNumber: order.orderNumber }, labelId, rate.amountCents, carrier);
            doubtful = rateIds;
            console.error('[shipping-labels-bulk] bought, save unknown', tenantId, orderId, boxes[0].txn, String(e?.message || e).slice(0, 200));
            const end = boxes[0].tracking.slice(-4);
            fail(`The label was bought${end ? ` (tracking ending ${end})` : ''}, but saving it to the order didn’t go through. Open the order: if that label isn’t on it, buying again voids it first.`);
            continue;
          }
        }
        if (!saved) {
          // The address changed (or a change came in) while this label was being bought: give it straight back.
          const { voidUnsavedLabel, unsavedNote } = await import('@/lib/label-void');
          const v = await voidUnsavedLabel(db, tenantId, apiKey, { orderId, order, boxes, cents: rate.amountCents, carrier, service: rate.service, rateId: rateIds[0], rateIds, by, how: 'bulk' }).catch(() => null);
          fail(`The order changed while the label was being bought (the address, or another label), so ${unsavedNote(v, boxes[0].tracking)}. Buy it again from the order.`);
          continue;
        }
        await recordPostage(db, tenantId, { id: orderId, orderNumber: order.orderNumber }, labelId, rate.amountCents, carrier);

        results.push({ orderId, ok: true, labelUrl: boxes[0].labelUrl, trackingNumber: boxes[0].tracking, carrier, costCents: rate.amountCents, boxes: boxes.length, weightOz: plan.weightOz, ...(earlier.note ? { note: earlier.note } : {}) });
      } finally { await releaseLabelBuy(db, snap.ref, token, doubtful); }
    } catch (e: any) {
      fail(String(e?.message || 'Failed').replace(/^Shippo:\s*/, 'Shippo said: ').slice(0, 200));
    }
  }

  const bought = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  const spentCents = results.reduce((a, r) => a + (r.costCents || 0), 0);
  const boxes = results.filter((r) => r.ok && !r.skipped).reduce((a, r) => a + (Number(r.boxes) || 1), 0);
  return NextResponse.json({
    ok: true, results, bought, skipped, failed, spentCents, boxes, notTried,
    message: `${bought} order${bought === 1 ? '' : 's'} labeled${boxes > bought ? ` (${boxes} boxes)` : ''}, $${(spentCents / 100).toFixed(2)}${skipped ? `, ${skipped} already labeled` : ''}${failed ? `, ${failed} failed` : ''}${notTried.length ? `, ${notTried.length} still to go` : ''}.`,
  });
}
