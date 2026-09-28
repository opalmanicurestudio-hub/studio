// src/app/api/appointments/provider-offer/route.ts
//
// OFFER ANOTHER PROVIDER — with the client's consent.
// Staff (a manager — provider changes are a manager's call) offer a late
// client a different provider and time; the client accepts or declines from
// their visit link (/api/appt 'provider_offer_reply'). Nothing changes until
// they accept. The new provider must be free for the whole service.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { opsCan, opsLevelOf } from '@/lib/appointment-ops';
import { providerFree } from '@/lib/provider-availability';

export const dynamic = 'force-dynamic';


export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || ''), toStaffId = String(b.toStaffId || '');
  if (!tenantId || !appointmentId || !toStaffId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const ref = db.doc(`${T}/appointments/${appointmentId}`);
  const ap: any = ((await ref.get()).data() as any) || null;
  if (!ap) return NextResponse.json({ ok: false, error: 'That booking wasn’t found.' }, { status: 404 });
  if (!opsCan(auth.actor.role, opsLevelOf(tenant), ap.staffId === auth.actor.uid, 'switch')) return NextResponse.json({ ok: false, error: 'Provider changes are a manager’s call.' }, { status: 403 });
  if (toStaffId === ap.staffId) return NextResponse.json({ ok: false, error: 'That’s already their provider.' }, { status: 400 });
  const to: any = ((await db.doc(`${T}/staff/${toStaffId}`).get()).data() as any) || null;
  if (!to) return NextResponse.json({ ok: false, error: 'That provider wasn’t found.' }, { status: 404 });
  const durMs = Math.max(15 * 60000, (Date.parse(ap.endTime || ap.startTime) - Date.parse(ap.startTime)) || 60 * 60000);
  const startMs = Date.parse(String(b.startAt || ap.etaAt || ap.startTime));
  if (!Number.isFinite(startMs)) return NextResponse.json({ ok: false, error: 'Pick a start time.' }, { status: 400 });
  if (!(await providerFree(db, T, toStaffId, startMs, startMs + durMs, appointmentId))) return NextResponse.json({ ok: false, error: `${String(to.name || 'They').split(' ')[0]} isn’t free then.` }, { status: 409 });

  const nowIso = new Date().toISOString();
  const from: any = ap.staffId ? (((await db.doc(`${T}/staff/${ap.staffId}`).get()).data() as any) || {}) : {};
  const offer = { toStaffId, toStaffName: to.name || null, fromStaffId: ap.staffId || null, fromStaffName: from.name || null, startAt: new Date(startMs).toISOString(), at: nowIso, by: auth.actor.name, status: 'pending' };
  await ref.set({ providerOffer: offer }, { merge: true });
  if (ap.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${ap.checkInToken}`).set({ providerOffer: offer }, { merge: true }).catch(() => {}), db.doc(`${T}/appointmentCheckIns/${ap.checkInToken}`).set({ providerOffer: offer }, { merge: true }).catch(() => {})]);

  const when = new Date(startMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined });
  const first = String(ap.clientName || '').split(' ')[0] || 'there';
  const msg = `Hi ${first} — to fit you in, ${String(to.name || 'another of our team').split(' ')[0]} can see you at ${when}${from.name ? ` instead of ${String(from.name).split(' ')[0]}` : ''}. Would that work? Accept or decline with the link below.`;
  let told = false;
  if (b.tell !== false) {
    try {
      const base = linkOrigin(tenant, req.nextUrl.origin); const link = ap.checkInToken ? `${base}/check-in/${ap.checkInToken}` : null;
      const cl: any = ap.clientId ? (((await db.doc(`${T}/clients/${ap.clientId}`).get()).data() as any) || {}) : {};
      const email = String(cl.email || ap.clientEmail || '').trim(), phone = String(cl.phone || ap.clientPhone || '').trim();
      const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
      const studio = tenant.name || tenant.businessName || 'the studio';
      if (email.includes('@')) told = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `Another time option for today — ${studio}`, kind: 'provider_offer',
        html: brandedEmailHtml({ studioName: studio, title: 'Another option for today', bodyLines: [msg], cta: link ? { label: 'Accept or decline', url: link } : null }), appointmentId, clientId: ap.clientId || null, clientName: ap.clientName || null } as any))?.ok || told;
      if (phone) told = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'provider_offer', text: `${studio}: ${msg}${link ? ` ${link}` : ''}`, appointmentId, clientId: ap.clientId || null, clientName: ap.clientName || null } as any))?.ok || told;
    } catch (e) { console.error('[provider-offer] send failed', e); }
  }
  await logAuditAdmin(db, tenantId, { action: 'appointment.provider_offered', targetType: 'appointment', targetId: appointmentId,
    summary: `Offered ${to.name || 'another provider'} at ${when}${from.name ? ` instead of ${from.name}` : ''} — waiting for ${ap.clientName || 'the client'} to accept${told ? '' : ' (not messaged)'}`,
    actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } }).catch(() => {});
  return NextResponse.json({ ok: true, offer, told });
}
