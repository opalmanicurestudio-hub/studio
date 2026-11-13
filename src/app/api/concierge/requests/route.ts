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
// GET  ?tenantId=…&menu=1    -> { ok, business, menu: [...] } what can be ordered here: name, price, section, words,
//                               picture, members-only, and whether it's available now. Nothing about cost or stock
//                               counts. Public, like a menu on the wall, so a station tablet or a guest's own phone
//                               needs no sign-in to show it.
//      …&phone=…&pass=…        also -> guest: { firstName, member, membershipName, card: { brand, last4 } | null } for
//                               the guest whose pass this is (never before the texted code). The station menu asks the
//                               same with POST { action: 'guest', phone, pass }, so the pass stays out of addresses.
// GET  ?tenantId=…&order=…   -> { ok, status, onItsWay } one order's progress, for the guest who placed it (its id is
//                               named after the screen's own order name, so nobody else can guess it).
// GET  ?tenantId=…           -> { ok, requests: [...] } today's orders for an on-screen board: item, quantity, status,
//                               station, time, the guest's first name and whether it's on its way. No client ids, phones
//                               or prices.
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
// The guest's own card on file ('card_on_file' with no payment named) is charged here, by the server's own card step
// (api/stripe/charge-card), only for the guest the texted code proved (or with the front desk signed in), never on the
// station's link alone. Each card order keeps a claim (lib/lounge-card): a card charged for an order that then couldn't
// be written goes back to the card, and that order's name can't be charged or served again.
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
import Stripe from 'stripe';
import { guestLogo } from '@/lib/brand';
import { cardOrderRef, settleCardOrder } from '@/lib/lounge-card';
import { POST as chargeSavedCard } from '@/app/api/stripe/charge-card/route';
import { getAdminDb } from '@/lib/firebase-admin';
import { closedReply } from '@/lib/tenant-open-server';
import { toolLocked } from '@/lib/tool-lock';
import { choiceGroups, itemSoldOut, orderable, priceChoices } from '@/lib/menu-choices';
import { stockNow } from '@/lib/menu-server';
import { limitPublic } from '@/lib/rate-limit';
import { tenantTimeZone, todayIn, dayKey } from '@/lib/tenant-time';
import { checkGuestPass, checkKioskCode, deskSignedIn, startKioskCode, stationLinkOk } from '@/lib/station-token';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Settle = 'perk' | 'renter_comp' | 'station' | 'card_on_file' | 'balance' | 'desk';
const SETTLES: Settle[] = ['perk', 'renter_comp', 'station', 'card_on_file', 'balance', 'desk'];

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const digits = (s: any) => String(s || '').replace(/\D/g, '');
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** Plain one-line text: control characters stripped, trimmed, capped. */
const clean = (v: any, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
/** On the station menu: a lounge item the business shows there, not put away or switched off. */
const onMenu = (i: any) => !!i && i.type === 'refreshment' && i.showInConcierge !== false && i.archived !== true && i.isActive !== false;
const KQ = (tenantId: string, orderKey: string) => `kq_${createHash('sha256').update(`${tenantId}|${orderKey}`).digest('hex').slice(0, 24)}`;

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
    const used = inCycle.filter((r) => r.itemId === id && (r.isRedemption === true || num(r.priceAtRequest) === 0))
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

/** Who the guest is, as little as the screen needs: a first name to greet, whether a membership covers anything, and a
 *  card that can really be charged (its brand and last four; one that has run out counts as none). Only for a number the
 *  code's pass (or the front desk on this screen) proved; otherwise the same empty answer as a number nobody has. */
async function guestSummary(db: FirebaseFirestore.Firestore, tenantId: string, phone: string, proven: boolean) {
  const client: any = proven ? await findClientByPhone(db, tenantId, phone) : null;
  const perkRemaining = client ? await perkRemainingFor(db, tenantId, client) : {};
  let guest: any = null;
  if (client) {
    const card = client.cardOnFile || {};
    // Good through the last day of its month.
    const expiresAt = card.expMonth && card.expYear ? new Date(Number(card.expYear), Number(card.expMonth), 1) : null;
    const cardOk = !!(card.paymentMethodId && card.customerId) && !(expiresAt && !isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now());
    const mem: any = client.activeMembershipId && ID_RE.test(String(client.activeMembershipId)) ? (await db.doc(`tenants/${tenantId}/memberships/${client.activeMembershipId}`).get()).data() : null;
    guest = { firstName: clean(String(client.name || '').split(' ')[0], 30) || 'there', member: !!client.activeMembershipId, membershipName: mem ? clean(mem.name, 60) : null,
      card: cardOk ? { brand: clean(card.brand, 20) || 'Card', last4: clean(card.last4, 4) || '' } : null };
  }
  return { ok: true, perkRemaining, guest };
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
  const wantsMenu = req.nextUrl.searchParams.get('menu') === '1';
  const orderId = String(req.nextUrl.searchParams.get('order') || '');
  const limited = await limitPublic(req, wantsMenu ? 'concierge_menu' : orderId ? 'concierge_status' : phone ? 'concierge_perks' : 'concierge_board', tenantId,
    orderId ? { perHour: 900, perDay: 10000 } : { perHour: 240, perDay: 5000 });
  if (limited) return limited;
  try {
    const db = getAdminDb();
    const tSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tSnap.exists) return bad('Not found.', 404);

    // One order's progress (the station menu's done screen): its status, and whether someone has it in hand.
    if (orderId) {
      if (!/^kq_[a-f0-9]{24}$/.test(orderId)) return bad('Unknown order.', 404);
      const r: any = (await db.doc(`tenants/${tenantId}/refreshmentRequests/${orderId}`).get()).data();
      if (!r) return bad('Unknown order.', 404);
      return NextResponse.json({ ok: true, status: clean(r.status, 30), onItsWay: r.status === 'ready' && !!(r.bringingOutAt || r.carriedBy) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (wantsMenu) {
      const t: any = tSnap.data() || {};
      // A paused or closed business shows no menu (it takes no orders).
      { const closed = closedReply(t) || toolLocked(t, ['hospitality'], 'guest'); if (closed) return closed; }
      const inv = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(300).get();
      // Whether each can be made: by its recipe's ingredients when it has one, else its own count (lib/menu-stock).
      const stock = await stockNow(db, tenantId, inv.docs.map((d) => ({ id: d.id, i: d.data() || {} })), new Map(inv.docs.map((d) => [d.id, d.data() || {}])));
      const menu = inv.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((i) => onMenu(i))
        .map((i) => ({
          id: String(i.id), name: clean(i.name, 80), price: Math.max(0, num(i.price)),   // the price an order is charged at (POST below)
          section: clean(i.category, 40) || 'Menu', words: clean(i.description, 240) || null,
          imageUrl: typeof i.imageUrl === 'string' && /^https:\/\//.test(i.imageUrl) ? i.imageUrl : null,
          membersOnly: i.isMembersOnly === true, available: !!stock.get(String(i.id))?.inStock && orderable(i), soldOut: itemSoldOut(i),
          choices: choiceGroups(i),   // size, milk, extras (lib/menu-choices): priced again below when ordered
        }))
        .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
      const brand = t.kioskSettings?.primaryColor || t.bookingPage?.accent || t.brandColor || t.theme?.accent || null;
      const logo = guestLogo(t);
      return NextResponse.json({ ok: true, business: { name: clean(t.name || t.businessName, 80) || 'Menu', accent: typeof brand === 'string' && /^#[0-9a-f]{6}$/i.test(brand) ? brand : null,
        logoUrl: typeof logo === 'string' && /^https:\/\//.test(logo) ? logo : null }, menu },
        // A few seconds' sharing between guests at once; an order is checked against the menu as it is (POST below).
        { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' } });
    }

    if (phone) {
      // A phone number alone tells nothing: the counts (and whether it's a client at all) only for the code's pass for
      // that number, or with the front desk signed in here. Without either, the number isn't even looked up.
      const proven = checkGuestPass(tenantId, digits(phone).slice(-10), req.nextUrl.searchParams.get('pass')) || await deskSignedIn(req, tenantId);
      return NextResponse.json(await guestSummary(db, tenantId, phone, proven), { headers: { 'Cache-Control': 'no-store' } });
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
        onItsWay: r.status === 'ready' && !!(r.bringingOutAt || r.carriedBy),   // someone has it in hand
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
  if (body?.action === 'guest') {
    const limitedG = await limitPublic(req, 'concierge_perks', tenantId, { perHour: 240, perDay: 5000 }); if (limitedG) return limitedG;
    const ph = String(body?.phone || '');
    if (digits(ph).slice(-10).length !== 10) return bad('Enter your mobile number.');
    try {
      const db = getAdminDb();
      const proven = checkGuestPass(tenantId, digits(ph).slice(-10), body?.pass) || await deskSignedIn(req, tenantId);
      return NextResponse.json(await guestSummary(db, tenantId, ph, proven), { headers: { 'Cache-Control': 'no-store' } });
    } catch (e: any) { console.error('[concierge/requests guest]', e?.message); return bad('Something went wrong.', 500); }
  }
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
    // A paused or closed business takes no orders or payments (lib/tenant-open-server).
    // …and orders from a station tablet are part of Lounge & hospitality: off, they're not taken (lib/tool-lock).
    { const closed = closedReply(tenant) || toolLocked(tenant, ['hospitality'], 'guest'); if (closed) return closed; }

    // Asked again for an order already made (the answer to the first try was lost): that's the order, whatever has sold
    // out or changed on the menu since. Nothing below is checked again for it. (What it answers says nothing about the
    // guest, and the order's key is a long random one only their own screen ever had.)
    if (orderKey) {
      const made: any = (await db.doc(`tenants/${tenantId}/refreshmentRequests/${KQ(tenantId, orderKey)}`).get()).data();
      if (made && made.itemId === itemId) {
        return NextResponse.json({ ok: true, already: true, requestId: made.id || KQ(tenantId, orderKey), settledBy: made.settledBy ?? null, isRedemption: made.isRedemption === true,
          compedByRenter: made.compedByRenter === true, chargedToStation: made.chargedToStation === true, paidAtKiosk: made.paidAtKiosk === true,
          orderTotal: Number.isFinite(Number(made.orderTotal)) ? Number(made.orderTotal) : Math.round(num(made.priceAtRequest) * Math.max(1, num(made.quantity)) * 100) / 100 });
      }
    }

    // The item can't be ordered after all (sold out, or off the menu, since the first try). If their card was already
    // charged for this order and the order never got written, the payment goes back now and they're told so, rather
    // than a bare "sold out" while the money waits for the hourly sweep (lib/lounge-card).
    const cantOrder = async (error: string, status: number) => {
      if (orderKey) {
        const c0: any = (await cardOrderRef(db, tenantId, KQ(tenantId, orderKey)).get()).data() || null;
        if (c0 && ['charging', 'charged', 'refunding'].includes(String(c0.status)) && c0.piId) {
          const s0 = await settleCardOrder(db, tenantId, KQ(tenantId, orderKey), error).catch(() => 'failed');
          if (s0 === 'refunded') return NextResponse.json({ ok: false, restart: true, error: `${error} The payment went back to your card.` }, { status });
          if (s0 === 'failed') return NextResponse.json({ ok: false, restart: true, error: `${error} The payment is being returned to your card.` }, { status });
        }
      }
      return bad(error, status);
    };
    // The item, from this business's own menu.
    const iSnap = await db.doc(`tenants/${tenantId}/inventory/${itemId}`).get();
    const item: any = iSnap.exists ? iSnap.data() : null;
    if (!onMenu(item)) return cantOrder('That isn’t on the menu right now.', 404);
    if (!(await stockNow(db, tenantId, [{ id: itemId, i: item }])).get(itemId)?.inStock) return cantOrder('That’s sold out right now, sorry.', 409);
    if (itemSoldOut(item)) return cantOrder('That’s sold out right now, sorry.', 409);
    // Its choices, priced from the item itself (never a price from the browser): what they add is part of the price.
    const picked = priceChoices(item, body?.choices);
    if (!picked.ok) return cantOrder(picked.error, 400);
    const unitPrice = Math.max(0, Math.round((num(item.price) + picked.extra) * 100) / 100);
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

    // The order's own name (from the screen's), so asking again finds it, and its card claim (lib/lounge-card).
    const requestId = orderKey ? KQ(tenantId, orderKey) : nanoid();
    // The exact choices, so a card charge kept for this order is only ever used for the same drink (oat and almond can cost the same).
    const choiceKey = picked.lines.map((l) => `${l.groupId}:${l.optionId}`).sort().join(',');
    const claimRef = orderKey ? cardOrderRef(db, tenantId, requestId) : null;
    const claim: any = claimRef ? ((await claimRef.get()).data() || null) : null;
    // Charged here, but the order can't be written after all: the payment goes back to the card (lib/lounge-card).
    // The payment is named, so it goes back even when the claim never heard it was charged.
    const giveBack0 = async (pi: string, status: number, error: string) => {
      const s = await settleCardOrder(db, tenantId, requestId, error, { piId: pi }).catch(() => 'failed');
      if (s === 'ordered') return NextResponse.json({ ok: true, already: true, requestId, settledBy: 'card_on_file', isRedemption: false, compedByRenter: false, chargedToStation: false, paidAtKiosk: true, orderTotal });
      return NextResponse.json({ ok: false, restart: true, error: s === 'refunded' ? `${error} The payment went back to your card. Please place it again.`
        : s === 'failed' ? `${error} The payment is being returned to your card. Please place it again.`
        : `${error} Please ask anyone on the team, so they can check the payment.` }, { status });
    };
    if (claim && ['refunding', 'refunded'].includes(String(claim.status)))
      return NextResponse.json({ ok: false, restart: true, error: claim.status === 'refunded' ? 'We couldn’t place that order, so the payment went back to your card. Please place it again.' : 'We couldn’t place that order, so the payment is being returned to your card. Please place it again.' }, { status: 409 });
    // A card charge for this order that may have gone through: the same order is only ever tried on the card again.
    if (claim && ['charging', 'charged'].includes(String(claim.status)) && settleIn !== 'card_on_file')
      return NextResponse.json({ ok: false, sameWay: true, error: 'Your card payment for this order is still being checked. Try your card again, so you’re never charged twice.' }, { status: 409 });

    // ── How it settles — verified, never taken on the browser's word ──────────
    let settledBy: Settle = orderTotal > 0 ? settleIn : 'desk';
    let isRedemption = false, compedByRenter = false, chargedToStation = false, paidAtKiosk = false;
    let stripePaymentIntentId: string | null = null;
    let renterId: string | null = null;
    let compAllowance = 0;
    let stationOrderId = '';
    let ownCharge = false;   // charged here, just now: anything that stops the order from here on gives it back

    // A day guest checked in at the station pays for it themselves; otherwise the booth's resident renter is the payer.
    if (boothId && !reservationId) { const br = await boothRenter(db, tenantId, boothId); renterId = br?.renterId || null; }

    // A club perk or the host's allowance covers the item as it comes; choices that add to the price (a large, oat milk)
    // aren't part of it, so an order with those is paid for another way (the screen offers them).
    if ((settledBy === 'perk' || settledBy === 'renter_comp') && picked.extra > 0) {
      return bad(`Your choices add ${'$'}${picked.extra.toFixed(2)}, so this one isn’t included. Choose another way to pay.`, 409);
    }
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
      if (!br || br.compAllowance <= 0) return NextResponse.json({ ok: false, compUsedUp: true, error: 'There’s no complimentary allowance at this station now.' }, { status: 409 });
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
      let piId = String(body?.stripePaymentIntentId || '');
      const acct = String(tenant.stripeAccountId || '');
      if (!piId) {
        // The guest's own card on file, charged here (a guest's phone or a station tablet has no sign-in that may charge
        // a card): only for the guest the texted code proved, or with the front desk signed in on this screen. Never on
        // the station's link alone, even for someone here today. Under this order's name, so asking again is the same
        // charge. No answer: nothing is ordered, and trying again can't charge twice. Declined: nothing is ordered.
        if (!client || !(passOk || desk)) return needsCode('To use your card on file, enter the code we text to your phone.');
        const secret = process.env.CRON_SECRET;
        if (!orderKey || !claimRef || !secret || !acct) return bad('Card payments aren’t set up here. Pay when it arrives.', 400);
        if (Math.round(orderTotal * 100) < 50) return bad('Card payments start at $0.50. Choose pay when it arrives.', 400);
        const cents = Math.round(orderTotal * 100);
        // One step first, before any charge: an order already made under this name is that order (never a second
        // payment for it); a charge already made for it is used only for this guest and amount; a charge going through
        // right now isn't sent again; otherwise this request claims the charge.
        const reqRef0 = db.doc(`tenants/${tenantId}/refreshmentRequests/${requestId}`);
        const pre: any = await db.runTransaction(async (tx: any) => {
          const c: any = (await tx.get(claimRef)).data() || null; const o = await tx.get(reqRef0);
          if (o.exists) return { already: o.data() };
          if (c && ['refunding', 'refunded'].includes(String(c.status))) return { restart: true };
          if (c && c.status === 'charged' && c.piId) return Number(c.amountCents) === cents && c.clientId === client.id && c.itemId === itemId && Number(c.quantity) === quantity && String(c.choiceKey || '') === choiceKey ? { piId: String(c.piId) } : { mismatch: true };
          // Another request is charging it right now (one that ended without an answer can be asked again: same key).
          if (c && c.status === 'charging' && c.tryEnded !== true && Date.now() - Date.parse(String(c.at || '')) < 120000) return { busy: true };
          const nowC = new Date().toISOString();
          tx.set(claimRef, { status: 'charging', tryEnded: false, at: nowC, firstAt: c?.firstAt || nowC, clientId: client.id, clientName: clean(client.name, 60) || null, item: itemName, itemId, quantity, choiceKey, amountCents: cents, account: acct,
            customer: String(client.cardOnFile?.customerId || ''), chargeKey: `lounge-${orderKey}` }, { merge: true });
          return { go: true };
        });
        if (pre.already) {
          const r: any = pre.already;
          return NextResponse.json({ ok: true, already: true, requestId, settledBy: r.settledBy ?? null, isRedemption: r.isRedemption === true, compedByRenter: r.compedByRenter === true,
            chargedToStation: r.chargedToStation === true, paidAtKiosk: r.paidAtKiosk === true, orderTotal });
        }
        if (pre.restart) return NextResponse.json({ ok: false, restart: true, error: 'We couldn’t place that order, so the payment is being returned to your card. Please place it again.' }, { status: 409 });
        if (pre.busy) return NextResponse.json({ ok: false, sameWay: true, error: 'Your card payment is still going through. Try again in a moment; you won’t be charged twice.' }, { status: 503 });
        if (pre.mismatch) {
          // Charged for a different order under this name: that payment goes back, and the screen starts over.
          const s0 = await settleCardOrder(db, tenantId, requestId, 'a different order under the same name').catch(() => 'failed');
          return NextResponse.json({ ok: false, restart: true, error: s0 === 'refunded' ? 'That order changed, so its payment went back to your card. Please place it again.' : 'That order changed, so its payment is being returned to your card. Please place it again.' }, { status: 409 });
        }
        if (pre.piId) piId = pre.piId;   // charged already for this order
        else {
          const payload = { tenantId, clientId: client.id, amountCents: cents, description: `Lounge order — ${itemName} (x${quantity})`,
            category: 'Hospitality Revenue', appointmentId: null, reason: 'Lounge order (card on file)', mode: 'pos', idempotencyKey: `lounge-${orderKey}`, onLost: 'refund' };
          // The server's own card step, called directly (no trip over the network, so no address to trust).
          let status = 0; let cd: any = null;
          try {
            const res: any = await chargeSavedCard({ json: async () => payload, headers: new Headers({ 'content-type': 'application/json', 'x-cf-internal': secret }) } as any);
            status = Number(res?.status) || 200; cd = typeof res?.json === 'function' ? await res.json().catch(() => null) : res?.body;
          } catch (e: any) { console.error('[concierge/requests] card step', e?.message); cd = { unknown: true }; }
          // Still going through, or no answer: nothing ordered yet; the same order tried again is the same charge.
          if (!cd || cd.unknown === true || status >= 500 || status === 409) {
            await claimRef.set({ tryEnded: true }, { merge: true }).catch(() => undefined);
            return NextResponse.json({ ok: false, sameWay: true, error: status === 409 ? 'Your card payment is still going through. Try again in a moment; you won’t be charged twice.' : 'We couldn’t confirm the payment. Nothing was ordered yet; try again in a moment. You won’t be charged twice.' }, { status: 503 });
          }
          if (!cd.ok || !cd.paymentIntentId) {
            await claimRef.set({ status: 'declined' }, { merge: true }).catch(() => undefined);
            if (status === 401 || status === 400 || status === 404) return bad('Card payments aren’t set up here. Pay when it arrives.', 400);
            return NextResponse.json({ ok: false, declined: true, error: cd.requiresAction ? 'Your card needs to be confirmed with your bank. Choose another way to pay.' : 'Your card was declined. Choose another way to pay.' }, { status: 402 });
          }
          piId = String(cd.paymentIntentId);
          // Charged: from here on, anything that stops the order gives it back (giveBack, below, knows the payment even
          // if this note can't be saved).
          ownCharge = true;
          try { await claimRef.set({ status: 'charged', piId, chargedAt: new Date().toISOString() }, { merge: true }); }
          catch (e: any) { console.error('[concierge/requests] claim', e?.message); stripePaymentIntentId = piId; return giveBack0(piId, 503, 'That order didn’t go through.'); }
        }
        ownCharge = true;
      } else {
        // A payment the screen names (made elsewhere): checked with Stripe before it counts.
        if (!client || !/^pi_[A-Za-z0-9]+$/.test(piId)) return bad('No card payment to record.', 402);
        if (!acct || !process.env.STRIPE_SECRET_KEY) return bad('Card payments aren’t set up here.', 400);
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
        let pi: any = null;
        try { pi = await stripe.paymentIntents.retrieve(piId, {}, { stripeAccount: acct }); } catch { pi = null; }
        const ok = pi && pi.status === 'succeeded' && pi.metadata?.tenantId === tenantId && pi.metadata?.clientId === client.id
          && num(pi.amount_received) >= Math.round(orderTotal * 100);
        if (!ok) return bad('That card payment couldn’t be confirmed.', 402);
      }
      stripePaymentIntentId = piId; paidAtKiosk = true;
    }

    const giveBack = async (status: number, error: string) => (ownCharge && stripePaymentIntentId ? giveBack0(stripePaymentIntentId, status, error) : bad(error, status));
    try {
      if (stripePaymentIntentId) {
        // Orders from before payments were named after themselves are found by looking (newer ones are checked below).
        const used = await db.collection(`tenants/${tenantId}/refreshmentRequests`).where('stripePaymentIntentId', '==', stripePaymentIntentId).limit(1).get();
        if (!used.empty && used.docs[0].id !== requestId) return giveBack(409, 'That payment is already on another order.');
      }
      const priceAtRequest = (isRedemption || compedByRenter || chargedToStation || paidAtKiosk || settledBy === 'balance') ? 0 : unitPrice;
      const outSettled: 'card_on_file' | 'balance' | 'desk' | null =
        (isRedemption || compedByRenter || chargedToStation || orderTotal <= 0) ? null : (settledBy as any);

      // ── Written once, in one step ─────────────────────────────────────────────
      // The order is named after the screen's order name, so asking again finds it made. Whatever it uses is checked in
      // the same step: the station charge, the card payment (named after it, so it can't go on two orders), the club
      // allowance and the host's allowance (one order at a time per client, and per renter). A balance goes up only in
      // the step that writes the order, and its fee is named after the order.
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
        const claimNow: any = ownCharge && claimRef ? ((await tx.get(claimRef)).data() || null) : null;
        if (clientRef) await tx.get(clientRef);
        if (renterRef) await tx.get(renterRef);
        if (existing.exists) {
          // Made already under this name. Paid by this very charge: that's the order. Made another way (the answer to
          // it was lost and the guest then chose the card): this charge isn't needed, so it goes back.
          const ex: any = existing.data() || {};
          if (ownCharge && ex.stripePaymentIntentId !== stripePaymentIntentId) return { error: 'This order was already placed another way.', status: 409, otherWay: true };
          return { already: ex };
        }
        // Our own card charge: only while it's still charged for this order (not being given back).
        if (ownCharge && (!claimNow || claimNow.status !== 'charged' || claimNow.piId !== stripePaymentIntentId)) return { error: 'We couldn’t place that order.', status: 409, restart: true };
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
          if (usedToday >= compAllowance) return { error: 'Today’s complimentary allowance at this station is used.', status: 409, compUsedUp: true };
        }

        tx.set(reqRef, {
          id: requestId, tenantId,
          clientId: client?.id || 'guest-walkin',
          clientName,
          itemId, itemName, quantity,
          ...(picked.lines.length ? { choices: picked.lines, choicesText: picked.text } : {}),
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
          priceAtRequest, orderTotal,
          isGuestKiosk: true,
        });
        if (chargeRef) {
          tx.set(chargeRef, { requestId }, { merge: true });
          if (chargeLine?.exists) tx.update(chargeLineRef, { conciergeRequestId: requestId });
        }
        if (cardUseRef) tx.set(cardUseRef, { id: stripePaymentIntentId, requestId, at: nowIso });
        if (ownCharge && claimRef) tx.set(claimRef, { status: 'ordered', orderedAt: nowIso }, { merge: true });
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
      if (out?.compUsedUp) return NextResponse.json({ ok: false, compUsedUp: true, error: out.error }, { status: 409 });
      if (out?.error) return giveBack(out.status || 400, out.error);
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
      console.error('[concierge/requests POST order]', e?.message);
      return giveBack(500, 'That order didn’t go through.');
    }
  } catch (e: any) {
    console.error('[concierge/requests POST]', e?.message);
    return bad('That order didn’t go through — please ask the team.', 500);
  }
}
