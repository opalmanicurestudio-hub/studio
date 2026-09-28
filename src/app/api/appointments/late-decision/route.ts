// src/app/api/appointments/late-decision/route.ts
//
// A CLIENT IS RUNNING LATE → WE DECIDE → THEY'RE TOLD, straight away.
// Used by the front desk (after its running-late panel saves) and the planner.
//   keep     — as planned
//   condense — a shorter visit (the add-ons the desk dropped)
//   switch   — another provider will look after them
//   move     — we can't keep this time; choose a new one (their visit link lets
//              them move it even past the usual cutoff / change limit — we asked)
// ("Not today" is a cancellation — the desk's cancel screen, which tells them.)
// Writes appointment.lateReply (the visit link shows it live), texts + emails
// the client with their visit link, and records it on the booking. Staff only.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { lateReplyText, LATE_OPTIONS as OPTIONS, type LateOption as Option } from '@/lib/late-reply';

export const dynamic = 'force-dynamic';


export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || '');
  const option = String(b.option || '') as Option;
  if (!tenantId || !appointmentId || !OPTIONS.includes(option)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const ref = db.doc(`${T}/appointments/${appointmentId}`);
  const ap: any = ((await ref.get()).data() as any) || null;
  if (!ap) return NextResponse.json({ ok: false, error: 'That booking wasn’t found.' }, { status: 404 });
  if (['completed', 'cancelled', 'no_show'].includes(String(ap.status || ''))) return NextResponse.json({ ok: false, error: 'That booking is already finished.' }, { status: 409 });
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const nowIso = new Date().toISOString();
  const by = { uid: auth.actor.uid, name: auth.actor.name };

  // The planner decides directly (keep / move) — record it the same way the desk does.
  const dec: any = ap.lateDecision && ap.lateDecision.option === option && Date.now() - Date.parse(ap.lateDecision.decidedAt || 0) < 10 * 60000 ? ap.lateDecision : null;
  if (!dec && (option === 'keep' || option === 'move')) await ref.set({ lateDecision: { option, minutesLate: Number(ap.lateTimeMinutes) || null, decidedAt: nowIso, decidedBy: by.name, via: 'planner' } }, { merge: true });

  const staffDoc = async (id?: string) => (id ? (((await db.doc(`${T}/staff/${id}`).get()).data() as any) || null) : null);
  const provider = await staffDoc(option === 'switch' ? (dec?.fromStaffId || ap.staffId) : ap.staffId);
  const toProvider = option === 'switch' ? await staffDoc(dec?.toStaffId || ap.staffId) : null;
  let dropped: string[] = [];
  if (option === 'condense' && Array.isArray(dec?.droppedAddOnIds)) for (const id of dec.droppedAddOnIds.slice(0, 6)) { const sv: any = (await db.doc(`${T}/services/${id}`).get()).data(); if (sv?.name) dropped.push(sv.name); }
  const etaIso = ap.etaAt || ap.clientEtaAt || (ap.startTime && ap.lateTimeMinutes ? new Date(Date.parse(ap.startTime) + Number(ap.lateTimeMinutes) * 60000).toISOString() : null);
  const eta = etaIso ? new Date(etaIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined }) : null;
  const first = String(ap.clientName || '').split(' ')[0] || 'there';
  const studio = tenant.name || tenant.businessName || 'the studio';
  const message = lateReplyText(option, { first, studio, provider: provider?.name ? String(provider.name).split(' ')[0] : null, eta, dropped,
    toProvider: toProvider?.name ? String(toProvider.name).split(' ')[0] : null, fee: Number(dec?.fee) || 0, note: typeof b.note === 'string' ? b.note.trim().slice(0, 240) : null });

  const replyFields = { lateReply: { kind: option, message, at: nowIso, by: by.name }, ...(option === 'move' ? { studioAskedToMove: true, studioAskedToMoveAt: nowIso } : { studioAskedToMove: false }) };
  await ref.set(replyFields, { merge: true });
  // The client's visit link watches its check-in copy — update it so they see the decision live.
  if (ap.checkInToken) await Promise.all([
    db.doc(`appointmentCheckIns/${ap.checkInToken}`).set(replyFields, { merge: true }).catch(() => {}),
    db.doc(`${T}/appointmentCheckIns/${ap.checkInToken}`).set(replyFields, { merge: true }).catch(() => {}),
  ]);

  // Tell them — text + email, with their visit link (the page shows the same message).
  const told = { email: false, sms: false };
  if (b.tell !== false) {
    try {
      const base = linkOrigin(tenant, req.nextUrl.origin);
      const link = ap.checkInToken ? `${base}/check-in/${ap.checkInToken}` : null;
      const cl: any = ap.clientId ? (((await db.doc(`${T}/clients/${ap.clientId}`).get()).data() as any) || {}) : {};
      const email = String(cl.email || ap.clientEmail || '').trim(), phone = String(cl.phone || ap.clientPhone || '').trim();
      const { sendNotification } = await import('@/lib/notify');
      const { brandedEmailHtml } = await import('@/lib/email-template');
      const title = option === 'move' ? 'Let’s find a new time' : 'We’ll see you soon';
      if (email.includes('@')) told.email = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `${title} — ${studio}`, kind: 'late_reply',
        html: brandedEmailHtml({ studioName: studio, title, bodyLines: [message], cta: link ? { label: option === 'move' ? 'Choose a new time' : 'My visit', url: link } : null }),
        appointmentId, clientId: ap.clientId || null, clientName: ap.clientName || null } as any))?.ok;
      if (phone) told.sms = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'late_reply', text: `${studio}: ${message}${link ? ` ${link}` : ''}`,
        appointmentId, clientId: ap.clientId || null, clientName: ap.clientName || null } as any))?.ok;
    } catch (e) { console.error('[late-decision] send failed', e); }
  }
  await logAuditAdmin(db, tenantId, { action: 'appointment.late_reply', targetType: 'appointment', targetId: appointmentId,
    summary: `Running late → ${option === 'move' ? 'asked them to choose a new time' : option === 'condense' ? 'shorter visit' : option === 'switch' ? 'another provider' : 'come in as planned'}. ${told.email || told.sms ? `Told by ${[told.email && 'email', told.sms && 'text'].filter(Boolean).join(' + ')}.` : b.tell === false ? 'Not messaged.' : 'No contact on file.'}`,
    actor: { type: 'user', id: by.uid, name: by.name, role: auth.actor.role, via: 'staff' } }).catch(() => {});
  return NextResponse.json({ ok: true, message, told });
}
