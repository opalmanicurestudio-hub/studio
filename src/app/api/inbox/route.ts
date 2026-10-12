// src/app/api/inbox/route.ts — EVERYTHING CLIENTS SEND US, IN ONE PLACE (staff only).
//   { action: 'list', filter?: 'unread' | 'all' | 'unknown' }  → recent texts and emails, newest first, with the client
//   { action: 'read', id }                                     → mark read (who and when)
//   { action: 'link', id, clientId }                           → this message is from that client (an unknown number or address)
//   { action: 'reply', id, text, subject? }                    → reply from the business's number or email, on the record
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { sendNotification } from '@/lib/notify';
import { canMessageClients } from '@/lib/privacy';
import { soundsLikeComplaint } from '@/lib/complaint-detect';
export const dynamic = 'force-dynamic';
const s = (v: any, n = 200) => String(v ?? '').trim().slice(0, n);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = s(b.tenantId, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  const who = { id: auth.actor.uid, name: auth.actor.name || null };

  if (b.action === 'list') {
    const snap = await db.collection(`${T}/smsInbox`).orderBy('at', 'desc').limit(300).get();
    let items = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
      .filter((m: any) => !['tech', 'renter'].includes(String(m.senderType || '')))   // maintenance and renter texts live on their own screens
      .map((m: any) => ({ id: m.id, at: m.at, channel: m.channel === 'email' ? 'email' : m.channel === 'app' ? 'app' : 'sms', from: m.from || null, appointmentId: m.appointmentId || null, fromName: m.fromName || null, clientId: m.clientId || null, clientName: m.clientName || null,
        subject: m.subject || null, body: m.body || null, mediaCount: m.mediaCount || 0, readAt: m.readAt || null, readBy: m.readBy || null, repliedAt: m.repliedAt || null, repliedBy: m.repliedBy || null,
        via: m.via || null, actionTaken: m.actionTaken || null, complaint: m.complaint ? { match: true, safety: !!m.complaint.safety } : soundsLikeComplaint(m.body) }));
    if (b.filter === 'unread') items = items.filter((m: any) => !m.readAt);
    if (b.filter === 'unknown') items = items.filter((m: any) => !m.clientId);
    return NextResponse.json({ ok: true, items, unread: items.filter((m: any) => !m.readAt).length });
  }
  // "Send their link": the client's visit link for their next appointment, opened to an action (cancel, reschedule, message…).
  if (b.action === 'link_for') {
    const clientId = s(b.clientId, 120); const act = ['cancel', 'reschedule', 'message', 'confirm', 'late'].includes(b.do) ? b.do : '';
    const appts = (await db.collection(`${T}/appointments`).where('clientId', '==', clientId).limit(100).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
      .filter((a: any) => ['confirmed', 'pending_payment', 'deposit_pending', 'requested', 'waiting', 'checked_in'].includes(String(a.status || '')) && Date.parse(a.startTime) > Date.now() - 2 * 3600e3 && a.checkInToken)
      .sort((x: any, y: any) => Date.parse(x.startTime) - Date.parse(y.startTime));
    if (!appts.length) return NextResponse.json({ ok: false, error: 'This client has no upcoming appointment, so there’s no visit link to send.' }, { status: 404 });
    const tenant: any = (await db.doc(T).get()).data() || {}; const { internalOrigin } = await import('@/lib/message-policy');
    const base = internalOrigin(tenant, req.nextUrl.origin) || req.nextUrl.origin;
    return NextResponse.json({ ok: true, url: `${base}/check-in/${appts[0].checkInToken}${act ? `?do=${act}` : ''}` });
  }
  const ref = db.doc(`${T}/smsInbox/${s(b.id, 120)}`); const m: any = (await ref.get()).data();
  if (!m) return NextResponse.json({ ok: false, error: 'That message was not found.' }, { status: 404 });
  if (b.action === 'read') { if (!m.readAt) await ref.set({ readAt: nowIso, readBy: who }, { merge: true }); return NextResponse.json({ ok: true }); }
  if (b.action === 'link') {
    const c: any = (await db.doc(`${T}/clients/${s(b.clientId, 120)}`).get()).data();
    if (!c) return NextResponse.json({ ok: false, error: 'Please choose a client.' }, { status: 400 });
    await ref.set({ clientId: s(b.clientId, 120), clientName: c.name || null, senderType: 'client', linkedBy: who, linkedAt: nowIso }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'reply') {
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (!canMessageClients(tenant, auth.actor.isTenantOwner ? 'owner' : auth.actor.role)) return NextResponse.json({ ok: false, error: 'Messaging clients is switched off for staff in this business.' }, { status: 403 });
    const text = s(b.text, 1600); if (!text) return NextResponse.json({ ok: false, error: 'Please write a reply first.' }, { status: 400 });
    // A message from the visit link or app: the reply shows there (and on their phone); a text follows if it isn't seen in 10 minutes.
    if (m.channel === 'app') {
      if (!m.clientId) return NextResponse.json({ ok: false, error: 'Please link this message to a client first.' }, { status: 400 });
      const { replyInApp } = await import('@/lib/client-messages'); await replyInApp(db, tenantId, m, text, who);
      await ref.set({ repliedAt: nowIso, repliedBy: who, ...(m.readAt ? {} : { readAt: nowIso, readBy: who }) }, { merge: true });
      return NextResponse.json({ ok: true, status: 'sent', inApp: true });
    }
    const email = m.channel === 'email'; const to = String(m.from || ''); if (!to) return NextResponse.json({ ok: false, error: 'There is no address to reply to.' }, { status: 400 });
    if (!email && m.clientId) { const c: any = (await db.doc(`${T}/clients/${m.clientId}`).get()).data() || {}; if (c.smsOptOut === true) return NextResponse.json({ ok: false, error: 'This client has asked not to receive texts.' }, { status: 400 }); }
    const r: any = await sendNotification(db, { tenantId, channel: email ? 'email' : 'sms', to, text, ...(email ? { subject: s(b.subject, 140) || (m.subject ? (/^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`) : `A message from ${tenant.name || 'us'}`) } : {}),
      kind: 'staff_message', clientId: m.clientId || null, clientName: m.clientName || null, recipientType: m.clientId ? 'client' : 'other', recipientId: m.clientId || null, recipientName: m.clientName || m.fromName || null, sentBy: who } as any)
      .catch((e: any) => ({ status: 'failed', error: String(e?.message || e) }));
    if (r?.status === 'failed') return NextResponse.json({ ok: false, error: r.error || 'The reply could not be sent.' }, { status: 502 });
    if (r?.status === 'skipped_no_provider') return NextResponse.json({ ok: false, error: email ? 'Email is not set up yet for this business.' : 'Texting is not set up yet for this business.' }, { status: 400 });
    await ref.set({ repliedAt: nowIso, repliedBy: who, ...(m.readAt ? {} : { readAt: nowIso, readBy: who }) }, { merge: true });
    return NextResponse.json({ ok: true, status: r?.status || 'sent' });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
