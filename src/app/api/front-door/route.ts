// src/app/api/front-door/route.ts — THE KIOSK FRONT DOOR (K1/K2/K7), for visits that aren't appointments or walk-ins
// (those keep their own phone-first flow in /api/walkins). Public (the kiosk is unattended), rate-limited.
//   options { tenantId }                     → the "What brings you in?" options this business shows
//   renters { tenantId }                     → who a guest can be visiting (first name + business name only)
//   arrive  { tenantId, optionId, name?, note?, renterId?, orderNumber?, phoneLast4? }
//            → records the arrival (frontDoor/{id}, shown live on the desk), alerts the team in-app, texts the renter
//              for a renter visit, and for an order pickup verifies the order (number + last 4 of the phone on it)
//              and marks the customer as here (Arrived on the fulfilment board when the order is ready).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { kioskOptionsShown, kioskOptionsAll } from '@/lib/kiosk-options';
export const dynamic = 'force-dynamic';

const str = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const digits = (v: any) => String(v ?? '').replace(/\D/g, '');
async function rateLimit(db: any, tenantId: string, max: number): Promise<boolean> {   // same 10-minute window as /api/walkins
  const ref = db.doc(`tenants/${tenantId}/private/frontDoorRate`); const cur = ((await ref.get()).data() as any) || {};
  const stamps: number[] = (cur.at || []).filter((t: number) => Date.now() - t < 10 * 60000); if (stamps.length >= max) return false;
  await ref.set({ at: [...stamps, Date.now()].slice(-200) }, { merge: true }); return true;
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = str(b.tenantId, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing business.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = (await db.doc(T).get()).data(); if (!tenant) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  if (b.action === 'options') return NextResponse.json({ ok: true, options: kioskOptionsShown(tenant) });
  if (b.action === 'renters') {
    const leases = (await db.collection(`${T}/leases`).where('status', '==', 'active').limit(200).get()).docs.map((d: any) => d.data()?.renterId).filter(Boolean);
    const ids = Array.from(new Set(leases)).slice(0, 60) as string[];
    const rows = (await Promise.all(ids.map((id) => db.doc(`${T}/renters/${id}`).get().catch(() => null)))).filter((s: any) => s?.exists).map((s: any) => { const r: any = s.data();
      return { id: s.id, name: str(r.firstName || String(r.name || '').split(' ')[0] || 'Renter', 30), business: str(r.businessName || '', 60) }; });
    return NextResponse.json({ ok: true, renters: rows.sort((a: any, c: any) => a.name.localeCompare(c.name)) });
  }
  if (b.action !== 'arrive') return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  if (!(await rateLimit(db, tenantId, 60))) return NextResponse.json({ ok: false, error: 'Lots of check-ins right now — please ask at the desk.' }, { status: 429 });
  const opt = kioskOptionsAll(tenant).find((o) => o.id === str(b.optionId, 40));
  if (!opt || ['appointment', 'walkin'].includes(opt.intent)) return NextResponse.json({ ok: false, error: 'Please choose an option again.' }, { status: 400 });
  const name = str(b.name, 40); const note = str(b.note, 200); const now = new Date().toISOString();
  const rec: any = { id: '', intent: opt.intent, optionId: opt.id, label: opt.label, name: name || null, note: note || null, status: 'waiting', createdAt: now, via: 'kiosk' };
  let message = `${name || 'Someone'} is at the front door — ${opt.label.toLowerCase()}`; let reply = 'Thanks — we’ve let the team know you’re here.'; let priority = opt.intent === 'help' ? 'urgent' : 'high';

  if (opt.intent === 'pickup') {   // verify: order number + last 4 digits of the phone on the order
    const num = digits(b.orderNumber); const last4 = digits(b.phoneLast4).slice(-4);
    if (!num || last4.length !== 4) return NextResponse.json({ ok: false, error: 'Enter your order number and the last 4 digits of your phone.' }, { status: 400 });
    const snap = await db.collection(`${T}/retailOrders`).where('orderNumber', '==', Number(num)).limit(3).get().catch(() => ({ docs: [] as any[] }));
    let d: any = snap.docs.find((x: any) => digits(x.data()?.customerPhone).slice(-4) === last4);
    if (!d) { const s2 = await db.collection(`${T}/retailOrders`).where('orderNumber', '==', num).limit(3).get().catch(() => ({ docs: [] as any[] })); d = s2.docs.find((x: any) => digits(x.data()?.customerPhone).slice(-4) === last4); }
    if (!d) return NextResponse.json({ ok: false, error: 'We couldn’t match that order — check the number, or tap “I need help”.' }, { status: 404 });
    const o: any = d.data(); const { canAdvance, buildEvent } = await import('@/lib/retail-orders');
    // Ready = waiting to be handed over. Only CURBSIDE orders also move to the Arrived lane (the order rules allow
    // nothing else); an in-store pickup stays Ready in the desk's Pickups, flagged as here via the front-door strip.
    const ready = ['ready', 'arrived'].includes(String(o.stage)); const toArrived = canAdvance(o, 'arrived').ok; const batch = db.batch();
    batch.set(d.ref, { ...(toArrived ? { stage: 'arrived' } : {}), pickupArrivedAt: now, pickupArrivedVia: 'kiosk' }, { merge: true });
    batch.set(d.ref.collection('events').doc(), buildEvent('note', 'customer', o.customerName || 'Customer', { note: ready ? 'Arrived at the kiosk to collect' : 'Arrived at the kiosk — order not ready yet' } as any));
    await batch.commit();
    Object.assign(rec, { orderId: d.id, orderNumber: o.orderNumber ?? num, name: rec.name || str(String(o.customerName || '').split(' ')[0], 40) || null });
    message = `${rec.name || 'A customer'} is here to collect order #${o.orderNumber ?? num}${ready ? '' : ' (not ready yet)'}`;
    reply = ready ? `Thanks${rec.name ? `, ${rec.name}` : ''} — we’ll bring order #${o.orderNumber ?? num} right out.` : `Thanks${rec.name ? `, ${rec.name}` : ''} — we’re getting order #${o.orderNumber ?? num} ready now.`;
  }
  if (opt.intent === 'renter') {
    const rid = str(b.renterId, 80); const r: any = rid ? (await db.doc(`${T}/renters/${rid}`).get()).data() : null;
    if (!r) return NextResponse.json({ ok: false, error: 'Please choose who you’re here to see.' }, { status: 400 });
    const rn = str(r.firstName || String(r.name || '').split(' ')[0] || 'them', 30);
    Object.assign(rec, { renterId: rid, renterName: rn }); message = `${name || 'A guest'} is here to see ${rn}`; reply = `Thanks — we’ve let ${rn} know you’re here.`;
    if (r.phone) { try { const { sendNotification } = await import('@/lib/notify'); await sendNotification(db, { tenantId, channel: 'sms', to: r.phone, text: `${name || 'Your guest'} has arrived and checked in at the front desk.` } as any); rec.renterTexted = true; } catch { rec.renterTexted = false; } }
  }
  if (opt.intent === 'help') reply = 'Someone will be right with you.';
  if (opt.intent === 'tour') reply = `Welcome${name ? `, ${name}` : ''}! Someone will be with you shortly.`;
  const ref = db.collection(`${T}/frontDoor`).doc(); rec.id = ref.id;
  const n = db.collection(`${T}/notifications`).doc(); const batch = db.batch();
  batch.set(ref, rec);
  batch.set(n, { id: n.id, userId: null, type: 'front_door', priority, message: note ? `${message} · “${note}”` : message, link: '/pos', frontDoorId: ref.id, createdAt: now, read: false, resolved: false });
  await batch.commit();
  return NextResponse.json({ ok: true, reply });
}
