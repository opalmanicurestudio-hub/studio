// src/app/api/retail/address/route.ts — THE TEAM'S SIDE OF GETTING THE ADDRESS RIGHT (lib/address-flow). Team only.
//   ask_confirm     "Ask Dana to confirm": a text (or email) with her order page, where she taps "Yes, ship it here" or
//                   fixes it. Nothing waits on her answer; the label can still be bought.
//   approve_change  her change came in after the label: every box's label is voided (the postage comes back), the new
//                   address goes on the order, and it's ready for a new label. On an order held for review, managers only.
//   keep_old        the old address stays; she's told why on her order page.
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
    let voided = 0;
    if (o.shippoTransactionId) {
      const { shippoKeyFor } = await import('@/lib/retail-secrets');
      const { voidOrderLabels } = await import('@/lib/label-void');
      const v = await voidOrderLabels(db, tenantId, o, await shippoKeyFor(db, tenantId, t));
      if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 502 });
      voided = v.count;
    }
    const { LABEL_CLEARED } = await import('@/lib/label-void');
    const hadLabel = !!(o.labelUrl || o.trackingNumber || o.shippoTransactionId);
    const out = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      if (cur.addressRequest?.id !== req0.id || cur.addressRequest?.status !== 'waiting') return { ok: false, error: 'Someone else already answered this.' };
      tx.set(ref, {
        ...(hadLabel ? { ...LABEL_CLEARED, labelVoidedAt: now } : {}),
        shippingAddress: req0.to, addressCheck: req0.check || null,
        addressChanged: { at: now, from: cur.shippingAddress || null, by: 'staff', after: hadLabel ? 'label' : String(cur.stage || '') },
        addressRequest: { ...cur.addressRequest, status: 'done', answeredAt: now, answeredBy: actor.uid, answeredByName: actor.name },
        ...(cur.addressConfirm?.status === 'waiting' ? { addressConfirm: { ...cur.addressConfirm, status: 'fixed', answeredAt: now } } : {}),
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
      if (cur.addressRequest?.id !== req0!.id || cur.addressRequest?.status !== 'waiting') return { ok: false, error: 'Someone else already answered this.' };
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
