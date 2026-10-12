// src/app/api/concierge/requests/route.ts — THE LOUNGE KIOSK'S ORDERS, THROUGH THE SERVER.
//
// The concierge kiosk (/concierge/{tenantId}) used to read and write tenants/{t}/refreshmentRequests straight from the
// browser, which meant the collection had to be open to anyone — every business's guest names and client ids could be
// listed by anybody. The collection is now team-only; the kiosk asks here.
//
// GET  ?tenantId=…&phone=…   -> { ok, perkRemaining: { [itemId]: n } } for the guest who typed that mobile number
//                               (club allowance left this billing cycle — counts only, no order rows, no ids)
// GET  ?tenantId=…           -> { ok, requests: [...] } today's orders for an on-screen board: item, quantity, status,
//                               station, time and the guest's first name. No client ids, phones or prices.
// POST { tenantId, itemId, quantity, clientName, phone?, boothId?, reservationId?, stationName?, guestDescription?,
//        notes?, settle, stripePaymentIntentId? }
//   settle: 'perk' | 'renter_comp' | 'station' | 'card_on_file' | 'balance' | 'desk'
//   -> creates the order. Everything that matters is decided HERE, not by the browser: the item and its price come from
//      the business's menu, a club perk is checked against the allowance, a host comp against the renter's allowance,
//      a station charge against the charge the server already recorded, and an order is only ever marked paid when the
//      Stripe payment it names really succeeded for this business and this client and hasn't been used before.
//
// No sign-in is needed (it's a guest-facing kiosk); calls are rate-limited per device address and per business.
// There is no kiosk device token in the app — a kiosk is identified by its business (and booth, when opened from a
// station link, which must belong to that business).
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { tenantTimeZone, todayIn, dayKey } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';

type Settle = 'perk' | 'renter_comp' | 'station' | 'card_on_file' | 'balance' | 'desk';
const SETTLES: Settle[] = ['perk', 'renter_comp', 'station', 'card_on_file', 'balance', 'desk'];

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const digits = (s: any) => String(s || '').replace(/\D/g, '');
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** Plain one-line text: control characters stripped, trimmed, capped. */
const clean = (v: any, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

async function findClientByPhone(db: FirebaseFirestore.Firestore, tenantId: string, phone: string) {
  const d = digits(phone).slice(-10);
  if (d.length !== 10) return null;
  const snap = await db.collection(`tenants/${tenantId}/clients`).where('phone', '==', `+1${d}`).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...(snap.docs[0].data() as any) };
}

/** Same arithmetic the kiosk used: the cycle starts a month (or year) before the next billing date, at the start of
 *  that month; every non-cancelled order for the item at no charge inside the cycle counts against the allowance. */
async function perkRemainingFor(db: FirebaseFirestore.Firestore, tenantId: string, client: any): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!client?.activeMembershipId) return out;
  const mSnap = await db.doc(`tenants/${tenantId}/memberships/${String(client.activeMembershipId)}`).get();
  const membership: any = mSnap.exists ? mSnap.data() : null;
  const included: any[] = Array.isArray(membership?.includedProducts) ? membership.includedProducts : [];
  if (!included.length) return out;

  let cycleStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const next = client?.subscription?.nextBillingDate ? new Date(client.subscription.nextBillingDate) : null;
  if (next && Number.isFinite(next.getTime())) {
    const back = new Date(next);
    if (membership?.interval === 'yearly') back.setFullYear(back.getFullYear() - 1); else back.setMonth(back.getMonth() - 1);
    cycleStart = new Date(back.getFullYear(), back.getMonth(), 1).getTime();
  }

  const rSnap = await db.collection(`tenants/${tenantId}/refreshmentRequests`).where('clientId', '==', client.id).get();
  const inCycle = rSnap.docs.map((d) => d.data() as any).filter((r) => {
    if (!r || r.status === 'cancelled') return false;
    const t = Date.parse(String(r.requestedAt || ''));
    return Number.isFinite(t) && t > cycleStart;
  });
  for (const perk of included) {
    const id = String(perk?.id || ''); if (!id) continue;
    const allotted = Math.max(0, Math.floor(num(perk?.quantity)));
    const used = inCycle.filter((r) => r.itemId === id && num(r.priceAtRequest) === 0)
      .reduce((s, r) => s + Math.max(1, Math.floor(num(r.quantity)) || 1), 0);
    out[id] = Math.max(0, allotted - used);
  }
  return out;
}

