// src/app/api/appointments/late-options/route.ts — OFFER A LATE CLIENT THEIR CHOICES.
//   prepare — work them out and keep them for staff to send (Needs attention)
//   send    — work them out (or use the prepared ones) and tell the client; their
//             visit link shows the same choices. Nothing changes until they choose.
// Called by the server when a client reports running late (Booking policies →
// "Offer late clients their choices"), or by staff who may offer a reschedule.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { staffOrServer } from '@/lib/route-guard';
import { linkOrigin } from '@/lib/app-origin';
import { opsCan, opsLevelOf } from '@/lib/appointment-ops';
import { resolvePolicy } from '@/lib/booking-policies';
import { planLateChoices, lateChoicesText, lateChoicesWaitOf } from '@/lib/late-choices';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || ''), action = b.action === 'send' ? 'send' : 'prepare';
  if (!tenantId || !appointmentId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const ref = db.doc(`${T}/appointments/${appointmentId}`); const a: any = (await ref.get()).data();
  if (!a) return NextResponse.json({ ok: false, error: 'That appointment wasn’t found.' }, { status: 404 });
  // Server trigger (checkins) or staff who may offer a reschedule.
  const auth: any = await verifyStaffActor(req, tenantId).catch(() => ({ ok: false }));
  const byServer = !auth?.ok && await staffOrServer(req, tenantId);
  if (!byServer && !(auth?.ok && opsCan(auth.actor.role, opsLevelOf(tenant), a.staffId === auth.actor.uid, 'move'))) return NextResponse.json({ ok: false, error: 'You can’t send options for this booking.' }, { status: 403 });
  if (a.lateChoices?.status === 'sent' && action === 'send') return NextResponse.json({ ok: true, already: true });
  const plan = await planLateChoices(db, tenantId, appointmentId, a);
  if (!plan.needed) return NextResponse.json({ ok: true, needed: false });
  const nowIso = new Date().toISOString();
  const lc = { ...plan, status: action === 'send' ? 'sent' : 'prepared', at: nowIso, ...(action === 'send' ? { sentAt: nowIso, replyBy: new Date(Date.now() + lateChoicesWaitOf(tenant) * 60000).toISOString() } : {}), choice: null };
  await ref.set({ lateChoices: lc }, { merge: true });
  if (a.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set({ lateChoices: lc }, { merge: true }).catch(() => {}), db.doc(`${T}/appointmentCheckIns/${a.checkInToken}`).set({ lateChoices: lc }, { merge: true }).catch(() => {})]);
  let told = false;
  if (action === 'send') {
    try {
      const cl: any = a.clientId ? (((await db.doc(`${T}/clients/${a.clientId}`).get()).data() as any) || {}) : {};
      const email = String(cl.email || a.clientEmail || '').trim(), phone = String(cl.phone || a.clientPhone || '').trim();
      const prov: any = a.staffId ? (((await db.doc(`${T}/staff/${a.staffId}`).get()).data() as any) || {}) : {};
      const when = new Date(plan.etaAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined });
      const msg = lateChoicesText({ first: String(a.clientName || '').split(' ')[0] || 'there', lateMin: Number(a.lateTimeMinutes) || 0, graceMin: Number(resolvePolicy(tenant).late.graceMinutes.value) || 0, plan, providerFirst: prov.name ? String(prov.name).split(' ')[0] : null, when });
      const link = a.checkInToken ? `${linkOrigin(tenant, req.nextUrl.origin)}/check-in/${a.checkInToken}` : null;
      const { sendNotification } = await import('@/lib/notify'); const studio = tenant.name || 'the studio';
      if (phone) told = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'late_choices', text: `${studio}: ${msg}${link ? ` ${link}` : ''}`, appointmentId, clientId: a.clientId || null, clientName: a.clientName || null } as any))?.ok || told;
      if (!told && email.includes('@')) { const { brandedEmailHtml } = await import('@/lib/email-template');
        told = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `Running late — your options — ${studio}`, kind: 'late_choices', html: brandedEmailHtml({ studioName: studio, title: 'Your options for today', bodyLines: [msg], cta: link ? { label: 'Choose', url: link } : null }), appointmentId, clientId: a.clientId || null, clientName: a.clientName || null } as any))?.ok || told; }
    } catch (e) { console.error('[late-options] send failed', e); }
  }
  await logAuditAdmin(db, tenantId, { action: action === 'send' ? 'late.options_sent' : 'late.options_prepared', targetType: 'appointment', targetId: appointmentId,
    summary: `Running late — ${action === 'send' ? `options sent to the client${told ? '' : ' (not delivered — tell them yourself)'}` : 'options prepared for staff to send'}: ${plan.options.join(', ')}`,
    actor: byServer ? { type: 'system', name: 'Booking' } : { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
  return NextResponse.json({ ok: true, needed: true, options: plan.options, told, status: lc.status });
}
