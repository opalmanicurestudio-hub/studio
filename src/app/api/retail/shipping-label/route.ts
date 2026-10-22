import { labelFormatOf, shippoFileType, withOrderRef } from '@/lib/label-format';
import { SHIP_DENIED, mayShip } from '@/lib/fulfilment-guard';
import { shippoKeyFor } from '@/lib/retail-secrets';
import { recordPostage } from '@/lib/postage';
import { groundFilter } from '@/lib/ground-only';
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { addressKey, openRequest } from '@/lib/address-flow';
import { togetherKey } from '@/lib/ship-together';
import { boxesOf, claimLabelBuy, labelsCol, newLabelRecord, rateInfo, releaseLabelBuy } from '@/lib/label-records';
import { REPLACE_REASONS, VOID_REASONS, labelKey, labelSlots, reasonLine, recordOf, slotOfTxn, slotPatch, slotsKnown, type RecordBox } from '@/lib/label-boxes';
import { labelDoubt } from '@/lib/label-doubt';

import {
  insurableValueCents, insuredParcels, protectionFor, protectionPolicy,
} from '@/lib/shipment-protection';

// ─── /api/retail/shipping-label/route.ts ──────────────────────────────────────
// Shippo labels in the shape a human ships: see real rates, pick one, buy, and undo or replace one that hasn't
// shipped. Every label bought gets a record (lib/label-records) with every box's label, what it cost and who bought
// it; a replacement names the label it replaced and why, and the refund for the old one is followed until Shippo
// confirms it.
//
//   POST { tenantId, orderId, qrToken, action: 'rates', parcels: [{ weightOz, lengthIn, widthIn, heightIn }], slot? }
//     → { rates: [{ id, provider, service, amountCents, days }] }. `slot`: rates for one box of several (its new
//       label), insured for that box's share.
//   POST { ..., action: 'purchase', rateId, parcels }
//     → the label, every box's. Saved on the order with the label record. Stage does NOT change: "Mark shipped"
//       stays the explicit truth moment.
//   POST { ..., action: 'replace', rateId, parcels, reason: { kind, note }, box? }
//     → voids the old label first (or just box `box`'s), then buys the new one and links the two. If the carrier has
//       already scanned the old label, it isn't voided and nothing new is bought.
//   POST { ..., action: 'box', slot, rateId, parcels } — a new label for a box whose label was voided.
//   POST { ..., action: 'drop_box', slot } — a box whose label was voided isn't going out after all.
//   POST { ..., action: 'void', reason? } — voids every box's label (lib/label-sweep voidIfUnused).
//   POST { ..., action: 'unscanned_ok' | 'voided_seen' | 'refund_seen' | 'charge_seen' } — someone has looked.
//
// One purchase at a time per order (lib/label-records claimLabelBuy): a double tap or a second device is told someone
// is already buying instead of buying a second label. Config: retailSettings.shippoApiKey (per tenant; SHIPPO_API_KEY
// env as a platform fallback) + retailSettings.shipFrom. qrToken is the same possession proof the print and support
// routes use, on top of a signed-in team member who may ship.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-shipping';
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

const SHIPPO = 'https://api.goshippo.com';
const GONE = ['shipped', 'handed_off', 'completed'];
const ACTIONS = ['rates', 'purchase', 'replace', 'box', 'drop_box', 'void', 'unscanned_ok', 'voided_seen', 'refund_seen', 'charge_seen'];

