// src/app/api/appointments/recover-request/route.ts
//
// RECOVER STRANDED ONLINE BOOKINGS. Before 5a, an online booking with a
// deposit amount (e.g. approval mode + deposits) was saved as a
// bookingRequest and waited for a payment the client was told they didn't
// need — so no appointment was ever created and no screen showed it.
// The Requests page lists those; this route answers them:
//   accept  → books it through /api/appointments/book as a staff booking
//             (full clash check — if the time is gone, it says so), then
//             the client gets the normal confirmation
//   decline → marks it declined and tells the client kindly, with a link
//             to book again
// Same permission rules as Accept/Decline on requests.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor, decisionVerdict } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';
const tsIso = (v: any) => (v?.toDate ? v.toDate().toISOString() : typeof v === 'string' ? v : v?._seconds ? new Date(v._seconds * 1000).toISOString() : null);

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), requestId = String(b.requestId || ''), decision = b.decision === 'accept' ? 'accept' : b.decision === 'decline' ? 'decline' : '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(requestId) || !decision) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const actor = auth.actor;
  const verdict = decisionVerdict(actor, decision as 'accept' | 'decline', { policy: (auth.tenant as any)?.appointmentAuthority || null } as any);
  if (!verdict.allowed) return NextResponse.json({ ok: false, error: (verdict as any).reason || 'A manager needs to answer this one.' }, { status: 403 });

  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/bookingRequests/${requestId}`);
  const br = ((await ref.get()).data() as any) || null;
  if (!br) return NextResponse.json({ ok: false, error: 'That booking wasn’t found.' }, { status: 404 });
  if (br.status !== 'pending') return NextResponse.json({ ok: false, error: `Already ${br.status}.` }, { status: 409 });
  const t: any = auth.tenant || ((await db.doc(`tenants/${tenantId}`).get()).data() || {});
  const when = br.startTime ? new Date(br.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: t.timezone || t.timeZone || 'America/New_York' }) : 'the time you picked';
  const svc = br.serviceId ? (((await db.doc(`tenants/${tenantId}/services/${br.serviceId}`).get()).data() as any) || {}) : {};
  const svcName = svc.name || br.serviceName || 'your appointment';
  const actorRec = { type: 'user' as const, id: actor.uid, name: actor.name, role: actor.role, via: 'requests (recovered)' };

  if (decision === 'accept') {
    const { internalOrigin, internalPost } = await import('@/lib/message-policy');
    const r = await internalPost(internalOrigin(null, req.nextUrl.origin), '/api/appointments/book', { // our own host → recognised as a staff booking
      tenantId, source: 'manual', serviceId: br.serviceId, addOnIds: br.addOnIds || [], staffId: br.staffId || 'any', startTime: br.startTime,
      client: { name: br.clientName, email: br.clientEmail, phone: br.clientPhone || null, smsConsent: br.smsConsent === true, smsConsentText: br.smsConsentText || null },
      notes: br.notes || null, inspirationPhotoUrl: br.inspirationPhotoUrl || undefined, signedForms: Array.isArray(br.signedForms) ? br.signedForms : [],
    });
    const out: any = r.data || {};
    if (!r.ok || !out.ok) {
      const taken = r.status === 409 || /taken|conflict|overlap|booked|available/i.test(String(out.error || ''));
      return NextResponse.json({ ok: false, error: taken ? `That time (${when}) has since been taken — contact ${br.clientName || 'the client'} to pick another.` : (out.error || 'Couldn’t book it — try again.') }, { status: taken ? 409 : 502 });
    }
    await ref.set({ status: 'recovered', appointmentId: out.appointmentId, recoveredBy: actor.name || actor.uid, recoveredAt: new Date().toISOString() }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'booking.recovered', targetType: 'appointment', targetId: out.appointmentId, summary: `Recovered a stranded online booking — ${br.clientName || 'Guest'}, ${svcName}, ${when}`, actor: actorRec }).catch(() => {});
    return NextResponse.json({ ok: true, appointmentId: out.appointmentId, status: out.status });
  }

  await ref.set({ status: 'declined', declinedBy: actor.name || actor.uid, declinedAt: new Date().toISOString(), declineReason: String(b.reason || '').slice(0, 300) || null }, { merge: true });
  await logAuditAdmin(db, tenantId, { action: 'booking.recovered_declined', targetType: 'bookingRequest', targetId: requestId, summary: `Declined a stranded online booking — ${br.clientName || 'Guest'}, ${svcName}, ${when}`, actor: actorRec }).catch(() => {});
  if (br.clientEmail) {
    try {
      const { sendNotification } = await import('@/lib/notify');
      const { brandedEmailHtml } = await import('@/lib/email-template');
      const base = process.env.NEXT_PUBLIC_APP_URL || 'https://clarityflow.app';
      const first = String(br.clientName || '').split(' ')[0] || 'there';
      await sendNotification(db, { tenantId, channel: 'email', to: String(br.clientEmail), kind: 'booking_declined',
        subject: `About your booking request — ${t.name || 'we'}`,
        html: brandedEmailHtml({ studioName: t.name || 'Your studio', title: 'About your booking request',
          bodyLines: [`Hi ${first} — thank you for your request for ${svcName} on ${when}. We’re sorry, we can’t take that time.`, ...(b.reason ? [String(b.reason).slice(0, 300)] : []), 'Nothing was charged. We’d love to see you — please pick another time.'],
          cta: { label: 'Book another time', url: `${base}/book/${tenantId}` } }),
        recipientType: 'client', recipientName: br.clientName || null } as any);
    } catch (e) { console.error('[recover-request] decline email failed', e); }
  }
  return NextResponse.json({ ok: true });
}

/** Staff list: online bookings that never became appointments (older than 20 min — younger ones may still be paying). */
export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const db = getAdminDb(); const cutoff = Date.now() - 20 * 60000;
  const [q, paidLate] = await Promise.all([
    db.collection(`tenants/${tenantId}/bookingRequests`).where('status', '==', 'pending').limit(100).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`tenants/${tenantId}/appointments`).where('needsAttention', '==', 'deposit_paid_after_hold_released').limit(50).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const services = new Map<string, string>();
  const stranded = [];
  for (const d of q.docs) {
    const x = d.data() as any; const at = tsIso(x.createdAt);
    if (at && Date.parse(at) > cutoff) continue;
    if (x.serviceId && !services.has(x.serviceId)) services.set(x.serviceId, (((await db.doc(`tenants/${tenantId}/services/${x.serviceId}`).get()).data() as any)?.name) || 'Service');
    stranded.push({ id: d.id, clientName: x.clientName || 'Guest', clientEmail: x.clientEmail || null, clientPhone: x.clientPhone || null, serviceName: services.get(x.serviceId) || 'Service', startTime: x.startTime || null, createdAt: at, notes: x.notes || null, depositAmount: Number(x.depositAmount) || 0 });
  }
  stranded.sort((a: any, c: any) => String(a.startTime).localeCompare(String(c.startTime)));
  return NextResponse.json({ ok: true, stranded, paidLate: paidLate.docs.map((d: any) => { const a = d.data() as any; return { id: d.id, clientName: a.clientName, serviceName: a.serviceName, startTime: a.startTime, depositAmountCents: a.depositAmountCents }; }) });
}
