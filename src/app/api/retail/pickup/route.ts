// src/app/api/retail/pickup/route.ts — BOOK THE USPS PICKUP. Staff who ship.
// POST { tenantId, action: 'status' } says what a booking now would be: the day it's for (the next day USPS works and
// the shop ships, lib/ship-run pickupDay), the USPS boxes waiting for the carrier that aren't on a pickup already,
// whether USPS will take the booking (it needs at least one Priority Mail, Priority Mail Express, international or return
// box), a regular pickup from the shipping schedule that makes booking unnecessary, the booking already made for that
// day, and today's pickup when one was booked.
// POST { tenantId, action: 'book', retry? } books it through Shippo for that day, 9 AM to 5 PM in the shop's own time
// zone at the ship-from address, with every USPS box waiting. USPS takes one booking a day and Shippo can't change or
// cancel one, so a day is never booked twice from here. The booking is kept at tenants/{t}/shipPickups/{day} (written
// by the server only), as one of:
//   booking    a booking under way: the day is taken in a transaction before Shippo is asked, so two taps can't both go
//   CONFIRMED  USPS confirmed it: the confirmation number and window
//   PENDING    Shippo took it and USPS hasn't confirmed yet: shown as requested
//   UNKNOWN    Shippo was asked and didn't answer, or the booking was cut off: it may well have gone through, so the
//              screen says to check with USPS first, and only `retry` (they checked, and it isn't booked) asks again
// A booking Shippo turned down outright frees the day to try again.
import { NextRequest, NextResponse } from 'next/server';
import { SHIP_DENIED, mayShip } from '@/lib/fulfilment-guard';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { shippoKeyFor } from '@/lib/retail-secrets';
import { labelInDoubt, trailStatus } from '@/lib/label-doubt';
import { liveSlots } from '@/lib/label-boxes';
import { scheduleFrom } from '@/lib/ship-promise';
import { dayKey, hasTimeZone, tenantTimeZone, wallToUtc } from '@/lib/tenant-time';
import { pickupDay, regularPickup, uspsPickupAllowed } from '@/lib/ship-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHIPPO = 'https://api.goshippo.com';
const timeout = (ms: number): AbortSignal | undefined => { try { return (AbortSignal as any).timeout(ms); } catch { return undefined; } };
/** A booking under way longer than this was cut off (well past the route's own time limit). */
const LOCK_MS = 90_000;
const HELD = ['CONFIRMED', 'PENDING', 'UNKNOWN'];

/** The USPS boxes still waiting for the carrier: labels bought here in the last few days, on orders packed or marked
 *  shipped, that the carrier hasn't scanned, and that aren't in doubt (lib/label-doubt). */
async function waitingBoxes(db: any, tenantId: string): Promise<{ orders: any[]; txns: string[]; recs: any[] }> {
  const since = new Date(Date.now() - 5 * 86400e3).toISOString();
  const snap = await db.collection(`tenants/${tenantId}/retailOrders`).where('packedAt', '>=', since).limit(500).get();
  const orders = snap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }))
    .filter((o: any) => o.method === 'ship' && ['packed', 'shipped'].includes(String(o.stage)) && /usps/i.test(String(o.carrier || ''))
      && o.shippoTransactionId && !o.labelFromOrderId && !o.shippedWithOrderId && !labelInDoubt(o) && ['', 'PRE_TRANSIT', 'UNKNOWN'].includes(trailStatus(o)));
  const txns = [...new Set(orders.flatMap((o: any) => liveSlots(o).map((s) => s.txn).filter(Boolean)))] as string[];
  const recIds = [...new Set(orders.flatMap((o: any) => (Array.isArray(o.labelRecs) ? o.labelRecs : []).map(String).filter(Boolean)))] as string[];
  const recs = recIds.length ? (await db.getAll(...recIds.slice(0, 200).map((id) => db.doc(`tenants/${tenantId}/shippingLabels/${id}`)))).filter((s: any) => s.exists).map((s: any) => s.data()) : [];
  return { orders, txns, recs };
}

