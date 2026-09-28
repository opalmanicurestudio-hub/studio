// src/app/api/appointments/provider-late/route.ts
//
// PROVIDER RUNNING LATE — protect the next guests.
// A provider (or a manager) says how far behind they are. We work out which of
// their next appointments today move, and by how much (cascading — a guest
// after a gap may be unaffected), then each affected guest gets a choice:
//   keep it (with the new estimated start) · reschedule (no fee, not counted) ·
//   cancel (no fee). Their visit link shows the same choice. The appointment
//   time itself is NOT changed — the new start is shown alongside it.
// minutes = 0 → back on time: clears it. Staff only; who can decide applies.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { opsCan, opsLevelOf, providerDelayImpact, canSendOverrun } from '@/lib/appointment-ops';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), staffId = String(b.staffId || '');
  const minutes = Math.max(0, Math.min(180, Math.round(Number(b.minutes) || 0)));
  if (!tenantId || !staffId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  // A service running over (the timer) may be sent by whoever the business allows (Booking policies).
  const overrun = b.reason === 'overrun';
  if (!opsCan(auth.actor.role, opsLevelOf(tenant), staffId === auth.actor.uid, 'provider_late') && !(overrun && canSendOverrun(tenant, auth.actor.role)))
    return NextResponse.json({ ok: false, error: overrun ? 'A manager sends the running-over message here.' : 'Only the provider or a manager can say they’re running late.' }, { status: 403 });
  // Told ONCE per running-over service (several devices may notice at the same moment).
  const inServiceRef = overrun && b.inServiceId ? db.doc(`${T}/appointments/${String(b.inServiceId)}`) : null;
  if (inServiceRef) {
    const cur: any = (await inServiceRef.get()).data() || {};
    if (cur.overrunNotifiedAt && Date.now() - Date.parse(cur.overrunNotifiedAt) < 45 * 60000) return NextResponse.json({ ok: true, already: true, affected: [] });
    await inServiceRef.set({ overrunNotifiedAt: new Date().toISOString(), overrunExtraMinutes: minutes }, { merge: true });
  }
  const provider: any = ((await db.doc(`${T}/staff/${staffId}`).get()).data() as any) || {};
  const pFirst = String(provider.name || 'Your provider').split(' ')[0];

  const now = new Date(); const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
  const q = await db.collection(`${T}/appointments`).where('staffId', '==', staffId).get();
  const todays = q.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((a: any) => { const s = Date.parse(a.startTime); return Number.isFinite(s) && s >= now.getTime() - 4 * 3600000 && s <= dayEnd.getTime(); });
  const active = todays.filter((a: any) => ['confirmed', 'pending_payment', 'deposit_pending', 'waiting', 'checked_in'].includes(String(a.status || '')));
  const inService = todays.find((a: any) => ['servicing', 'in_service'].includes(String(a.status || '')));
  const upcoming = active.filter((a: any) => Date.parse(a.startTime) >= now.getTime() - 60 * 60000);
  const nowIso = now.toISOString();
  const mirror = async (a: any, fields: any) => a.checkInToken && Promise.all([
    db.doc(`appointmentCheckIns/${a.checkInToken}`).set(fields, { merge: true }).catch(() => {}),
    db.doc(`${T}/appointmentCheckIns/${a.checkInToken}`).set(fields, { merge: true }).catch(() => {}),
  ]);

  // Back on time — clear it everywhere.
  if (minutes === 0) {
    for (const a of upcoming.filter((x: any) => x.providerDelay)) {
      const f = { providerDelay: null, providerLateMinutes: 0 };
      await db.doc(`${T}/appointments/${a.id}`).set(f, { merge: true }); await mirror(a, f);
    }
    await logAuditAdmin(db, tenantId, { action: 'provider.on_time', targetType: 'staff', targetId: staffId, summary: `${provider.name || 'Provider'} is back on time`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } }).catch(() => {});
    return NextResponse.json({ ok: true, affected: [] });
  }

  // When they're free: finishing the current guest late, or starting late.
  const firstStart = upcoming.length ? Math.min(...upcoming.map((a: any) => Date.parse(a.startTime))) : now.getTime();
  const freeAt = new Date(inService ? now.getTime() + minutes * 60000 : Math.max(now.getTime(), firstStart) + minutes * 60000);
  const durOf = (a: any) => Math.max(15, Math.round((Date.parse(a.endTime || a.startTime) - Date.parse(a.startTime)) / 60000) || 60);
  const impact = providerDelayImpact(upcoming, freeAt, durOf);

  const base = linkOrigin(tenant, req.nextUrl.origin);
  const studio = tenant.name || tenant.businessName || 'the studio';
  const told: string[] = [];
  const { sendNotification } = await import('@/lib/notify');
  const { brandedEmailHtml } = await import('@/lib/email-template');
  for (const { appt: a, delayMin, newStart } of impact) {
    const when = newStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined });
    const pd = { minutes: delayMin, newStartAt: newStart.toISOString(), at: nowIso, by: auth.actor.name, reply: null };
    const f = { providerDelay: pd, providerLateMinutes: delayMin };
    await db.doc(`${T}/appointments/${a.id}`).set(f, { merge: true }); await mirror(a, f);
    if (b.tell !== false) {
      const first = String(a.clientName || '').split(' ')[0] || 'there';
      const credit = Number(tenant.bookingPolicies?.providerDelayCredit) || 0;
      const msg = `Hi ${first} — ${pFirst} is running about ${delayMin} minutes behind today, so your appointment would start around ${when}. Choose what works for you: keep it, reschedule, or cancel with no fee.${credit > 0 ? ` If you’re happy to wait, we’ll add $${credit.toFixed(2)} credit to your account as a thank-you.` : ''}`;
      const link = a.checkInToken ? `${base}/check-in/${a.checkInToken}` : null;
      try {
        const cl: any = a.clientId ? (((await db.doc(`${T}/clients/${a.clientId}`).get()).data() as any) || {}) : {};
        const email = String(cl.email || a.clientEmail || '').trim(), phone = String(cl.phone || a.clientPhone || '').trim();
        let ok = false;
        if (email.includes('@')) ok = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `A quick update on today’s appointment — ${studio}`, kind: 'provider_late',
          html: brandedEmailHtml({ studioName: studio, title: 'A quick update on today', bodyLines: [msg], cta: link ? { label: 'Choose' , url: link } : null }), appointmentId: a.id, clientId: a.clientId || null, clientName: a.clientName || null } as any))?.ok || ok;
        if (phone) ok = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'provider_late', text: `${studio}: ${msg}${link ? ` ${link}` : ''}`, appointmentId: a.id, clientId: a.clientId || null, clientName: a.clientName || null } as any))?.ok || ok;
        if (ok) told.push(a.id);
      } catch (e) { console.error('[provider-late] send failed', e); }
    }
    await logAuditAdmin(db, tenantId, { action: 'appointment.provider_late', targetType: 'appointment', targetId: a.id,
      summary: `${overrun ? 'Service running over — ' : ''}${provider.name || 'Provider'} running ~${delayMin} min behind — new estimated start ${when}${told.includes(a.id) ? '; guest asked to choose (keep / reschedule / cancel, no fee)' : ''}`,
      actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } }).catch(() => {});
  }
  return NextResponse.json({ ok: true, affected: impact.map((x) => ({ id: x.appt.id, clientName: x.appt.clientName || null, delayMin: x.delayMin, newStartAt: x.newStart.toISOString(), told: told.includes(x.appt.id) })) });
}
