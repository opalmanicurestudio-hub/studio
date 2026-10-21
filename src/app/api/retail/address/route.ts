// src/app/api/retail/address/route.ts — THE TEAM'S SIDE OF GETTING THE ADDRESS RIGHT (lib/address-flow). Team only.
//   ask_confirm     "Ask Dana to confirm": a text (or email) with the order page, where the customer taps "Yes, ship it
//                   here" or fixes it. Nothing waits on the answer; the label can still be bought.
//   approve_change  the change came in after the label: claimed first (one person acts), every box's label is voided
//                   (the postage comes back), then the voided label is cleared and the new address goes on in one write.
//                   An approval interrupted part way can simply be approved again. Held orders: managers only.
//   keep_old        the old address stays; the customer is told why on their order page.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { SHIP_DENIED, mayShip } from '@/lib/fulfilment-guard';
import { changePolicy, oneLine, openRequest } from '@/lib/address-flow';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';

export const dynamic = 'force-dynamic';

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const first = (n: unknown) => String(n || '').trim().split(/\s+/)[0] || 'the customer';
const PRE_SHIP = ['placed', 'paid', 'picking', 'packed'];

async function tell(db: any, tenantId: string, orderId: string, o: any, kind: string, subject: string, body: string, origin: string) {
  if (!o.customerEmail && !o.customerPhone) return;
  const { sendNotification } = await import('@/lib/notify');
  const brand = await getEmailBrand(db, tenantId);
  const link = `${origin}/shop/${tenantId}/order/${orderId}`;
  const html = brandedEmail(brand, `<p style="font-size:14px;color:#334155;line-height:1.6">${body}</p>${emailButton(link, 'Open my order', brand)}`,
    { title: subject, tag: `Order #${String(o.orderNumber ?? '').padStart(4, '0')}`, preheader: subject });
  await sendNotification(db, {
    tenantId, channel: o.customerEmail ? 'email' : 'sms', to: String(o.customerEmail || o.customerPhone), subject, html,
    text: `${subject} ${link}`, kind, recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null, orderId,
  } as any).catch(() => {});
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim(); const action = String(b.action || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Please sign in to continue.' }, { status: auth.status || 401 });
  const actor = auth.actor;
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const o: any = snap.data() || {};
  const now = new Date().toISOString();
  const who = first(o.customerName);
  const origin = req.nextUrl.origin;

  if (action === 'ask_confirm') {
    if (o.method !== 'ship' || !PRE_SHIP.includes(String(o.stage))) return NextResponse.json({ ok: false, error: 'This order has already gone out.' }, { status: 409 });
    if (!o.customerEmail && !o.customerPhone) return NextResponse.json({ ok: false, error: `There’s no email or phone number on this order to reach ${who}.` }, { status: 400 });
    const asked = o.addressConfirm?.status === 'waiting' ? Date.parse(String(o.addressConfirm.askedAt || '')) : NaN;
    if (Number.isFinite(asked) && Date.now() - asked < 12 * 3600e3) return NextResponse.json({ ok: true, message: `${who} was already asked. Their answer shows here when they tap.`, already: true });
    const ev = ref.collection('events').doc();
    const batch = db.batch();
    batch.set(ref, { addressConfirm: { status: 'waiting', askedAt: now, askedBy: actor.uid, askedByName: actor.name, address: o.shippingAddress || null } }, { merge: true });
    batch.set(ev, { id: ev.id, type: 'note', at: now, actorId: actor.uid, actorName: actor.name, meta: { kind: 'address_confirm_asked', text: `Asked ${who} to confirm the address` } });
    await batch.commit();
    const lines = [o.shippingAddress?.name, oneLine(o.shippingAddress)].filter(Boolean).map((x: string) => esc(x)).join('<br>');
    await tell(db, tenantId, orderId, o, 'address_confirm', 'Please check the address for your order before it ships',
      `Before we ship your order, please check that this is the right address:<br><br><strong>${lines}</strong><br><br>Tap “Yes, ship it here” on your order page, or fix it there. If there’s an apartment or unit number, add it so your order isn’t held up.`, origin);
    return NextResponse.json({ ok: true, message: `${who} has been asked. Their answer shows here as soon as they tap.` });
  }

  const req0 = openRequest(o);
  if (action === 'approve_change' || action === 'keep_old') {
    if (!req0 || req0.kind !== 'change') return NextResponse.json({ ok: false, error: 'There’s no address change waiting on this order.' }, { status: 409 });
    if (!PRE_SHIP.includes(String(o.stage))) return NextResponse.json({ ok: false, error: 'This order has already gone out, so its address can’t change now.' }, { status: 409 });
  }

  if (action === 'approve_change') {
    if (!mayShip(actor)) return NextResponse.json({ ok: false, error: SHIP_DENIED }, { status: 403 });
    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    if (o.holdForReview === true && changePolicy(t.retailSettings).heldNeedsManager && !actor.isManager) return NextResponse.json({ ok: false, error: 'This order is held for review, so a manager needs to approve the change.' }, { status: 403 });
    // Orders sharing one box and label (lib/ship-together) can't change address one at a time.
    const shared = [...(Array.isArray(o.shippedWithOrderIds) ? o.shippedWithOrderIds : []), ...(o.shippedWithOrderId ? [o.shippedWithOrderId] : [])];
    if (shared.length && (o.labelUrl || o.trackingNumber)) return NextResponse.json({ ok: false, error: `This order shares a box and label with another order, so its address can’t change on its own. Void the shared label on the ship sheet first (it comes off every order in the box), then approve the change. Or keep the old address and let ${who} know.` }, { status: 409 });
    // 1. Claim it, so two people answering at once can't both act. The order as it is at the claim is the one acted on.
    //    A claim left behind by an interrupted approval can be taken over after five minutes (well past the time the
    //    carrier calls below can take).
    const claim: any = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {}; const r = cur.addressRequest || {};
      const stale = r.status === 'approving' && Date.now() - Date.parse(String(r.claimedAt || '')) > 5 * 60e3;
      if (r.id !== req0.id || !(r.status === 'waiting' || stale)) return null;
      tx.set(ref, { addressRequest: { ...r, status: 'approving', claimedBy: actor.uid, claimedAt: now } }, { merge: true });
      return cur;
    });
    if (!claim) return NextResponse.json({ ok: false, error: 'Someone else already answered this.' }, { status: 409 });
    const mine = (r: any) => r?.id === req0.id && r?.status === 'approving' && r?.claimedBy === actor.uid;
    const { FieldValue } = await import('firebase-admin/firestore');

    // 2. Void every box's label. Boxes that voided are kept on the order if others didn't, and the claim is let go,
    //    so trying again picks up where it stopped (a label the carrier already refunded counts as voided).
    const labelTxn = String(claim.shippoTransactionId || '');
    let voided = 0; let tracking: string[] = [];
    if (labelTxn) {
      const { shippoKeyFor } = await import('@/lib/retail-secrets');
      const { voidOrderLabels } = await import('@/lib/label-void');
      const { labelState } = await import('@/lib/label-sweep');
      const key = await shippoKeyFor(db, tenantId, t);
      // A box the carrier has already scanned has gone out: its label stays, and so does the address.
      if ((await labelState(key, claim)) === 'moving') {
        await db.runTransaction(async (tx: any) => {
          const cur: any = (await tx.get(ref)).data() || {};
          if (!mine(cur.addressRequest)) return;
          tx.set(ref, { labelSeenMoving: now, addressRequest: { ...cur.addressRequest, status: 'waiting', claimedBy: null, claimedAt: null } }, { merge: true });
        }).catch(() => {});
        return NextResponse.json({ ok: false, error: `The carrier has already scanned this box, so its label can’t be voided. Keep the old address and let ${who} know it’s on its way.` }, { status: 409 });
      }
      const v = await voidOrderLabels(db, tenantId, claim, key, { alreadyVoided: Array.isArray(claim.labelVoidIds) ? claim.labelVoidIds : [] });
      if (!v.ok) {
        await db.runTransaction(async (tx: any) => {
          const cur: any = (await tx.get(ref)).data() || {};
          if (!mine(cur.addressRequest)) return;
          tx.set(ref, { ...(v.voidedIds.length ? { labelVoidIds: v.voidedIds } : {}), addressRequest: { ...cur.addressRequest, status: 'waiting', claimedBy: null, claimedAt: null } }, { merge: true });
        }).catch(() => {});
        return NextResponse.json({ ok: false, error: v.error }, { status: 502 });
      }
      voided = v.count; tracking = v.trackingNumbers;
    }

    // 3. Clear the voided label and put the new address on, in one write. If the claim was lost meanwhile, the voided
    //    label is still cleared (it can't ship), and the other person's approval finishes the change.
    const { LABEL_CLEARED } = await import('@/lib/label-void');
    const out = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      const sameLabel = !!labelTxn && String(cur.shippoTransactionId || '') === labelTxn;
      const cleared = sameLabel ? { ...LABEL_CLEARED, labelVoidedAt: now, ...(tracking.length ? { voidedTracking: FieldValue.arrayUnion(...tracking) } : {}) } : {};
      if (!mine(cur.addressRequest)) { if (sameLabel) tx.set(ref, cleared, { merge: true }); return { ok: false, error: 'Someone else already answered this.' }; }
      if (cur.shippoTransactionId && !sameLabel) {
        tx.set(ref, { addressRequest: { ...cur.addressRequest, status: 'waiting', claimedBy: null, claimedAt: null } }, { merge: true });
        return { ok: false, error: 'A different label is on this order now. Open it again and approve the change once more.' };
      }
      const hadLabel = !!labelTxn || !!(cur.labelUrl || cur.trackingNumber);
      tx.set(ref, {
        ...cleared,
        ...(!sameLabel && hadLabel ? { ...LABEL_CLEARED, labelVoidedAt: now } : {}),
        shippingAddress: req0.to, addressCheck: req0.check || null,
        addressChanged: { at: now, from: cur.shippingAddress || null, by: 'staff', after: hadLabel ? 'label' : String(cur.stage || '') },
        addressRequest: { ...cur.addressRequest, status: 'done', answeredAt: now, answeredBy: actor.uid, answeredByName: actor.name, claimedBy: null, claimedAt: null },
        ...(['waiting', 'confirmed'].includes(String(cur.addressConfirm?.status || '')) ? { addressConfirm: { ...cur.addressConfirm, status: 'fixed', answeredAt: now } } : {}),
      }, { merge: true });
      const ev = ref.collection('events').doc();
      tx.set(ev, { id: ev.id, type: 'address_updated', at: now, actorId: actor.uid, actorName: actor.name, meta: { from: cur.shippingAddress || null, to: req0.to, approved: true, ...(voided ? { labelsVoided: voided } : {}) } });
      return { ok: true };
    });
    if (!out.ok) return NextResponse.json(out, { status: 409 });
    await tell(db, tenantId, orderId, o, 'address_reply', 'Your new address is on your order',
      `We’ve changed the address on your order. It will ship to:<br><br><strong>${esc(oneLine(req0.to))}</strong>`, origin);
    return NextResponse.json({ ok: true, voided, message: voided ? `The old label${voided > 1 ? 's are' : ' is'} voided and the postage is on its way back. Buy the new label, then put it over the old one.` : `${who}’s new address is on the order.` });
  }

  if (action === 'keep_old') {
    const reason = String(b.reason || '').trim().slice(0, 300);
    const out = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      if (cur.addressRequest?.id === req0!.id && cur.addressRequest?.status === 'approving') return { ok: false, error: 'This change is being approved. If that was interrupted, approve it again to finish it.' };
      if (cur.addressRequest?.id !== req0!.id || cur.addressRequest?.status !== 'waiting') return { ok: false, error: 'Someone else already answered this.' };
      // Some box labels already voided by an approval that stopped part way: the rest must go too before it can ship.
      if (Array.isArray(cur.labelVoidIds) && cur.labelVoidIds.length && cur.shippoTransactionId) return { ok: false, error: 'Some of this order’s labels were already voided. Void the rest from the ship sheet first, then keep the old address.' };
      tx.set(ref, { addressRequest: { ...cur.addressRequest, status: 'kept', reply: reason || null, answeredAt: now, answeredBy: actor.uid, answeredByName: actor.name } }, { merge: true });
      const ev = ref.collection('events').doc();
      tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: actor.uid, actorName: actor.name, meta: { kind: 'address_change_kept', text: `Kept the original address${reason ? `: ${reason}` : ''}` } });
      return { ok: true };
    });
    if (!out.ok) return NextResponse.json(out, { status: 409 });
    await tell(db, tenantId, orderId, o, 'address_reply', 'About the address on your order',
      `We weren’t able to change the address on your order${reason ? `: ${esc(reason)}` : '.'}<br><br>It will ship to:<br><strong>${esc(oneLine(o.shippingAddress))}</strong><br><br>If that’s a problem, send us a note on your order page.`, origin);
    return NextResponse.json({ ok: true, message: `The original address stays. ${who} has been told.` });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
