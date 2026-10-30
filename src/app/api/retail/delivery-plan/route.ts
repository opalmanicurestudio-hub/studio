// /api/retail/delivery-plan — LOCAL DELIVERY, SET (lib/delivery-plan). The Ways to get an order screen reads and saves
// here: which ways checkout offers, the delivery zones and what each costs, the delivery windows and how many each can
// take, who drives, the same-day cutoff, "within N minutes", and where distance is measured from. The team can look;
// managers change it. Each part is saved on its own path, so a change here never undoes one made elsewhere.
//   GET  ?tenantId → { plan, shop, ways, mapsReady, places, team, shifts, booked, timeZone, zoneSet, canEdit }
//   POST { tenantId, plan }                         → saves the settings sent (only those)
//   POST { tenantId, ways: { pickup?, curbside?, shipping? } }
//   POST { tenantId, origin: { address } | { placeId } }   → where distance is measured from
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { planFrom } from '@/lib/pickup-slots';
import { shiftsFor } from '@/lib/pickup-slots-server';
import { cleanDelivery, deliveryFrom, deliveryProblems } from '@/lib/delivery-plan';
import { bookedDelivery, deliveryTeam, pinnedLocations } from '@/lib/delivery-server';
import { geocode, hasMapsKey, preciseEnough } from '@/lib/geocode-server';
import { methodWords } from '@/lib/order-method';
import { addDays, hasTimeZone, tenantTimeZone, todayIn } from '@/lib/tenant-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const SETTINGS = ['on', 'by', 'zones', 'days', 'slots', 'perWindow', 'perDriver', 'drivers', 'sameDayCutoff', 'daysAhead', 'asap', 'dropoffNotes', 'vehicles', 'proof', 'secondTry'] as const;
const plain = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const waysOf = (rs: any) => ({
  pickup: rs?.pickupEnabled !== false,
  curbside: rs?.curbsideOffered !== false,
  shipping: rs?.shippingOffered !== false && rs?.shippingEnabled !== false,
  curbsideName: methodWords('curbside', rs).long,
});

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  if (!ID.test(tenantId)) return NextResponse.json({ error: 'Missing business.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Please sign in again to see delivery settings.' : 'Only the shop’s team can see delivery settings.' }, { status: auth.status });
  // The team's names and shifts are on this screen: the shop's own team only, not renters.
  if (auth.actor?.isRenter) return NextResponse.json({ error: 'Only the shop’s team can see delivery settings.' }, { status: 403 });
  try {
    const db = getAdminDb();
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const rs = tenant.retailSettings || {};
    const plan = deliveryFrom(rs);
    const tz = tenantTimeZone(tenant);
    const today = todayIn(tz);
    const week = Array.from({ length: 8 }, (_, i) => addDays(today, i));
    const [booked, shifts, team, places] = await Promise.all([
      bookedDelivery(db, tenantId, today, addDays(today, 30), Date.now()),
      shiftsFor(db, tenantId, week),
      deliveryTeam(db, tenantId),
      pinnedLocations(db, tenantId),
    ]);
    // Who's on when, for the people on the team (the screen shows drivers by name); nobody else's shifts.
    const ids = new Set(team.map((t) => t.id));
    return NextResponse.json({
      plan, shop: planFrom(rs), ways: waysOf(rs), mapsReady: hasMapsKey(), places, team,
      shifts: shifts.filter((s) => ids.has(s.staffId)), booked, timeZone: tz, zoneSet: hasTimeZone(tenant), canEdit: !!auth.actor?.isManager,
    });
  } catch (e: any) {
    console.error('[delivery-plan] read', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: 'Delivery settings couldn’t be loaded.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim();
  if (!ID.test(tenantId)) return NextResponse.json({ error: 'Missing business.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Please sign in again to change delivery settings.' : 'Only a manager can change delivery settings.' }, { status: auth.status });
  if (!auth.actor?.isManager) return NextResponse.json({ error: 'Only a manager can change delivery settings.' }, { status: 403 });
  if ((b.plan !== undefined && !plain(b.plan)) || (b.ways !== undefined && !plain(b.ways)) || (b.origin !== undefined && !plain(b.origin))) {
    return NextResponse.json({ error: 'Those settings couldn’t be read. Reload and try again.' }, { status: 400 });
  }
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}`);

  // Where distance is measured from: one of the shop's pinned locations, or an address looked up now (and kept).
  let origin: any;
  if (plain(b.origin)) {
    if (b.origin.placeId) {
      const p = (await pinnedLocations(db, tenantId)).find((x) => x.id === String(b.origin.placeId));
      if (!p) return NextResponse.json({ error: 'That location has no pin on the map. Choose another, or type the address.' }, { status: 400 });
      origin = { lat: p.lat, lng: p.lng, label: p.address || p.name, source: 'location' };
    } else {
      const address = String(b.origin.address || '').trim();
      if (address.length < 5) return NextResponse.json({ error: 'Type the shop’s street address.' }, { status: 400 });
      if (!hasMapsKey()) return NextResponse.json({ error: 'Addresses can’t be looked up yet. Use postal-code zones for now.' }, { status: 400 });
      const g = await geocode(address, { keep: true });
      if (g === 'down') return NextResponse.json({ error: 'The map can’t be reached just now. Try again in a minute.' }, { status: 503 });
      if (!preciseEnough(g)) return NextResponse.json({ error: 'That address couldn’t be found on the map. Check the street and number, and try again.' }, { status: 422 });
      origin = { lat: g.lat, lng: g.lng, label: g.label, source: 'address' };
    }
  }

  try {
    const team = plain(b.plan) && has(b.plan, 'drivers') ? new Set((await deliveryTeam(db, tenantId)).map((t) => t.id)) : null;
    const out = await db.runTransaction(async (tx: any) => {
      const tenant: any = (await tx.get(ref)).data() || {};
      const rs = tenant.retailSettings || {};
      const saved = rs.deliveryPlan && plain(rs.deliveryPlan) ? rs.deliveryPlan : {};
      const patch: Record<string, any> = {};
      if (plain(b.plan) || origin) {
        // Checked and tidied by the same reader checkout uses, so what's kept is exactly what customers are offered.
        const raw: any = { ...saved };
        for (const k of SETTINGS) if (plain(b.plan) && has(b.plan, k)) raw[k] = b.plan[k];
        if (origin) raw.origin = origin;
        const next = cleanDelivery(raw);
        // Only people on the team drive (someone who has left drops off the list).
        if (team) next.drivers = next.drivers.filter((id) => team.has(id));
        // What someone drives is kept only while they're a driver.
        next.vehicles = Object.fromEntries(Object.entries(next.vehicles).filter(([id]) => next.drivers.includes(id)));
        // Zones or windows that contradict each other are never kept, and delivery that's on is never left in a state
        // checkout can't use (no zones, no windows, nowhere to measure from).
        const problems = deliveryProblems(next, { mapsReady: hasMapsKey() });
        if (problems.length) return { error: problems[0], status: 400 };
        const whole = JSON.parse(JSON.stringify(next));
        for (const k of SETTINGS) if (plain(b.plan) && has(b.plan, k)) patch[`retailSettings.deliveryPlan.${k}`] = whole[k];
        if (plain(b.plan) && has(b.plan, 'drivers')) patch['retailSettings.deliveryPlan.vehicles'] = whole.vehicles;
        if (origin) patch['retailSettings.deliveryPlan.origin'] = whole.origin;
        // Drivers who left come off even when the list itself wasn't what changed.
        if (team && !('retailSettings.deliveryPlan.drivers' in patch)) patch['retailSettings.deliveryPlan.drivers'] = whole.drivers;
        patch['retailSettings.deliveryPlan.savedAt'] = new Date().toISOString();
      }
      if (plain(b.ways)) {
        if (typeof b.ways.pickup === 'boolean') patch['retailSettings.pickupEnabled'] = b.ways.pickup;
        if (typeof b.ways.curbside === 'boolean') patch['retailSettings.curbsideOffered'] = b.ways.curbside;
        // Shipping has two older switches; both follow this one, so it's on or off everywhere.
        if (typeof b.ways.shipping === 'boolean') { patch['retailSettings.shippingOffered'] = b.ways.shipping; patch['retailSettings.shippingEnabled'] = b.ways.shipping; }
      }
      if (!Object.keys(patch).length) return { error: 'Nothing to change.', status: 400 };
      // Each part on its own path. A plan that isn't a map in its place (an old value) is replaced whole instead.
      if (rs.deliveryPlan !== undefined && !plain(rs.deliveryPlan)) {
        const whole: Record<string, any> = {};
        for (const [k, v] of Object.entries(patch)) if (k.startsWith('retailSettings.deliveryPlan.')) { whole[k.slice('retailSettings.deliveryPlan.'.length)] = v; delete patch[k]; }
        if (Object.keys(whole).length) patch['retailSettings.deliveryPlan'] = whole;
      }
      tx.update(ref, patch);
      return { ok: true };
    });
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status });
    const rs: any = ((await ref.get()).data() || {}).retailSettings || {};
    return NextResponse.json({ ok: true, plan: deliveryFrom(rs), ways: waysOf(rs) });
  } catch (e: any) {
    console.error('[delivery-plan] save', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: 'That didn’t save. Try again.' }, { status: 500 });
  }
}
