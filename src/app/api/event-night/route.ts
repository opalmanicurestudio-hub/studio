// src/app/api/event-night/route.ts — EVENT NIGHT (lib/event-night, lib/event-night-server; design canvas "Event night";
// the panel on the event's manifest page). The business's own team, signed in; the run of show is a manager's to set
// and to push.
//   view { tenantId, eventId, fresh? }          → the run of show, where the night is, course pacing and the prep
//                                                 (fresh: read again now, as after a course fires).
//   show { tenantId, eventId, show: Moment[] }  → the run of show, as a manager set it.
//   push { tenantId, eventId, minutes }         → everything still to come, that much later (5 to 60 minutes).
//   seats { tenantId, eventId, on, wholeTables } → guests choose their seats when buying tickets, and may buy a whole
//                                                 table (lib/event-seats); needs the event's seating chart.
//   door { tenantId, eventId, scan }            → Scan at the door (lib/event-pass): the party a guest's entry code is
//                                                 for (its QR, or its 4 digits: more than one party when they match).
//   doorIn { tenantId, eventId, partyId, guestIds? } → check them in (the places picked, or the whole party).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { PUSH_MAX, PUSH_MIN } from '@/lib/event-night';
import { eventNightFor, pushShow, saveSeatPicking, saveShow } from '@/lib/event-night-server';
import { doorFind, doorIn } from '@/lib/event-pass';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const eventId = String(b.eventId || ''); const action = String(b.action || 'view');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!ID.test(eventId)) return bad('Which event?');
  if (!['view', 'show', 'push', 'seats', 'door', 'doorIn'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, action === 'view' || action === 'door' || action === 'doorIn' ? 'staff' : 'manager'); if (g.deny) return g.deny;
  if (g.actor?.isRenter || g.actor?.role === 'renter') return bad('The event is the business’s own.', 403);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const manager = !!g.actor?.isTenantOwner || !!g.actor?.isManager || ['owner', 'admin', 'manager'].includes(String(g.actor?.role || '').toLowerCase());
  const by = String(g.actor?.name || 'Manager');
  try {
    // At the door: the team finds a party by its entry code and checks them in.
    if (action === 'door') { const r = await doorFind(db, tenantId, eventId, b.scan); return r.ok ? ok({ parties: r.parties }) : bad(r.error, r.status); }
    if (action === 'doorIn') { const r = await doorIn(db, tenantId, eventId, b.partyId, b.guestIds, String(g.actor?.name || 'Team')); return r.ok ? ok({ party: r.party, added: r.added }) : bad(r.error, r.status); }
    if (action === 'show') {
      const tenant: any = (await db.doc(T).get()).data() || {};
      const r = await saveShow(db, T, tenant, eventId, b.show, by);
      if (r === 'missing') return bad('That event isn’t here any more.', 404);
      if (!r) return bad('Each moment needs a time and what happens, a course only once, and no more than 20.');
      return ok({ show: r });
    }
    if (action === 'seats') {
      const r = await saveSeatPicking(db, T, eventId, b.on === true, b.wholeTables === true);
      if (r === 'missing') return bad('That event isn’t here any more.', 404);
      if (r === 'no_chart') return bad('Set up the seating chart first, with its tables and seats.', 409);
      return ok({});
    }
    if (action === 'push') {
      const m = Number(b.minutes);
      if (!Number.isInteger(m) || m < PUSH_MIN || m > PUSH_MAX) return bad(`Push by ${PUSH_MIN} to ${PUSH_MAX} minutes.`);
      const tenant: any = (await db.doc(T).get()).data() || {};
      const r = await pushShow(db, T, tenant, eventId, m, by);
      if (r === 'missing') return bad('That event isn’t here any more.', 404);
      return ok({ show: r });
    }
    const tenant: any = (await db.doc(T).get()).data() || {};
    const night = await eventNightFor(db, T, tenant, eventId, b.fresh === true);
    if (!night) return bad('That event isn’t here any more.', 404);
    return ok({ night, manager });
  } catch (e) {
    console.error('[event-night]', e);
    return bad('The event night couldn’t load just now. Try again in a moment.', 500);
  }
}
