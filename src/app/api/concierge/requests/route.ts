// src/app/api/concierge/requests/route.ts — THE LOUNGE KIOSK'S ORDERS, THROUGH THE SERVER.
//
// The concierge kiosk (/concierge/{tenantId}) used to read and write tenants/{t}/refreshmentRequests straight from the
// browser, which meant the collection had to be open to anyone — every business's guest names and client ids could be
// listed by anybody. The collection is now team-only; the kiosk asks here.
//
// GET  ?tenantId=…&phone=…&pass=…  -> { ok, perkRemaining: { [itemId]: n } } for the guest who typed that mobile number
//                               (club allowance left this billing cycle — counts only, no order rows, no ids). Only with
//                               the guest pass for that number, or the front desk signed in on the screen; otherwise
//                               the answer is the same as for a number nobody has, so it never says who is a client.
// GET  ?tenantId=…           -> { ok, requests: [...] } today's orders for an on-screen board: item, quantity, status,
//                               station, time and the guest's first name. No client ids, phones or prices.
// POST { tenantId, itemId, quantity, clientName, phone?, boothId?, reservationId?, stationName?, guestDescription?,
//        notes?, settle, orderKey?, stationOrderId?, stationToken?, guestPass?, stripePaymentIntentId? }
//   settle: 'perk' | 'renter_comp' | 'station' | 'card_on_file' | 'balance' | 'desk'
//   -> creates the order. Everything that matters is decided HERE, not by the browser: the item and its price come from
//      the business's menu, a club perk is checked against the allowance, a host comp against the renter's allowance,
//      a station charge against the charge the server already made for this order (stationOrderId, from
//      /api/booths/kiosk), and an order is only ever marked paid when the Stripe payment it names really succeeded for
//      this business and this client and hasn't been used before.
// POST { action: 'send-code', tenantId, phone }                 -> a 6-digit code texted to that number, when the
//                                                                  business has it (a client's, or a day guest's today)
// POST { action: 'check-code', tenantId, phone, codeId, code }  -> { pass }: the guest pass for that number (four hours)
//
// No sign-in is needed (it's a guest-facing kiosk); calls are rate-limited per device address and per business.
// Ordering to pay when it arrives needs nothing more. Anything that uses someone's account needs proof
// (lib/station-token):
//   • adding it to a client's visit ('balance') or using their club allowance ('perk'): the guest pass from the code
//     texted to their phone — or, for a client at the shop right now (a visit today they've checked in for), the
//     station's signed link or the front desk signed in on this screen;
//   • the host's complimentary allowance ('renter_comp'): the station's signed link, or the front desk signed in here.
// The screen names each order (orderKey) and keeps the name when it asks again, so a double tap or a retry makes one
// order, and adds to a balance once.
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { tenantTimeZone, todayIn, dayKey } from '@/lib/tenant-time';
import { checkGuestPass, checkKioskCode, deskSignedIn, startKioskCode, stationLinkOk } from '@/lib/station-token';

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

/** At the shop right now: a visit today (the business's own day) they've arrived for, are in, or are checking out of. */
const HERE_NOW = ['checked_in', 'waiting', 'arrived', 'servicing', 'in_service', 'in_progress', 'ready_for_checkout'];
async function hereNow(db: FirebaseFirestore.Firestore, tenantId: string, clientId: string, tz: string): Promise<boolean> {
  const today = todayIn(tz);
  const snap = await db.collection(`tenants/${tenantId}/appointments`).where('clientId', '==', clientId).get();
  return snap.docs.some((d) => {
    const a: any = d.data() || {};
    const t = a.startTime?.toDate ? a.startTime.toDate().getTime() : Date.parse(String(a.startTime || ''));
    return Number.isFinite(t) && dayKey(new Date(t), tz) === today && (HERE_NOW.includes(String(a.status || '')) || String(a.checkInStatus || '') === 'arrived');
  });
}

/** 'send-code' / 'check-code': a code by text to a number the business already has, and the guest pass it gives. The
 *  answer to 'send-code' is the same whether or not the business has the number (nothing is sent when it doesn't). */