async function shippo(apiKey: string, path: string, payload: any) {
  const res = await fetch(`${SHIPPO}${path}`, {
    method: 'POST',
    headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail || data?.__all__?.[0] || JSON.stringify(data).slice(0, 200);
    throw new Error(`Shippo: ${detail}`);
  }
  return data;
}

const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const parcelsOf = (body: any) => (Array.isArray(body.parcels) && body.parcels.length > 0 ? body.parcels.slice(0, 10) : [body.parcel || {}]);
const slotOf = (v: unknown): number | null => { const n = Math.floor(Number(v)); return v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0 || n > 9 ? null : n; };

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  const action = String(body.action || '').trim();

  if (!tenantId || !orderId || !qrToken || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'tenantId, orderId, qrToken, and a valid action are required' }, { status: 400 });
  }

  const db = getAdminDb();
  const [tenantSnap, orderSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get(),
  ]);
  if (!tenantSnap.exists || !orderSnap.exists) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const tenant = tenantSnap.data() as any;
  const rs = tenant.retailSettings || {};
  const order = orderSnap.data() as any;
  const orderCol = db.collection(`tenants/${tenantId}/retailOrders`);
  const orderRef = orderCol.doc(orderId);

  if (order.qrToken !== qrToken) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  // Labels spend the shop's postage money: a signed-in team member only. The order's token alone is not enough;
  // it is on the customer's QR code and order link.
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!mayShip(auth.actor)) return NextResponse.json({ error: SHIP_DENIED }, { status: 403 });
  const actor = { id: auth.actor.uid, name: auth.actor.name };
  const now = () => new Date().toISOString();

  // Seen: the Needs you cards for a label (lib/label-sweep, lib/label-records) that someone has looked at.
  if (action === 'unscanned_ok') {
    const at = now();
    const w = String(order.labelUnscanned?.why || '');
    await orderRef.set({ labelUnscanned: { ...(order.labelUnscanned || {}), dismissedAt: at, dismissedBy: actor.name }, labelUnscannedOpen: false }, { merge: true });
    const ev = orderRef.collection('events').doc();
    const text = w === 'void_unfinished' ? 'Kept the label after a void of it didn’t finish' : w === 'void_refused' ? 'Left the label as it is (it couldn’t be voided automatically)' : 'Confirmed the box went out, though the carrier hasn’t scanned it yet';
    await ev.set({ id: ev.id, type: 'note', at, actorId: actor.id, actorName: actor.name, meta: { kind: 'label_unscanned_ok', text } });
    return NextResponse.json({ ok: true, message: w ? 'Noted.' : 'Noted. If it still isn’t scanned in a few days, check with the carrier.' });
  }
  if (action === 'voided_seen') {
    await orderRef.set({ voidedLabelMoving: { ...(order.voidedLabelMoving || {}), open: false, seenAt: now(), seenBy: actor.name } }, { merge: true });
    return NextResponse.json({ ok: true, message: 'Noted.' });
  }
  if (action === 'refund_seen' || action === 'charge_seen') {
    const field = action === 'refund_seen' ? 'labelRefundDenied' : 'labelCharge';
    const flag = action === 'refund_seen' ? 'deniedOpen' : 'chargeOpen';
    const at = now();
    await orderRef.set({ [field]: { ...(order[field] || {}), open: false, seenAt: at, seenBy: actor.name } }, { merge: true });
    // Every label of the order with the same card open is seen too (the order's card names only the latest).
    const labelId = labelKey(order[field]?.labelId);
    const mine = await db.collection(labelsCol(tenantId)).where('orderIds', 'array-contains', orderId).limit(30).get().catch(() => null);
    const refs = [...(mine?.docs || []).filter((d: any) => d.data()?.[flag] === true).map((d: any) => d.ref), ...(labelId ? [db.doc(`${labelsCol(tenantId)}/${labelId}`)] : [])];
    for (const r of refs) await r.set({ [flag]: false, updatedAt: at }, { merge: true }).catch(() => {});
    return NextResponse.json({ ok: true, message: 'Noted.' });
  }

  const apiKey = await shippoKeyFor(db, tenantId, tenant);
  if (!apiKey) {
    return NextResponse.json({ error: 'Shippo is not connected — add your API key in Shop Settings.' }, { status: 400 });
  }

  // Orders going in the same box (lib/ship-together): the box carries all their goods, so it's insured for all of them.
  // A label already shared by orders in one box is priced and replaced for all of them too.
  const sharedIds: string[] = Array.isArray(order.shippedWithOrderIds) ? order.shippedWithOrderIds.map(String) : [];
  const withIds: string[] = [...new Set([...(Array.isArray(body.withOrderIds) ? body.withOrderIds : []).map(String), ...(['rates', 'replace'].includes(action) ? sharedIds : [])])]
    .filter((id: string) => id && id !== orderId).slice(0, 9);
  const together = withIds.length
    ? (await Promise.all(withIds.map((id) => orderCol.doc(id).get())))
        .filter((d: any) => d.exists).map((d: any) => d.data() as any)
        .filter((o: any) => String(o.customerEmail || '').trim().toLowerCase() === String(order.customerEmail || '').trim().toLowerCase())
    : [];
  const boxOrder = together.length ? { ...order, lines: [...(order.lines || []), ...together.flatMap((o: any) => o.lines || [])] } : order;

  try {
    if (action === 'void') {
      // A box that has gone out keeps its label: once the carrier has it, only the carrier's own options are left.
      if (GONE.includes(order.stage)) {
        return NextResponse.json({ error: 'This order already shipped — the label can’t be voided from here.' }, { status: 409 });
      }
      if (!String(order.shippoTransactionId || '').trim()) return NextResponse.json({ error: 'No purchased label is saved on this order.' }, { status: 400 });
      // Every box's label, checked against the carrier first (lib/label-sweep): by hand, refused only if the carrier has
      // scanned it, and a label shared by orders in one box comes off all of them; automatically (body.auto, from
      // cancelling), only when the carrier shows it unused, it's not on a USPS form and it isn't shared. Boxes that
      // voided are kept on the order if others didn't, so trying again finishes the job.
      const r0 = VOID_REASONS.find((x) => x.id === String(body.reason?.kind || ''));
      const note = String(body.reason?.note || '').trim().slice(0, 200);
      const said = r0 ? (r0.id === 'other' ? note || r0.title : note ? `${r0.title}: ${note}` : r0.title) : '';
      const why = body.auto === true ? 'the order was cancelled' : said ? `voided by hand (${lower(said)})` : 'voided by hand';
      const { voidIfUnused } = await import('@/lib/label-sweep');
      const r = await voidIfUnused(db, tenantId, orderRef, order, apiKey, why, actor, { byHand: body.auto !== true });
      if (!r.ok) return NextResponse.json({ error: r.error, refused: r.refused || null, busy: r.refused === 'busy' }, { status: 409 });
      return NextResponse.json({ ok: true, message: r.note || 'Label voided. The postage comes back once Shippo confirms the refund, usually within 2 weeks.' });
    }

    // A box whose label was voided isn't going out: it comes off the order, and the rest ship as they are. Found by its
    // label, under the same claim a purchase takes, so nothing else can move the boxes meanwhile.
    if (action === 'drop_box') {
      const slot = slotOf(body.slot);
      const txn = slot === null ? '' : labelSlots(order)[slot]?.txn || '';
      if (!txn) return NextResponse.json({ error: 'Choose the box.' }, { status: 400 });
      const claim = await claimLabelBuy(db, orderRef, actor.name, Date.now(), (cur) => relabelProblem(cur, txn));
      if ('error' in claim) return NextResponse.json({ error: claim.error, busy: claim.busy || false }, { status: 409 });
      try {
        const at = now();
        const out = await db.runTransaction(async (tx: any) => {
          const cur: any = (await tx.get(orderRef)).data() || {};
          const sibs = await sharedCopies(tx, orderCol, cur, orderId);
          const why = relabelProblem(cur, txn);
          if (why) return { error: why };
          const i = slotOfTxn(cur, txn);
          const patch = slotPatch(cur, i, null);
          if (!patch) return { error: 'The last box can’t come off. Void the label instead.' };
          tx.set(orderRef, patch, { merge: true });
          for (const c of sibs) tx.set(c.ref, copyOf({ ...cur, ...patch }), { merge: true });
          const ev = orderRef.collection('events').doc();
          tx.set(ev, { id: ev.id, type: 'note', at, actorId: actor.id, actorName: actor.name, meta: { kind: 'label_box_dropped', text: `Box ${i + 1} came off the order: it isn’t going out. Its label was already voided.` } });
          return { ok: true, box: i + 1 };
        });
        if (!out.ok) return NextResponse.json({ error: out.error }, { status: 409 });
        return NextResponse.json({ ok: true, message: `Box ${out.box} is off the order. The other boxes ship as they are.` });
      } finally { await releaseLabelBuy(db, orderRef, claim.token); }
    }

    const from = rs.shipFrom || {};
    if (!from.street1 || !from.city || !from.state || !from.zip) {
      return NextResponse.json({ error: 'Ship-from address is incomplete — set it in Shop Settings.' }, { status: 400 });
    }
    if (order.method !== 'ship' || !order.shippingAddress) {
      return NextResponse.json({ error: 'This is not a shipping order' }, { status: 400 });
    }

    const to = order.shippingAddress;
    const addressTo = {
      name: to.name, street1: to.line1, street2: to.line2 || '',
      city: to.city, state: to.state, zip: to.postalCode, country: to.country || 'US',
      phone: order.customerPhone || '', email: order.customerEmail || '',
    };
    const addressFrom = {
      name: from.name || tenant.businessName || tenant.name || 'Shop',
      street1: from.street1, street2: from.street2 || '',
      city: from.city, state: from.state, zip: from.zip, country: 'US',
      phone: from.phone || '',
    };

    if (action === 'rates') {
      // Accept a parcels ARRAY (multi-box B2B shipments) or the legacy
      // single `parcel`. Each box quotes and labels individually — one rate
      // covers the whole set.
      const parcels = parcelsOf(body).map((p: any) => ({
        length: String(Math.max(1, Number(p.lengthIn) || 10)),
        width: String(Math.max(1, Number(p.widthIn) || 8)),
        height: String(Math.max(1, Number(p.heightIn) || 4)),
        distance_unit: 'in',
        weight: String(Math.max(1, Number(p.weightOz) || 16)),
        mass_unit: 'oz',
      }));
      // Signature and insurance are priced by the carrier on the shipment, so
      // they are added HERE and not at purchase — otherwise staff would be
      // shown one price and charged another.
      const full = protectionFor(boxOrder, protectionPolicy(rs));
      // One box's new label, of several: insured for its share of the goods, never the whole value again.
      const boxes = labelSlots(order).length;
      const decision = slotOf(body.slot) !== null && boxes > 1 ? { ...full, insuranceCents: Math.round(full.insuranceCents / boxes) } : full;
      // Several boxes: each is insured for its own share of the goods, never the whole value again (lib/shipment-protection).
      const insured = insuredParcels(decision, parcels);
      const extra = withOrderRef(insured.extra, rs, order);

      const shipment = await shippo(apiKey, '/shipments/', {
        address_from: addressFrom, address_to: addressTo, parcels: insured.parcels, async: false,
        ...(extra ? { extra } : {}),
      });
      const rates = groundFilter(shipment.rates || [], order.groundOnly === true)
        .map((r: any) => ({
          id: r.object_id,
          provider: r.provider,
          service: r.servicelevel?.name || r.servicelevel?.token || '',
          amountCents: Math.round(parseFloat(r.amount) * 100),
          days: r.estimated_days ?? null,
        }))
        .filter((r: any) => Number.isFinite(r.amountCents))
        .sort((a: any, b: any) => a.amountCents - b.amountCents)
        .slice(0, 8);
      if (rates.length === 0) {
        return NextResponse.json({ error: order.groundOnly ? 'This order can only go by ground, and no ground rate came back. Check the address, or ship it another way.' : 'No rates returned — check the addresses and parcel size.' }, { status: 422 });
      }
      return NextResponse.json({
        rates, groundOnly: order.groundOnly === true,
        // The address these rates were priced for: buying must be for the same one (lib/address-flow).
        addressKey: addressKey(order.shippingAddress),
        // Surfaced so the ship dialog can say why a rate costs more than usual.
        protection: {
          signature: decision.signature,
          insuranceCents: decision.insuranceCents,
          reasons: decision.reasons,
        },
      });
    }

    // purchase, replace, box: never a label over one that's live, never for a closed order, never while the customer's
    // address change waits, and only for the address the rates were priced for.
    if (['cancelled', 'refunded', 'completed'].includes(String(order.stage))) return NextResponse.json({ error: `This order is ${order.stage}.` }, { status: 409 });
    if (openRequest(order)) return NextResponse.json({ error: 'The customer asked to change the address. Answer that on the order first, so the label goes to the right place.' }, { status: 409 });
    const boughtFor = addressKey(order.shippingAddress);
    if (body.addressKey && String(body.addressKey) !== boughtFor) return NextResponse.json({ error: 'The address changed since these rates came in. Get new rates and buy the label again.', addressChanged: true }, { status: 409 });
    const rateId = String(body.rateId || '').trim();
    if (!rateId) return NextResponse.json({ error: 'rateId is required' }, { status: 400 });
    const parcels = parcelsOf(body);
    const slot = action === 'box' ? slotOf(body.slot) : action === 'replace' ? slotOf(body.box) : null;

    // Never a second label over one that is still live (it could never be voided afterwards).
    const HAS_LABEL = 'This order already has a label. Replace it or void it to buy a new one.';
    if (action === 'purchase' && order.shippoTransactionId && order.labelUrl) return NextResponse.json({ error: HAS_LABEL }, { status: 409 });
    let reason: { kind: string; note: string } | null = null;
    if (action === 'replace') {
      reason = { kind: String(body.reason?.kind || ''), note: String(body.reason?.note || '').trim().slice(0, 300) };
      if (!REPLACE_REASONS.some((r) => r.id === reason!.kind)) return NextResponse.json({ error: 'Choose why the label is being replaced.' }, { status: 400 });
      if (reason.kind === 'other' && !reason.note) return NextResponse.json({ error: 'Add a note so the record says why.' }, { status: 400 });
      if (!order.shippoTransactionId) return NextResponse.json({ error: order.labelFromOrderId ? 'This label was bought with another order in the same box. Replace it on that order.' : 'There’s no label on this order to replace.' }, { status: 409 });
      if (GONE.includes(String(order.stage))) return NextResponse.json({ error: 'This order already shipped, so its label stays.' }, { status: 409 });
      if (slot !== null && (!slotsKnown(order) || !labelSlots(order)[slot] || labelSlots(order).length < 2)) return NextResponse.json({ error: 'Replace the whole label for this order.' }, { status: 409 });
      // One box's label is replaced only on a label that's otherwise sound (a void that didn't finish is sorted first).
      if (slot !== null && labelDoubt(order)) return NextResponse.json({ error: 'Sort out this order’s label on the ship sheet first.' }, { status: 409 });
    }
    // The box's label, by its Shippo label: positions move when a box comes off.
    const oldTxn = slot === null ? '' : labelSlots(order)[slot]?.txn || '';
    // The label records the old label was bought on: one, or several once a box has had its own new label. A whole
    // replacement replaces them all.
    const oldIds: string[] = action === 'purchase' ? [] : slot === null
      ? [...new Set(labelSlots(order).map((_, i) => recordOf(order, i)).filter(Boolean))]
      : [recordOf(order, slot)].filter(Boolean);
    if (action === 'box') {
      if (!oldTxn) return NextResponse.json({ error: 'Choose the box.' }, { status: 400 });
      const why = relabelProblem(order, oldTxn);
      if (why) return NextResponse.json({ error: why }, { status: 409 });
    }

    // Claimed for this purchase, and checked again on the order as it is now: a label someone else bought a moment ago,
    // or an address that changed, stops it here, before anything is bought.
    const sameLabel = (c: any) => String(c.shippoTransactionId || '') === String(order.shippoTransactionId || '') && JSON.stringify(c.labelTxns || []) === JSON.stringify(order.labelTxns || []) && JSON.stringify(c.labelVoidIds || []) === JSON.stringify(order.labelVoidIds || []);
    const claim = await claimLabelBuy(db, orderRef, actor.name, Date.now(), (c) => {
      if (addressKey(c.shippingAddress) !== boughtFor) return 'The address changed since these rates came in. Get new rates and buy the label again.';
      if (openRequest(c)) return 'The customer asked to change the address. Answer that on the order first, so the label goes to the right place.';
      if (action === 'purchase') return c.shippoTransactionId && c.labelUrl ? HAS_LABEL : null;
      if (action === 'box') return relabelProblem(c, oldTxn);
      return sameLabel(c) ? null : 'The label on this order changed meanwhile, so nothing was voided or bought. Open it again.';
    });
    if ('error' in claim) return NextResponse.json({ error: claim.error, busy: claim.busy || false, ...(/address changed/i.test(claim.error) ? { addressChanged: true } : {}) }, { status: 409 });
    const token = claim.token;
    try {
      const why = reason ? `replaced (${lower(reasonLine(reason))})` : '';
      // Replacing: the old label is voided first. If the carrier already has it, it isn't voided and nothing is bought.
      // A box's new label replaces its voided one; a replacement names the label it replaces.
      let replaces: { id: string; slot: number | null; ids?: string[] } | null = action === 'box' ? { id: recordOf(order, slot!), slot } : null;
      // Some boxes voided and Shippo said no to the rest: the new label is still bought, and the sheet says which postage
      // isn't coming back.
      let partialNote = '';
      if (action === 'replace') {
        const { voidBox, voidIfUnused } = await import('@/lib/label-sweep');
        replaces = { id: oldIds[0] || recordOf(order, slot ?? 0), slot, ...(oldIds.length > 1 ? { ids: oldIds } : {}) };
        // This purchase already holds the order's claim, so the void runs under it.
        const v: any = slot === null
          ? await voidIfUnused(db, tenantId, orderRef, order, apiKey, why, actor, { byHand: true, claimed: true })
          : await voidBox(db, tenantId, orderRef, order, slot, apiKey, why, actor);
        if (!v.ok) return NextResponse.json({ error: `${v.error || 'The old label couldn’t be voided.'}${/nothing new/i.test(String(v.error || '')) ? '' : ' Nothing new was bought.'}`, refused: v.refused || null }, { status: 409 });
        partialNote = String(v.note || '');
        const cur: any = (await orderRef.get()).data() || {};
        if (slot === null && cur.shippoTransactionId) return NextResponse.json({ error: 'A label is still on this order, so nothing new was bought. Open it again.' }, { status: 409 });
      }

      const txn = await shippo(apiKey, '/transactions/', { rate: rateId, label_file_type: shippoFileType(labelFormatOf(rs)), async: false }).catch((e: any) => ({ status: 'ERROR', messages: [{ text: String(e?.message || '').replace(/^Shippo:\s*/, '') }] }));
      if (txn.status !== 'SUCCESS') {
        const msg = (txn.messages || []).map((m: any) => m.text).filter(Boolean).join('; ') || 'Label purchase failed';
        if (action === 'replace') return NextResponse.json({ error: slot === null ? `The old label is voided, but the new one didn’t go through (${msg}). Choose a rate and buy it again.` : `Box ${slot + 1}’s old label is voided, but its new one didn’t go through (${msg}). Buy it again from here.`, voided: true }, { status: 422 });
        return NextResponse.json({ error: `Shippo: ${msg}` }, { status: 422 });
      }
      const info = await rateInfo(apiKey, rateId);
      const single = action === 'box' || (action === 'replace' && slot !== null);
      const boxes: RecordBox[] = single
        ? [{ txn: String(txn.object_id || ''), tracking: String(txn.tracking_number || ''), labelUrl: String(txn.label_url || ''), trackingUrl: String(txn.tracking_url_provider || ''), parcel: parcelOfBody(parcels[0]) }]
        : await boxesOf(apiKey, txn, rateId, parcels, info.shipment);
      const carrier = String(info.provider || body.provider || order.carrier || 'Carrier').slice(0, 40);
      // The rate's own price; the one the sheet showed if Shippo didn't say.
      const cents = info.cents || Math.max(0, Math.round(Number(body.amountCents) || 0));
      const id = labelKey(boxes[0].txn);
      const decision = protectionFor(boxOrder, protectionPolicy(rs));
      const expectedWeightOz = parcels.reduce((a: number, p: any) => a + (Number(p?.weightOz) || 0), 0);
      const how = action === 'purchase' ? 'single' : action === 'box' ? 'box' : 'replace';
      const at = now();

      // Every label this one replaces, so each is linked to it.
      const linked: string[] = replaces ? (replaces.ids?.length ? replaces.ids : [replaces.id]) : [];
      const save = async (tx: any) => {
        const c: any = (await tx.get(orderRef)).data() || {};
        const oldRefs = linked.map((rid) => db.doc(`${labelsCol(tenantId)}/${rid}`));
        const oldSnaps: any[] = await Promise.all(oldRefs.map((r) => tx.get(r)));
        // A replaced label shared by orders in one box goes back on all of them; one box's new label too.
        const sibIds = !single && action === 'replace' ? sharedIds : [];
        const sibSnaps = sibIds.length ? await Promise.all(sibIds.map((sid) => tx.get(orderCol.doc(sid)))) : [];
        const copies = single ? await sharedCopies(tx, orderCol, c, orderId) : [];
        if (addressKey(c.shippingAddress) !== boughtFor || openRequest(c)) return false;
        const okSibs = sibSnaps.filter((s: any) => {
          const o = s.exists ? s.data() : null;
          return o && ['packed', 'shipped'].includes(String(o.stage)) && !o.shippoTransactionId && !!togetherKey(c, { labelled: true }) && togetherKey(o, { labelled: true }) === togetherKey(c, { labelled: true });
        });
        const rec = newLabelRecord({
          id, order: c, orderId, carrier, service: info.service, rateId, boxes, amountCents: cents,
          protection: { signature: decision.signature, insuranceCents: decision.insuranceCents }, at, by: actor, how,
          replaces, reason,
          orderIds: single ? copies.map((cp: any) => cp.id) : okSibs.map((s: any) => s.id),
        });
        const ev = orderRef.collection('events').doc();
        if (single) {
          // One box's new label, in that box's place (found by its old label: positions move when a box comes off).
          const at0 = slotOfTxn(c, oldTxn); const s = labelSlots(c)[at0];
          if (!s || !s.voided) return false;
          const patch = slotPatch(c, at0, { txn: boxes[0].txn, tracking: boxes[0].tracking, labelUrl: boxes[0].labelUrl, trackingUrl: boxes[0].trackingUrl, record: id });
          if (!patch) return false;
          tx.set(orderRef, { ...patch, carrier: c.carrier || carrier }, { merge: true });
          for (const cp of copies) tx.set(cp.ref, copyOf({ ...c, ...patch, carrier: c.carrier || carrier }), { merge: true });
          tx.set(ev, { id: ev.id, type: 'label_generated', at, actorId: actor.id, actorName: actor.name, meta: { carrier, trackingNumber: boxes[0].tracking, packages: 1, box: at0 + 1, labelId: id,
            text: `New label for box ${at0 + 1} (${carrier} ${info.service}, $${(cents / 100).toFixed(2)})${reason ? `: ${reasonLine(reason)}` : ''}` } });
        } else {
          if (c.shippoTransactionId && c.labelUrl) return false;
          const fields = {
            shipmentProtection: { signature: decision.signature, insuranceCents: decision.insuranceCents, insurableValueCents: insurableValueCents(boxOrder), expectedWeightOz, decidedAt: at },
            trackingNumber: boxes[0].tracking, carrier, trackingUrl: boxes[0].trackingUrl, labelUrl: boxes[0].labelUrl, shippoTransactionId: boxes[0].txn,
            extraLabelUrls: boxes.slice(1).map((b) => b.labelUrl), extraTrackingNumbers: boxes.slice(1).map((b) => b.tracking), extraTrackingUrls: boxes.slice(1).map((b) => b.trackingUrl),
            packageCount: boxes.length, labelsChecked: [], labelCheckedAt: null,
            labelTxns: boxes.map((b) => b.txn), labelRecs: boxes.map(() => id), labelVoidIds: [], relabelOpen: false,
            ...(okSibs.length ? { shippedWithOrderIds: okSibs.map((s: any) => s.id), shipTogetherAt: at } : {}),
          };
          tx.set(orderRef, fields, { merge: true });
          for (const s of okSibs) tx.set(s.ref, { ...copyOf({ ...c, ...fields }), labelFromOrderId: orderId, shippedWithOrderId: orderId, shipTogetherAt: at }, { merge: true });
          tx.set(ev, { id: ev.id, type: 'label_generated', at, actorId: actor.id, actorName: actor.name, meta: {
            carrier, trackingNumber: boxes[0].tracking, packages: boxes.length, signature: decision.signature, insuranceCents: decision.insuranceCents, expectedWeightOz, labelId: id,
            text: reason ? `New label (${carrier} ${info.service}, $${(cents / 100).toFixed(2)}): ${reasonLine(reason)}` : decision.reasons.join(' · ') || 'No added protection on this shipment' } });
        }
        tx.set(db.doc(`${labelsCol(tenantId)}/${id}`), rec);
        oldSnaps.forEach((snap: any, k: number) => {
          if (!snap?.exists) return;
          const old: any = snap.data() || {};
          if (single) {
            const i = (old.boxTxns || []).indexOf(oldTxn);
            if (i >= 0) tx.set(oldRefs[k], { boxes: (old.boxes || []).map((b: any, j: number) => (j === i ? { ...b, replacedBy: id } : b)), updatedAt: at }, { merge: true });
          } else tx.set(oldRefs[k], { replacedBy: id, replacedAt: at, ...(reason ? { replacedWhy: reason } : {}), updatedAt: at }, { merge: true });
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
          // Saved or not, it was bought: its postage goes into the books (once), and the person checks the order.
          await recordPostage(db, tenantId, { id: orderId, orderNumber: order.orderNumber }, id, cents, carrier);
          console.error('[shipping-label] bought, save unknown', tenantId, orderId, boxes[0].txn, String(e?.message || e).slice(0, 200));
          const end = String(boxes[0].tracking || '').slice(-4);
          return NextResponse.json({ error: `The label was bought${end ? ` (tracking ending ${end})` : ''}, but saving it to the order didn’t go through. Open the order again: if that label isn’t on it, void it in Shippo before buying another.` }, { status: 503 });
        }
      }
      if (!saved) {
        // The address changed (or a change came in) while this one was being bought: it's voided straight away. It was
        // paid for, so it's kept like any label, with its refund followed until Shippo confirms it (lib/label-void).
        const { voidUnsavedLabel, unsavedNote } = await import('@/lib/label-void');
        const v = await voidUnsavedLabel(db, tenantId, apiKey, { orderId, order, boxes, cents, carrier, service: info.service, rateId, by: actor, how }).catch(() => null);
        return NextResponse.json({ error: `The order changed while the label was being bought (the address, or another label), so ${unsavedNote(v, boxes[0].tracking)}. Get new rates and buy it again.`, addressChanged: true }, { status: 409 });
      }
      // The postage is a real cost: into the books against this order (lib/postage).
      await recordPostage(db, tenantId, { id: orderId, orderNumber: order.orderNumber }, id, cents, carrier);
      let refundCents = 0;
      if (replaces) {
        // What's coming back: refunds asked for (or already confirmed) for the boxes replaced, not boxes Shippo wouldn't
        // void, nor a box of the same record voided before (it was replaced on its own then). Boxes bought before each
        // box's label was kept can't be told apart: everything on their record counts.
        const replacedTxns = new Set(slot === null ? labelSlots(order).map((s) => s.txn).filter(Boolean) : [oldTxn].filter(Boolean));
        const apart = slot !== null || slotsKnown(order);
        for (const rid of linked) {
          const old: any = (await db.doc(`${labelsCol(tenantId)}/${rid}`).get().catch(() => null))?.data?.() || {};
          refundCents += Object.entries(old.refunds || {}).filter(([t, r]: any) => (!apart || replacedTxns.has(t)) && ['requested', 'refunded'].includes(String(r?.status))).reduce((a, [, r]: any) => a + (Number(r?.cents) || 0), 0);
        }
      }
      return NextResponse.json({
        trackingNumber: boxes[0].tracking, carrier, trackingUrl: boxes[0].trackingUrl, labelUrl: boxes[0].labelUrl,
        extraLabelUrls: boxes.slice(1).map((b) => b.labelUrl), extraTrackingNumbers: boxes.slice(1).map((b) => b.tracking),
        packageCount: boxes.length, labelId: id, costCents: cents, service: info.service,
        boxes: boxes.map((b) => ({ tracking: b.tracking, labelUrl: b.labelUrl })),
        ...(replaces ? { replaced: { labelId: replaces.id, box: slot, refundCents, note: partialNote } } : {}),
        protection: { signature: decision.signature, insuranceCents: decision.insuranceCents, reasons: decision.reasons },
      });
    } finally {
      await releaseLabelBuy(db, orderRef, token);
    }
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || 'Shipping label request failed').slice(0, 300) }, { status: 502 });
  }
}