/** A pickup record as the screen shows it; a booking cut off part way counts as not known. */
function shown(rec: any, now = Date.now()): any | null {
  if (!rec) return null;
  if (HELD.includes(String(rec.status))) return rec;
  if (rec.status === 'booking' && now - (Date.parse(String(rec.startedAt || '')) || 0) >= LOCK_MS) return { ...rec, status: 'UNKNOWN' };
  return null;
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim();
  const action = String(b.action || 'status');
  const retry = b.retry === true;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ error: 'Missing business.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!mayShip(auth.actor)) return NextResponse.json({ error: SHIP_DENIED }, { status: 403 });

  const db = getAdminDb();
  const tSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant: any = tSnap.exists ? tSnap.data() : {};
  const rs = tenant.retailSettings || {};
  const tz = tenantTimeZone(tenant);
  const zone = hasTimeZone(tenant);
  const schedule = scheduleFrom(rs);
  const today = dayKey(new Date(), tz);
  const day = pickupDay(today, schedule);
  const ref = db.doc(`tenants/${tenantId}/shipPickups/${day}`);
  const [daySnap, todaySnap] = await Promise.all([ref.get(), db.doc(`tenants/${tenantId}/shipPickups/${today}`).get()]);
  const booked = shown(daySnap.exists ? daySnap.data() : null);
  const todays = shown(todaySnap.exists ? todaySnap.data() : null);
  const { txns: all, recs } = await waitingBoxes(db, tenantId);
  // Boxes already on a pickup (today's, or the one booked for the day) go with that one. A booking USPS didn't answer
  // about isn't counted: booking it again (once someone has checked) is for the same boxes.
  const held = (r: any) => (r && r.status !== 'UNKNOWN' && Array.isArray(r.txns) ? r.txns : []);
  const onPickup = new Set([...held(todays), ...held(booked)].map(String));
  const txns = all.filter((t) => !onPickup.has(t));
  const services = recs.map((r: any) => String(r.service || ''));
  const allowed = uspsPickupAllowed(services);
  const regular = regularPickup(day, schedule);

  if (action === 'status') {
    return NextResponse.json({ ok: true, day, booking: booked, today: todays && todays.status !== 'UNKNOWN' ? todays : null, regular, boxes: txns.length, allowed, zone });
  }
  if (action !== 'book') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

  if (booked && booked.status !== 'UNKNOWN') return NextResponse.json({ ok: true, day, booking: booked, already: true });
  if (booked && !retry) return NextResponse.json({ error: 'A pickup for that day was asked for and USPS didn’t answer, so it may be booked already. Check with USPS first.', booking: booked, unknown: true }, { status: 409 });
  if (!zone) return NextResponse.json({ error: 'Set your shop’s time zone in Setup first, so the pickup window is in your hours.' }, { status: 409 });
  if (!txns.length) return NextResponse.json({ error: 'No USPS boxes are waiting for the carrier.' }, { status: 409 });
  if (!allowed) return NextResponse.json({ error: 'USPS only books a pickup when at least one box is Priority Mail. Drop these off, or hand them over at your next pickup.' }, { status: 409 });
  const from = rs.shipFrom || {};
  if (!from.street1 || !from.city || !from.state || !from.zip) return NextResponse.json({ error: 'Add your ship-from address in Setup first.' }, { status: 400 });
  if (!String(from.phone || '').replace(/\D/g, '')) return NextResponse.json({ error: 'Add a phone number to your ship-from address in Setup. USPS needs one to book a pickup.' }, { status: 400 });
  const apiKey = await shippoKeyFor(db, tenantId, tenant);
  if (!apiKey) return NextResponse.json({ error: 'Shipping labels aren’t connected yet. Add your Shippo key in Setup.' }, { status: 400 });

  // The USPS account the labels were bought on (from a label's rate).
  const rateId = String(recs.find((r: any) => r.rateId && !String(r.rateId).startsWith('boxes:'))?.rateId || '');
  let account = '';
  if (rateId) {
    try {
      const r = await fetch(`${SHIPPO}/rates/${encodeURIComponent(rateId)}`, { headers: { Authorization: `ShippoToken ${apiKey}` }, signal: timeout(10000) });
      const d: any = await r.json().catch(() => ({}));
      account = String(d?.carrier_account || '');
    } catch { /* below */ }
  }
  if (!account) return NextResponse.json({ error: 'Couldn’t find the USPS account these labels were bought on. Try again, or book the pickup on usps.com.' }, { status: 502 });

  // One booking a day: the day is taken in a transaction before Shippo is asked, so two taps can't both book.
  const at = new Date().toISOString();
  const taken = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref);
    const cur = s.exists ? s.data() : null;
    const seen = shown(cur);
    if (seen && seen.status !== 'UNKNOWN') return { existing: seen };
    if (cur && cur.status === 'booking' && !seen) return { busy: true };
    if (seen && !retry) return { unknown: seen };
    tx.set(ref, { day, status: 'booking', startedAt: at, by: auth.actor.name, txns: txns.slice(0, 200), boxes: txns.length });
    return { ok: true };
  }).catch(() => ({ failed: true }));
  if ('existing' in taken) return NextResponse.json({ ok: true, day, booking: taken.existing, already: true });
  if ('busy' in taken) return NextResponse.json({ error: 'A pickup for that day is being booked right now. Check again in a minute.' }, { status: 409 });
  if ('unknown' in taken) return NextResponse.json({ error: 'A pickup for that day was asked for and USPS didn’t answer, so it may be booked already. Check with USPS first.', booking: taken.unknown, unknown: true }, { status: 409 });
  if ('failed' in taken) return NextResponse.json({ error: 'That didn’t go through. Try again.' }, { status: 503 });

  const address = {
    name: String(from.name || tenant.businessName || tenant.name || 'Shop').replace(/[\/&*]/g, ' ').slice(0, 60),
    company: String(tenant.businessName || tenant.name || '').replace(/[\/&*]/g, ' ').slice(0, 60),
    street1: from.street1, street2: from.street2 || '', city: from.city, state: from.state, zip: from.zip, country: 'US',
    phone: String(from.phone || ''), email: String(from.email || '').replace(/[\/&*]/g, ''),
  };
  const asked = { day, startedAt: at, by: auth.actor.name, txns: txns.slice(0, 200), boxes: txns.length, carrier: 'USPS', timezone: tz };
  let res: Response | null = null; let d: any = {};
  try {
    res = await fetch(`${SHIPPO}/pickups/`, {
      method: 'POST', headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' }, signal: timeout(30000),
      body: JSON.stringify({
        carrier_account: account,
        location: { building_location_type: ['Front Door', 'Back Door', 'Side Door', 'Mail Room', 'Office', 'Shipping Dock'].includes(String(rs.pickupSpot)) ? rs.pickupSpot : 'Front Door', address },
        transactions: txns.slice(0, 200),
        requested_start_time: wallToUtc(day, 9, 0, tz).toISOString(),
        requested_end_time: wallToUtc(day, 17, 0, tz).toISOString(),
        metadata: `${txns.length} box${txns.length === 1 ? '' : 'es'}`,
      }),
    });
    d = await res.json().catch(() => ({}));
  } catch { res = null; }

  const status = String(d?.status || '').toUpperCase();
  const said = String(d?.detail || (Array.isArray(d?.messages) ? d.messages.map((m: any) => m?.text).filter(Boolean).join('; ') : '') || '').slice(0, 200);
  // Turned down outright: nothing was booked, so the day is free to try again. Turned down on a try after one USPS
  // didn't answer about: USPS takes one booking a day, so that often means the first went through. It stays not known.
  if (res && ((res.status >= 400 && res.status < 500 && res.status !== 408) || (res.ok && ['ERROR', 'CANCELLED'].includes(status)))) {
    if (retry) {
      const kept = { ...asked, status: 'UNKNOWN', askedAt: new Date().toISOString(), said, retryTurnedDown: true };
      await ref.set(kept).catch(() => {});
      return NextResponse.json({ error: `USPS turned this booking down${said ? ` (${said})` : ''}. USPS takes one pickup a day, so the first request may have gone through: check on usps.com before trying again.`, booking: kept, unknown: true }, { status: 409 });
    }
    await ref.delete().catch(() => {});
    return NextResponse.json({ error: `USPS didn’t take the booking${said ? `: ${said}` : ''}. Try again, or book it on usps.com.` }, { status: 422 });
  }
  // No answer, a timeout, or a server error that may have come after the booking was made: it may have gone through.
  const rec = !res || !res.ok
    ? { ...asked, status: 'UNKNOWN', askedAt: new Date().toISOString(), said }
    : { ...asked, status: status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING', confirmationCode: String(d.confirmation_code || ''),
      start: String(d.confirmed_start_time || d.requested_start_time || ''), end: String(d.confirmed_end_time || d.requested_end_time || ''), timezone: String(d.timezone || tz),
      shippoPickupId: String(d.object_id || ''), bookedAt: new Date().toISOString(), bookedBy: auth.actor.name };
  // Kept whatever happens to the answer: a booking USPS took is never forgotten because a save failed once.
  let saved = false;
  for (let i = 0; i < 3 && !saved; i++) {
    try { await ref.set(rec); saved = true; } catch { await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  if (!saved) console.error('[pickup] booking not saved', tenantId, day, rec.status, (rec as any).confirmationCode || '');
  if (rec.status === 'UNKNOWN') return NextResponse.json({ error: 'USPS didn’t answer in time, so the pickup may or may not be booked. Check with USPS before booking again.', booking: rec, unknown: true }, { status: 504 });
  return NextResponse.json({ ok: true, day, booking: rec });
}