/** The resident renter of a booth with amenities on, as the station lookup resolves it. */
async function boothRenter(db: FirebaseFirestore.Firestore, tenantId: string, boothId: string) {
  const leaseSnap = await db.collection(`tenants/${tenantId}/leases`).where('boothId', '==', boothId).get();
  const lease = leaseSnap.docs.map((d) => d.data() as any).find((l) => ['active', 'on_leave'].includes(l.status));
  if (!lease?.renterId) return null;
  const rSnap = await db.doc(`tenants/${tenantId}/renters/${String(lease.renterId)}`).get();
  const rt: any = rSnap.exists ? rSnap.data() : null;
  if (!rt?.amenitiesEnabled) return null;
  return { renterId: String(lease.renterId), compAllowance: Math.max(0, Math.round(num(rt.amenityCompAllowance))) };
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 120);
  const phone = String(req.nextUrl.searchParams.get('phone') || '');
  if (!ID_RE.test(tenantId)) return bad('Which business?');
  const limited = await limitPublic(req, phone ? 'concierge_perks' : 'concierge_board', tenantId, { perHour: 240, perDay: 5000 });
  if (limited) return limited;
  try {
    const db = getAdminDb();
    const tSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tSnap.exists) return bad('Not found.', 404);

    if (phone) {
      const client = await findClientByPhone(db, tenantId, phone);
      const perkRemaining = client ? await perkRemainingFor(db, tenantId, client) : {};
      return NextResponse.json({ ok: true, perkRemaining }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Today's board. Looked back a day and a half, then narrowed to the business's own calendar day.
    const tz = tenantTimeZone(tSnap.data());
    const today = todayIn(tz);
    const since = new Date(Date.now() - 36 * 3600e3).toISOString();
    const snap = await db.collection(`tenants/${tenantId}/refreshmentRequests`).where('requestedAt', '>=', since).get();
    const requests = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((r) => { const t = Date.parse(String(r.requestedAt || '')); return Number.isFinite(t) && dayKey(new Date(t), tz) === today; })
      .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
      .slice(0, 100)
      .map((r) => ({
        id: String(r.id),
        itemName: clean(r.itemName, 80),
        quantity: Math.max(1, Math.floor(num(r.quantity)) || 1),
        status: clean(r.status, 30),
        stationName: clean(r.stationName, 60) || null,
        requestedAt: clean(r.requestedAt, 40),
        guestFirstName: clean(String(r.clientName || '').split(' ')[0], 30) || 'Guest',
        isRedemption: r.isRedemption === true,
      }));
    return NextResponse.json({ ok: true, requests }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[concierge/requests GET]', e?.message);
    return bad('Something went wrong.', 500);
  }
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { return bad('Bad request.'); }
  const tenantId = String(body?.tenantId || '').slice(0, 120);
  if (!ID_RE.test(tenantId)) return bad('Which business?');
  const limited = await limitPublic(req, 'concierge_order', tenantId, { perHour: 60, perDay: 3000 });
  if (limited) return limited;

  const itemId = String(body?.itemId || '');
  if (!ID_RE.test(itemId)) return bad('Pick something from the menu.');
  const quantity = Number(body?.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return bad('Quantity must be between 1 and 10.');
  const settleIn = String(body?.settle || 'desk') as Settle;
  if (!SETTLES.includes(settleIn)) return bad('How should this be settled?');
  const boothId = body?.boothId ? String(body.boothId) : '';
  if (boothId && !ID_RE.test(boothId)) return bad('Unknown station.');
  const reservationId = body?.reservationId ? String(body.reservationId) : '';
  if (reservationId && !ID_RE.test(reservationId)) return bad('Unknown stay.');

  try {
    const db = getAdminDb();
    const tSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tSnap.exists) return bad('Not found.', 404);
    const tenant: any = tSnap.data() || {};

    // The item, from this business's own menu.
    const iSnap = await db.doc(`tenants/${tenantId}/inventory/${itemId}`).get();
    const item: any = iSnap.exists ? iSnap.data() : null;
    if (!item || item.type !== 'refreshment' || item.showInConcierge === false || !(num(item.totalStock) > 0)) {
      return bad('That isn’t on the menu right now.', 404);
    }
    const unitPrice = Math.max(0, num(item.price));
    const orderTotal = Math.round(unitPrice * quantity * 100) / 100;
    const itemName = clean(item.name, 80) || 'Item';

    // The guest, when they identified themselves with their mobile number.
    const phone = body?.phone ? String(body.phone) : '';
    const client = phone ? await findClientByPhone(db, tenantId, phone) : null;
    if (phone && !client) return bad('We couldn’t find that profile.', 404);
    if (item.isMembersOnly && !client?.activeMembershipId) return bad('That item is for members.', 403);

    // The station, when the kiosk was opened from a booth link — it must be one of this business's booths.
    let boothName = '';
    if (boothId) {
      const bSnap = await db.doc(`tenants/${tenantId}/booths/${boothId}`).get();
      if (!bSnap.exists) return bad('Unknown station.', 404);
      boothName = clean((bSnap.data() as any)?.name, 60);
    }
    const stationName = clean(body?.stationName, 60) || boothName || 'Lounge / Waiting Area';
    const clientName = clean(client?.name || body?.clientName, 60) || 'Guest';

    // ── How it settles — verified, never taken on the browser's word ──────────
    let settledBy: Settle = orderTotal > 0 ? settleIn : 'desk';
    let isRedemption = false, compedByRenter = false, chargedToStation = false, paidAtKiosk = false;
    let stripePaymentIntentId: string | null = null;
    let renterId: string | null = null;
    let stationTxnRef: FirebaseFirestore.DocumentReference | null = null;

    // A day guest checked in at the station pays for it themselves; otherwise the booth's resident renter is the payer.
    if (boothId && !reservationId) { const br = await boothRenter(db, tenantId, boothId); renterId = br?.renterId || null; }

    if (settledBy === 'perk') {
      if (!client) return bad('Sign in with your mobile number to use a club perk.', 403);
      const left = (await perkRemainingFor(db, tenantId, client))[itemId] || 0;
      if (left < quantity) return bad('Your club allowance for this item is used up this cycle.', 409);
      isRedemption = true;
    } else if (settledBy === 'renter_comp') {
      const br = boothId ? await boothRenter(db, tenantId, boothId) : null;
      if (!br || br.compAllowance <= 0) return bad('No complimentary allowance at this station.', 409);
      const tz = tenantTimeZone(tenant); const today = todayIn(tz);
      const bs = await db.collection(`tenants/${tenantId}/refreshmentRequests`).where('boothId', '==', boothId).get();
      const usedToday = bs.docs.map((d) => d.data() as any)
        .filter((r) => r.compedByRenter === true && r.status !== 'cancelled' && Number.isFinite(Date.parse(String(r.requestedAt || ''))) && dayKey(new Date(String(r.requestedAt)), tz) === today).length;
      if (usedToday >= br.compAllowance) return bad('Today’s complimentary allowance at this station is used.', 409);
      compedByRenter = true;
    } else if (settledBy === 'station') {
      // The station charge itself is made by /api/booths/kiosk, which records the income. Find that record: same payer,
      // same order, same amount, in the last ten minutes, and not already attached to another order.
      const sourceId = reservationId || renterId;
      if (!sourceId) return bad('No station charge found — please pay the host.', 402);
      const ts = await db.collection(`tenants/${tenantId}/transactions`).where('sourceId', '==', sourceId).get();
      const want = `Concierge: ${String(item.name || '')} (x${quantity})`;
      const match = ts.docs.find((d) => {
        const t: any = d.data();
        const at = Date.parse(String(t.createdAt || t.date || ''));
        return t.type === 'income' && !t.conciergeRequestId && Math.abs(num(t.amount) - orderTotal) < 0.005
          && String(t.description || '').startsWith(want) && Number.isFinite(at) && Date.now() - at < 10 * 60000;
      });
      if (!match) return bad('No station charge found — please pay the host.', 402);
      stationTxnRef = match.ref; chargedToStation = true;
    } else if (settledBy === 'card_on_file') {
      // Paid only if Stripe says so: this business's account, this client, at least this amount, succeeded, unused.
      const piId = String(body?.stripePaymentIntentId || '');
      if (!client || !/^pi_[A-Za-z0-9]+$/.test(piId)) return bad('No card payment to record.', 402);
      const acct = String(tenant.stripeAccountId || '');
      if (!acct || !process.env.STRIPE_SECRET_KEY) return bad('Card payments aren’t set up here.', 400);
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      let pi: any = null;
      try { pi = await stripe.paymentIntents.retrieve(piId, {}, { stripeAccount: acct }); } catch { pi = null; }
      const ok = pi && pi.status === 'succeeded' && pi.metadata?.tenantId === tenantId && pi.metadata?.clientId === client.id
        && num(pi.amount_received) >= Math.round(orderTotal * 100);
      if (!ok) return bad('That card payment couldn’t be confirmed.', 402);
      const used = await db.collection(`tenants/${tenantId}/refreshmentRequests`).where('stripePaymentIntentId', '==', piId).limit(1).get();
      if (!used.empty) return bad('That payment is already on another order.', 409);
      stripePaymentIntentId = piId; paidAtKiosk = true;
    } else if (settledBy === 'balance') {
      if (!client) settledBy = 'desk';   // only a client the business can invoice later carries a balance
    }

    const priceAtRequest = (isRedemption || compedByRenter || chargedToStation || paidAtKiosk || settledBy === 'balance') ? 0 : unitPrice;
    const outSettled: 'card_on_file' | 'balance' | 'desk' | null =
      (isRedemption || compedByRenter || chargedToStation || orderTotal <= 0) ? null : (settledBy as any);

    const requestId = nanoid();
    const nowIso = new Date().toISOString();
    const batch = db.batch();
    batch.set(db.doc(`tenants/${tenantId}/refreshmentRequests/${requestId}`), {
      id: requestId, tenantId,
      clientId: client?.id || 'guest-walkin',
      clientName,
      itemId, itemName, quantity,
      status: 'pending',
      requestedAt: nowIso,
      stationName,
      boothId: boothId || null,
      renterId: renterId || null,
      chargedToStation, compedByRenter,
      isRedemption,
      settledBy: outSettled,
      paidAtKiosk,
      stripePaymentIntentId,
      guestDescription: clean(body?.guestDescription, 200),
      notes: clean(body?.notes, 300),
      priceAtRequest,
      isGuestKiosk: true,
    });
    if (stationTxnRef) batch.update(stationTxnRef, { conciergeRequestId: requestId });

    // Income is booked only for a confirmed card payment.
    if (paidAtKiosk && client) {
      const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      batch.set(txnRef, {
        id: txnRef.id, date: nowIso, description: `Lounge Sale: ${itemName} (x${quantity})`,
        clientOrVendor: clientName, clientId: client.id, type: 'income', context: 'Business',
        category: 'Hospitality Revenue', amount: orderTotal, paymentMethod: 'Card on File (Stripe)',
        stripePaymentIntentId, hasReceipt: true, tenantId, conciergeRequestId: requestId,
      });
    }
    // Owed, not collected: the desk settles it at checkout.
    if (outSettled === 'balance' && client) {
      batch.update(db.doc(`tenants/${tenantId}/clients/${client.id}`), {
        outstandingBalance: FieldValue.increment(orderTotal),
        unpaidFees: FieldValue.arrayUnion({ feeId: nanoid(), appointmentId: null, appointmentDate: nowIso, feeAmount: orderTotal, reason: `Lounge order — ${itemName} (x${quantity})` }),
      });
    }
    const auditRef = db.collection(`tenants/${tenantId}/auditLogs`).doc();
    batch.set(auditRef, {
      action: 'sale.lounge', targetType: 'refreshmentRequest', targetId: requestId,
      summary: `Concierge order: ${itemName} (x${quantity}) for ${clientName} @ ${stationName}${
        chargedToStation ? ' — charged to station card'
        : compedByRenter ? ' — comped (host allowance)'
        : isRedemption ? ' — club perk (membership allowance)'
        : outSettled === 'card_on_file' ? ` — $${orderTotal.toFixed(2)} charged to card on file`
        : outSettled === 'balance' ? ` — $${orderTotal.toFixed(2)} added to client balance (uncollected)`
        : outSettled === 'desk' ? ` — $${orderTotal.toFixed(2)} to collect at the station`
        : ''}`,
      amount: orderTotal,
      actor: { type: 'system', id: 'concierge-kiosk', name: 'Concierge Kiosk', via: 'concierge-kiosk' },
      at: nowIso,
    });
    await batch.commit();

    return NextResponse.json({
      ok: true, requestId, settledBy: outSettled, isRedemption, compedByRenter, chargedToStation, paidAtKiosk, orderTotal,
    });
  } catch (e: any) {
    console.error('[concierge/requests POST]', e?.message);
    return bad('That order didn’t go through — please ask the team.', 500);
  }
}
