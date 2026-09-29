// src/app/api/appointments/book-many/route.ts — LINKED BOOKINGS, THROUGH THE ENGINE.
// Every part is booked by the shared booking engine (/api/appointments/book),
// acting as the signed-in staff member — never written from the browser.
//   series — a repeat booking (every N weeks). Each date on its own: a taken
//            date is skipped and reported. Only the first sends a confirmation.
//   group  — several guests together.      } all or nothing: messages are held
//   visit  — one guest, several providers. } until every part is booked; if any
//            part can't be booked, the parts already made are removed and nothing
//            is sent. On success, each booking's confirmation goes out.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { internalOrigin } from '@/lib/message-policy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), kind = String(b.kind || '');
  const items: any[] = Array.isArray(b.items) ? b.items.slice(0, 52) : [];
  if (!tenantId || !['series', 'group', 'visit'].includes(kind) || items.length < 1) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const origin = internalOrigin(tenant, req.nextUrl.origin);
  const authz = req.headers.get('authorization') || '';
  const linkId = `${kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const book = async (body: any) => {
    try {
      const r = await fetch(`${origin}/api/appointments/book`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authz }, body: JSON.stringify({ tenantId, source: 'front-desk', ...body }) });
      const data = await r.json().catch(() => ({})); return { ok: r.ok && !!data?.ok, data, status: r.status };
    } catch { return { ok: false, data: { error: 'Couldn’t reach the booking system.' }, status: 0 }; }
  };
  const actor = { type: 'user' as const, id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role };

  if (kind === 'series') {
    const results: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const r = await book({ ...items[i], seriesId: linkId, seriesIndex: i, quiet: i > 0 });
      results.push({ startTime: items[i].startTime, ok: r.ok, appointmentId: r.data?.appointmentId || null, error: r.ok ? null : r.data?.error || 'Not booked' });
    }
    const made = results.filter((x) => x.ok).length;
    await logAuditAdmin(db, tenantId, { action: 'appointment.series_booked', targetType: 'series', targetId: linkId, summary: `Repeat booking — ${made} of ${results.length} booked${made < results.length ? ` (${results.length - made} dates weren’t free)` : ''}`, actor }).catch(() => {});
    return NextResponse.json({ ok: made > 0, linkId, booked: made, results, ...(made ? {} : { error: results[0]?.error || 'None of those dates were free.' }) });
  }

  // group / visit — all or nothing
  const made: { appointmentId: string; checkInToken?: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const link = kind === 'group' ? { groupId: linkId, groupRole: i === 0 ? 'organizer' : 'guest', groupName: b.groupName || null } : { visitId: linkId, visitStep: i };
    const r = await book({ ...items[i], ...link, quiet: true });
    if (!r.ok) {
      // Undo the parts already made — nothing was sent for them.
      for (const m of made) {
        await db.doc(`${T}/appointments/${m.appointmentId}`).delete().catch(() => {});
        if (m.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${m.checkInToken}`).delete().catch(() => {}), db.doc(`${T}/appointmentCheckIns/${m.checkInToken}`).delete().catch(() => {})]);
      }
      const who = kind === 'group' ? (items[i]?.client?.name || `guest ${i + 1}`) : `step ${i + 1}`;
      const why = String(r.data?.error || 'not available').trim().replace(/[.!]+$/, '');
      return NextResponse.json({ ok: false, failedIndex: i, error: `Couldn’t book ${who}: ${why}. Nothing was booked.` }, { status: r.status === 409 ? 409 : 400 });
    }
    made.push({ appointmentId: r.data.appointmentId, checkInToken: r.data.checkInToken });
  }
  // Everything booked → now send the confirmations (a multi-provider visit is one client: one message).
  const toTell = kind === 'visit' ? made.slice(0, 1) : made;
  for (const m of toTell) {
    await fetch(`${origin}/api/notifications/resend-confirmation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: m.appointmentId }) }).catch(() => {});
  }
  await logAuditAdmin(db, tenantId, { action: kind === 'group' ? 'appointment.group_booked' : 'appointment.visit_booked', targetType: kind, targetId: linkId, summary: kind === 'group' ? `Group booking — ${made.length} guests${b.groupName ? ` (${b.groupName})` : ''}` : `Visit with ${made.length} providers`, actor }).catch(() => {});
  return NextResponse.json({ ok: true, linkId, booked: made.length, appointments: made });
}
