// src/app/api/appointments/meeting-link/route.ts — THIS BOOKING'S OWN ONLINE LINK.
// A service's meeting link is shared by every booking of it; staff can give one
// appointment its own (a private room), which then appears on the client's
// visit link and in their reminder. Optionally, the client is sent it now.
// An empty link clears it (back to the service's shared link). Staff only.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || '');
  if (!tenantId || !appointmentId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const raw = String(b.link || '').trim();
  if (raw && !/^https:\/\/[^\s]{4,}$/i.test(raw)) return NextResponse.json({ ok: false, error: 'Paste the full meeting link — it starts with https://' }, { status: 400 });
  const link = raw ? raw.slice(0, 500) : null;
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const ref = db.doc(`${T}/appointments/${appointmentId}`); const a: any = (await ref.get()).data();
  if (!a) return NextResponse.json({ ok: false, error: 'That appointment wasn’t found.' }, { status: 404 });
  const f = { meetingLink: link };
  await ref.set(f, { merge: true });
  if (a.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {}), db.doc(`${T}/appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {})]);
  let told = false;
  if (link && b.tell === true) {
    try {
      const tenant: any = ((await db.doc(T).get()).data() as any) || {};
      const cl: any = a.clientId ? (((await db.doc(`${T}/clients/${a.clientId}`).get()).data() as any) || {}) : {};
      const email = String(cl.email || a.clientEmail || '').trim(), phone = String(cl.phone || a.clientPhone || '').trim();
      const when = new Date(a.startTime).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined });
      const studio = tenant.name || 'the studio';
      const msg = `Hi ${String(a.clientName || '').split(' ')[0] || 'there'} — here’s your link for your online ${a.serviceName || 'appointment'} on ${when}: ${link}`;
      const visit = a.checkInToken ? `${linkOrigin(tenant, req.nextUrl.origin)}/check-in/${a.checkInToken}` : null;
      const { sendNotification } = await import('@/lib/notify');
      if (phone) told = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'meeting_link', text: `${studio}: ${msg}`, appointmentId, clientId: a.clientId || null, clientName: a.clientName || null } as any))?.ok || told;
      if (email.includes('@')) { const { brandedEmailHtml } = await import('@/lib/email-template');
        told = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `Your link for ${when} — ${studio}`, kind: 'meeting_link', html: brandedEmailHtml({ studioName: studio, title: 'Your appointment link', bodyLines: [msg, 'It’s also on your visit page, with a Join button.'], cta: { label: 'Join your appointment', url: link }, ...(visit ? { secondaryCta: { label: 'My visit page', url: visit } } : {}) } as any), appointmentId, clientId: a.clientId || null, clientName: a.clientName || null } as any))?.ok || told; }
    } catch (e) { console.error('[meeting-link] send failed', e); }
  }
  await logAuditAdmin(db, tenantId, { action: 'appointment.meeting_link', targetType: 'appointment', targetId: appointmentId,
    summary: link ? `Gave this appointment its own online link${told ? ' — sent to the client' : ''}` : 'Cleared this appointment’s own link (back to the service’s shared link)',
    actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } }).catch(() => {});
  return NextResponse.json({ ok: true, link, told });
}