/** Why a box (by its Shippo label) can't get a new label or come off the order now, or nothing when it can: it must be a
 *  box whose label was voided, on a label with no void still under way (lib/label-doubt). */
function relabelProblem(cur: any, txn: string): string | null {
  const s = labelSlots(cur).find((x) => x.txn === txn);
  if (!s) return 'The boxes on this order changed meanwhile. Open it again.';
  if (!s.voided) return `Box ${s.slot + 1} already has a label.`;
  const d = labelDoubt(cur);
  if (d && d !== 'relabel') return 'A void of this label hasn’t finished. Void it again, or keep it, before any box gets a new label.';
  return null;
}

/** The size and weight a box was bought for, as the ship sheet sent it. */
function parcelOfBody(p: any) {
  const w = Number(p?.weightOz);
  return Number.isFinite(w) && w > 0 ? { lengthIn: Number(p?.lengthIn) || 0, widthIn: Number(p?.widthIn) || 0, heightIn: Number(p?.heightIn) || 0, weightOz: Math.round(w) } : null;
}

/** What an order in another order's box carries of that order's label (lib/ship-together). */
function copyOf(o: any) {
  return {
    trackingNumber: o.trackingNumber || null, carrier: o.carrier || null, trackingUrl: o.trackingUrl || null, labelUrl: o.labelUrl || null,
    extraLabelUrls: o.extraLabelUrls || [], extraTrackingNumbers: o.extraTrackingNumbers || [], extraTrackingUrls: o.extraTrackingUrls || [],
    packageCount: Number(o.packageCount) || 1, labelTxns: o.labelTxns || [], labelVoidIds: o.labelVoidIds || [],
    labelsChecked: o.labelsChecked || [], labelCheckedAt: o.labelCheckedAt || null,
  };
}

/** The orders in this order's box that carry a copy of its label, read in the transaction. */
async function sharedCopies(tx: any, col: any, cur: any, orderId: string): Promise<any[]> {
  const ids: string[] = Array.isArray(cur?.shippedWithOrderIds) ? cur.shippedWithOrderIds.map(String).filter(Boolean).slice(0, 9) : [];
  if (!ids.length) return [];
  const snaps = await Promise.all(ids.map((id) => tx.get(col.doc(id))));
  return snaps.filter((s: any) => s.exists && [s.data()?.labelFromOrderId, s.data()?.shippedWithOrderId].includes(orderId));
}