async function codeAction(req: NextRequest, tenantId: string, body: any) {
  const sending = body?.action === 'send-code';
  const limited = await limitPublic(req, sending ? 'concierge_code' : 'concierge_code_check', tenantId, sending ? { perHour: 30, perDay: 300 } : { perHour: 60, perDay: 1000 });
  if (limited) return limited;
  const ph = digits(body?.phone).slice(-10);
  if (ph.length !== 10) return bad('Enter your mobile number.');
  try {
    const db = getAdminDb();
    if (!sending) {
      const r = await checkKioskCode(db, tenantId, { codeId: String(body?.codeId || ''), code: String(body?.code || ''), phone: ph });
      if (!r.ok) return bad(r.error);
      return NextResponse.json({ ok: true, pass: r.pass, until: r.until }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const tSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tSnap.exists) return bad('Not found.', 404);
    // Only ever to a number the business has: a client's, or a day guest's checked in today. Never one typed in, and
    // never one reported as the wrong number ("Not you?").
    const client = await findClientByPhone(db, tenantId, ph);
    let to = '', name: string | null = null, recipientId: string | null = null, recipientType: 'client' | 'contact' = 'contact';
    if (client?.phone && !client.phoneReportedWrongAt) { to = String(client.phone); name = client.name || null; recipientId = String(client.id); recipientType = 'client'; }
    else if (!client) {
      const today = todayIn(tenantTimeZone(tSnap.data()));
      const snap = await db.collection(`tenants/${tenantId}/boothReservations`).where('startDate', '<=', today).get();
      const stay: any = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
        .find((r: any) => r.status === 'checked_in' && r.endDate >= today && digits(r.phone).slice(-10) === ph);
      if (stay) { to = String(stay.phone); name = stay.name || null; recipientId = String(stay.id); }
    }
    const r = await startKioskCode(db, tenantId, { phone: ph, to: to || null, name, recipientId, recipientType });
    if (!r.ok) return bad(r.error);
    return NextResponse.json({ ok: true, codeId: r.codeId, sentTo: r.sentTo }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[concierge/requests code]', e?.message);
    return bad('That didn’t go through — please ask the team.', 500);
  }
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
      // A phone number alone tells nothing: the counts (and whether it's a client at all) only for the code's pass for
      // that number, or with the front desk signed in here. Without either, the number isn't even looked up.
      const proven = checkGuestPass(tenantId, digits(phone).slice(-10), req.nextUrl.searchParams.get('pass')) || await deskSignedIn(req, tenantId);
      const client = proven ? await findClientByPhone(db, tenantId, phone) : null;
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
  if (body?.action === 'send-code' || body?.action === 'check-code') return codeAction(req, tenantId, body);
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
  // The order's name from the screen, kept when it asks again: one order, however often it's sent.
  const orderKey = String(body?.orderKey || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);

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

    // The station, when the kiosk was opened from a booth link — it must be one of this business's booths.
    let boothName = '';
    if (boothId) {
      const bSnap = await db.doc(`tenants/${tenantId}/booths/${boothId}`).get();
      if (!bSnap.exists) return bad('Unknown station.', 404);
      boothName = clean((bSnap.data() as any)?.name, 60);
    }

    // The guest, when they identified themselves with their mobile number. The number is looked up only for someone who
    // proved it's theirs (the code we text gives a pass for it) or with the front desk signed in on this screen — or,
    // from the station's signed link, only to see whether they're at the shop right now. Anyone else gets the same
    // answers whether or not the number belongs to a client.
    const phone = body?.phone ? String(body.phone) : '';
    const passOk = !!phone && checkGuestPass(tenantId, digits(phone).slice(-10), body?.guestPass);
    const desk = await deskSignedIn(req, tenantId);
    const vouched = passOk || desk;
    const link = boothId ? await stationLinkOk(db, tenantId, boothId, body?.stationToken) : { ok: false, renterId: '' };
    const found = phone && (vouched || link.ok) ? await findClientByPhone(db, tenantId, phone) : null;
    if (phone && vouched && !found) return bad('We couldn’t find that profile.', 404);
    // At the shop right now (a visit today they've checked in for), on the station's link or the front desk's screen.
    const here = !!found && !passOk ? await hereNow(db, tenantId, String(found.id), tenantTimeZone(tenant)) : false;
    const client = vouched || here ? found : null;
    // Using their account (a balance, a club perk): the code's pass, or being here now.
    const accountOk = !!client && (passOk || here);
    const needsCode = (error: string) => NextResponse.json({ ok: false, needsCode: true, error }, { status: 403 });
    if (item.isMembersOnly && !client?.activeMembershipId) {
      return phone && !client ? needsCode('To order this, enter the code we text to your phone.') : bad('That item is for members.', 403);
    }
    const stationName = clean(body?.stationName, 60) || boothName || 'Lounge / Waiting Area';
    const clientName = clean(client?.name || body?.clientName, 60) || 'Guest';

    // ── How it settles — verified, never taken on the browser's word ──────────
    let settledBy: Settle = orderTotal > 0 ? settleIn : 'desk';
    let isRedemption = false, compedByRenter = false, chargedToStation = false, paidAtKiosk = false;
    let stripePaymentIntentId: string | null = null;
    let renterId: string | null = null;
    let compAllowance = 0;
    let stationOrderId = '';

    // A day guest checked in at the station pays for it themselves; otherwise the booth's resident renter is the payer.
    if (boothId && !reservationId) { const br = await boothRenter(db, tenantId, boothId); renterId = br?.renterId || null; }

    if (settledBy === 'perk' || settledBy === 'balance') {
      // Someone's own account: proof it's them first. Without it, ordering to pay when it arrives still works.
      if (!phone) {
        if (settledBy === 'perk') return bad('Sign in with your mobile number to use a club perk.', 403);
        settledBy = 'desk';   // only a client the business can invoice later carries a balance
      } else if (!accountOk) {
        return needsCode(settledBy === 'perk'
          ? 'To use your club allowance, enter the code we text to your phone.'
          : 'To add this to your visit, enter the code we text to your phone — or pay when it arrives.');
      }
      if (settledBy === 'perk') isRedemption = true;
    } else if (settledBy === 'renter_comp') {
      const br = boothId ? await boothRenter(db, tenantId, boothId) : null;
      if (!br || br.compAllowance <= 0) return bad('No complimentary allowance at this station.', 409);
      if (!link.ok && !desk) {
        return NextResponse.json({ ok: false, linkNeedsUpdate: true, error: 'To use this station’s complimentary allowance, please ask the front desk for the station’s current link.' }, { status: 403 });
      }
      compAllowance = br.compAllowance; renterId = br.renterId; compedByRenter = true;
    } else if (settledBy === 'station') {
      // The station charge itself is made by /api/booths/kiosk, under the order id it gave the screen. It's checked
      // below, in the same step that writes the order: charged, for this item, quantity and amount, at this station, and
      // not already on another order.
      stationOrderId = String(body?.stationOrderId || '');
      if (!/^sc_[a-f0-9]{24}$/.test(stationOrderId)) return bad('No station charge found — please pay the host.', 402);
      chargedToStation = true;
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
      // Orders from before payments were named after themselves are found by looking (newer ones are checked below).
      const used = await db.collection(`tenants/${tenantId}/refreshmentRequests`).where('stripePaymentIntentId', '==', piId).limit(1).get();
      if (!used.empty && (!orderKey || used.docs[0].id !== `kq_${createHash('sha256').update(`${tenantId}|${orderKey}`).digest('hex').slice(0, 24)}`)) return bad('That payment is already on another order.', 409);
      stripePaymentIntentId = piId; paidAtKiosk = true;
    }

    const priceAtRequest = (isRedemption || compedByRenter || chargedToStation || paidAtKiosk || settledBy === 'balance') ? 0 : unitPrice;
    const outSettled: 'card_on_file' | 'balance' | 'desk' | null =
      (isRedemption || compedByRenter || chargedToStation || orderTotal <= 0) ? null : (settledBy as any);

    // ── Written once, in one step ─────────────────────────────────────────────
    // The order is named after the screen's order name, so asking again finds it made. Whatever it uses is checked in
    // the same step: the station charge, the card payment (named after it, so it can't go on two orders), the club
    // allowance and the host's allowance (one order at a time per client, and per renter). A balance goes up only in
    // the step that writes the order, and its fee is named after the order.
    const requestId = orderKey ? `kq_${createHash('sha256').update(`${tenantId}|${orderKey}`).digest('hex').slice(0, 24)}` : nanoid();
    const nowIso = new Date().toISOString();
    const tz = tenantTimeZone(tenant);
    const reqRef = db.doc(`tenants/${tenantId}/refreshmentRequests/${requestId}`);
    const chargeRef = stationOrderId ? db.doc(`tenants/${tenantId}/private/kiosk/stationCharges/${stationOrderId}`) : null;
    const chargeLineRef = stationOrderId ? db.doc(`tenants/${tenantId}/transactions/concierge_${stationOrderId}`) : null;
    const cardUseRef = stripePaymentIntentId ? db.doc(`tenants/${tenantId}/private/kiosk/cardPayments/${stripePaymentIntentId}`) : null;
    const saleRef = stripePaymentIntentId ? db.doc(`tenants/${tenantId}/transactions/lounge_${stripePaymentIntentId}`) : null;
    const clientRef = client && (isRedemption || outSettled === 'balance') ? db.doc(`tenants/${tenantId}/clients/${client.id}`) : null;
    const renterRef = compedByRenter && renterId ? db.doc(`tenants/${tenantId}/renters/${renterId}`) : null;
    const auditRef = db.doc(`tenants/${tenantId}/auditLogs/lounge_${requestId}`);
    // The card charge may have put its own line in the books already: then that line is the income, not a second one.
    const cardRecorded = stripePaymentIntentId
      ? !(await db.collection(`tenants/${tenantId}/transactions`).where('stripePaymentIntentId', '==', stripePaymentIntentId).limit(1).get()).empty
      : false;

    const out: any = await db.runTransaction(async (tx: any) => {
      const existing = await tx.get(reqRef);
      const charge: any = chargeRef ? ((await tx.get(chargeRef)).data() || null) : null;
      const chargeLine = chargeLineRef ? await tx.get(chargeLineRef) : null;
      const cardUse = cardUseRef ? await tx.get(cardUseRef) : null;
      if (clientRef) await tx.get(clientRef);
      if (renterRef) await tx.get(renterRef);
      if (existing.exists) return { already: existing.data() };
      if (chargeRef) {
        const fits = charge && charge.status === 'charged' && charge.itemId === itemId && Number(charge.quantity) === quantity
          && Number(charge.amountCents) === Math.round(orderTotal * 100) && (!charge.requestId || charge.requestId === requestId)
          && (charge.payerKind === 'stay' ? (!reservationId || charge.payerId === reservationId) : charge.boothId === (boothId || null));
        if (!fits) return { error: 'No station charge found — please pay the host.', status: 402 };
      }
      if (cardUse?.exists) return { error: 'That payment is already on another order.', status: 409 };
      if (isRedemption) {
        const left = (await perkRemainingFor(db, tenantId, client))[itemId] || 0;
        if (left < quantity) return { error: 'Your club allowance for this item is used up this cycle.', status: 409 };
      }
      if (compedByRenter) {
        const today = todayIn(tz);
        const bs = await db.collection(`tenants/${tenantId}/refreshmentRequests`).where('boothId', '==', boothId).get();
        const usedToday = bs.docs.map((d) => d.data() as any)
          .filter((r) => r.compedByRenter === true && r.status !== 'cancelled' && Number.isFinite(Date.parse(String(r.requestedAt || ''))) && dayKey(new Date(String(r.requestedAt)), tz) === today).length;
        if (usedToday >= compAllowance) return { error: 'Today’s complimentary allowance at this station is used.', status: 409 };
      }

      tx.set(reqRef, {
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
        stationOrderId: stationOrderId || null,
        guestDescription: clean(body?.guestDescription, 200),
        notes: clean(body?.notes, 300),
        priceAtRequest,
        isGuestKiosk: true,
      });
      if (chargeRef) {
        tx.set(chargeRef, { requestId }, { merge: true });
        if (chargeLine?.exists) tx.update(chargeLineRef, { conciergeRequestId: requestId });
      }
      if (cardUseRef) tx.set(cardUseRef, { id: stripePaymentIntentId, requestId, at: nowIso });
      // Income is booked only for a confirmed card payment, and once.
      if (saleRef && client && !cardRecorded) {
        tx.set(saleRef, {
          id: saleRef.id, date: nowIso, description: `Lounge Sale: ${itemName} (x${quantity})`,
          clientOrVendor: clientName, clientId: client.id, type: 'income', context: 'Business',
          category: 'Hospitality Revenue', amount: orderTotal, paymentMethod: 'Card on File (Stripe)',
          stripePaymentIntentId, hasReceipt: true, tenantId, conciergeRequestId: requestId,
        });
      }
      // Owed, not collected: the desk settles it at checkout.
      if (clientRef && outSettled === 'balance') {
        tx.update(clientRef, {
          outstandingBalance: FieldValue.increment(orderTotal),
          unpaidFees: FieldValue.arrayUnion({ feeId: `lounge_${requestId}`, appointmentId: null, appointmentDate: nowIso, feeAmount: orderTotal, reason: `Lounge order — ${itemName} (x${quantity})` }),
        });
      } else if (clientRef) {
        tx.set(clientRef, { loungePerkUsedAt: nowIso }, { merge: true });
      }
      if (renterRef) tx.set(renterRef, { amenityCompUsedAt: nowIso }, { merge: true });
      tx.set(auditRef, {
        id: auditRef.id, action: 'sale.lounge', targetType: 'refreshmentRequest', targetId: requestId,
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
      return { ok: true };
    });
    if (out?.error) return bad(out.error, out.status || 400);
    if (out?.already) {
      const r: any = out.already;
      return NextResponse.json({
        ok: true, already: true, requestId, settledBy: r.settledBy ?? null, isRedemption: r.isRedemption === true, compedByRenter: r.compedByRenter === true,
        chargedToStation: r.chargedToStation === true, paidAtKiosk: r.paidAtKiosk === true, orderTotal,
      });
    }

    return NextResponse.json({
      ok: true, requestId, settledBy: outSettled, isRedemption, compedByRenter, chargedToStation, paidAtKiosk, orderTotal,
    });
  } catch (e: any) {
    console.error('[concierge/requests POST]', e?.message);
    return bad('That order didn’t go through — please ask the team.', 500);
  }
}
