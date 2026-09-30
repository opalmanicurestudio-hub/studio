// src/app/api/visit-rebook/route.ts — "BOOK YOUR NEXT VISIT" ON THE CLIENT'S VISIT LINK (after a finished visit).
// Public, but tied to one visit by its link: only a FINISHED visit from the last 90 days, and who / what / with whom
// always comes from that visit — never from the page. Every booking re-works out the plan (lib/rebook-actions), so it
// can't be steered to another service, provider or deposit. If they've already booked, it says so instead.
//   start { token } → the plan + best times · day { token, date, anyone? } → times · book { token, startIso, staffId?, deposit?, standing? }
//   waitlist { token, note? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { linkOrigin } from '@/lib/app-origin';
import { rebookSettingsOf } from '@/lib/client-screen';
import { rebookStart, rebookDay, rebookBook, rebookWaitlist } from '@/lib/rebook-actions';

export const dynamic = 'force-dynamic';
const TOKEN = /^[A-Za-z0-9_-]{6,80}$/;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || ''); const token = String(b.token || '');
  if (!TOKEN.test(token)) return bad('This link isn’t valid.');
  const db = getAdminDb();
  const ci: any = ((await db.doc(`appointmentCheckIns/${token}`).get()).data()) || null;
  if (!ci?.tenantId || !(ci.id || ci.appointmentId)) return bad('This link isn’t valid.', 404);
  const tenantId = String(ci.tenantId); const apptId = String(ci.id || ci.appointmentId);
  const appt: any = ((await db.doc(`tenants/${tenantId}/appointments/${apptId}`).get()).data()) || null;
  if (!appt || (appt.checkInToken && appt.checkInToken !== token)) return bad('This link isn’t valid.', 404);
  if (appt.status !== 'completed') return bad('You can book your next visit once this one is finished.', 409);
  if (Date.parse(appt.startTime) < Date.now() - 90 * 864e5) return bad('This link has expired — book from our booking page.', 410);
  const t: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const rs = rebookSettingsOf(t);
  if (!rs.on || !rs.visitLink) return bad('Online rebooking isn’t available here — use our booking page.', 403);
  if (!appt.clientId || !appt.serviceId) return bad('Book from our booking page.', 409);
  const ctx = { tenantId, clientId: String(appt.clientId), serviceId: String(appt.serviceId), staffId: appt.staffId ? String(appt.staffId) : null, addOnIds: Array.isArray(appt.addOnIds) ? appt.addOnIds : [], appointmentId: apptId };
  const internal = async (path: string, body: any) => { const secret = process.env.CRON_SECRET; if (!secret) return { ok: false, error: 'Online rebooking isn’t set up yet.' };
    return fetch(`${req.nextUrl.origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cf-internal': secret }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Couldn’t reach the booking service.' })); };
  const post = (path: string, body: any) => fetch(`${req.nextUrl.origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false }));

  if (action === 'start') { const r: any = await rebookStart(db, ctx, 'visit_link'); return NextResponse.json(r, { status: r.ok ? 200 : 400 }); }
  if (action === 'day') {
    // Only the plan's service and provider — worked out here from the visit, not sent by the page.
    const { engineFor, returnPlanOf } = await import('@/lib/rebook');
    const e = await engineFor(db, tenantId); const svc = e?.services.find((x: any) => x.id === ctx.serviceId); if (!e || !svc) return bad('Book from our booking page.');
    const plan = returnPlanOf(svc, e.services, rs.quickWeeks);
    const r: any = await rebookDay(db, tenantId, { serviceId: plan.serviceId, staffId: ctx.staffId, addOnIds: ctx.addOnIds }, String(b.date || ''), b.anyone === true && rs.otherProviders);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === 'book' || action === 'waitlist') {
    const start: any = await rebookStart(db, ctx, 'visit_link');
    if (!start.ok) return NextResponse.json(start, { status: 400 });
    if (start.rebook.stage === 'already') return NextResponse.json({ ok: true, rebook: start.rebook });
    if (action === 'waitlist') { const r: any = await rebookWaitlist(db, ctx, start.rebook, String(b.note || ''), post); return NextResponse.json(r.ok ? { ok: true, rebook: { ...start.rebook, stage: 'waitlisted' } } : r, { status: r.ok ? 200 : 400 }); }
    const r: any = await rebookBook(db, ctx, start.rebook, { startIso: String(b.startIso || ''), staffId: b.staffId ? String(b.staffId) : null, deposit: b.deposit ? String(b.deposit) : null, standing: b.standing === true }, internal, linkOrigin(t, req.nextUrl.origin));
    return NextResponse.json(r.ok ? r : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status || 400 });
  }
  return bad('Unknown action.');
}
