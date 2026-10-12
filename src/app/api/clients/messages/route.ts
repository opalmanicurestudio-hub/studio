// src/app/api/clients/messages/route.ts — ONE CLIENT'S MESSAGES (staff only).
//   { action: 'list', clientId }                       → the client's whole conversation record, oldest first (lib/conversation)
//   { action: 'export', clientId }                     → the same, as a spreadsheet (CSV)
//   { action: 'send', clientId, text, channel?, subject? } → a one-off text or email through the shared sender (logged,
//                                                         policy-governed); text only when they haven't said no to texts
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { sendNotification } from '@/lib/notify';
import { canMessageClients } from '@/lib/privacy';
import { soundsLikeComplaint } from '@/lib/complaint-detect';
export const dynamic = 'force-dynamic';
const s = (v: any, n = 200) => String(v ?? '').trim().slice(0, n);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = s(b.tenantId, 80); const clientId = s(b.clientId, 120);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!clientId) return NextResponse.json({ ok: false, error: 'Please choose a client.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const client: any = (await db.doc(`${T}/clients/${clientId}`).get()).data();
  if (!client) return NextResponse.json({ ok: false, error: 'We could not find that client.' }, { status: 404 });

  if (b.action === 'list' || b.action === 'export') {
    // The whole conversation record (lib/conversation): texts and emails both ways, staff threads, calls, the
    // receptionist's actions, notes, courtesies and cancellation decisions.
    const { conversationFor, conversationCsv } = await import('@/lib/conversation');
    const manager = !!auth.actor.isTenantOwner || ['owner', 'admin', 'manager'].includes(String(auth.actor.role || '').toLowerCase());
    const items = await conversationFor(db, tenantId, { ...client, id: clientId }, { viewer: { uid: auth.actor.uid, manager } });
    if (b.action === 'export') return NextResponse.json({ ok: true, filename: `conversation-${String(client.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, csv: conversationCsv(client, items) });
    const rows = items.map((x: any) => ({ ...x, channel: x.type === 'email' ? 'email' : x.type === 'text' ? 'sms' : x.type,
      complaint: x.dir === 'in' && x.type !== 'call' ? (x.complaint ? { match: true, safety: !!x.complaint.safety } : soundsLikeComplaint(x.text)) : null }));
    return NextResponse.json({ ok: true, rows, canText: !!client.phone && client.smsConsent !== false && client.smsOptOut !== true, canEmail: !!client.email });
  }
  if (b.action === 'send') {
    const tenantDoc: any = (await db.doc(T).get()).data() || {};
    if (!canMessageClients(tenantDoc, auth.actor.isTenantOwner ? 'owner' : auth.actor.role)) return NextResponse.json({ ok: false, error: 'Messaging clients is switched off for staff in this business.' }, { status: 403 });
    const text = s(b.text, 1200); if (!text) return NextResponse.json({ ok: false, error: 'Please write a message first.' }, { status: 400 });
    const canText = !!client.phone && client.smsConsent !== false && client.smsOptOut !== true;
    const channel: 'sms' | 'email' = b.channel === 'email' ? 'email' : b.channel === 'sms' ? 'sms' : canText ? 'sms' : 'email';
    if (channel === 'sms' && !canText) return NextResponse.json({ ok: false, error: client.phone ? 'This client has asked not to receive texts. Please send an email instead.' : 'There is no mobile number on file.' }, { status: 400 });
    if (channel === 'email' && !client.email) return NextResponse.json({ ok: false, error: 'There is no email address on file.' }, { status: 400 });
    const tenant: any = tenantDoc;
    const r: any = await sendNotification(db, { tenantId, channel, to: channel === 'sms' ? String(client.phone) : String(client.email), text, ...(channel === 'email' ? { subject: s(b.subject, 140) || `A message from ${tenant.name || 'us'}`, html: `<p>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]).replace(/\n/g, '<br>')}</p>` } : {}),
      kind: 'staff_message', clientId, clientName: client.name || null, recipientType: 'client', recipientId: clientId, recipientName: client.name || null, sentBy: { id: auth.actor.uid, name: auth.actor.name || null } } as any).catch((e: any) => ({ status: 'failed', error: String(e?.message || e) }));
    if (r?.status === 'failed') return NextResponse.json({ ok: false, error: r.error || 'The message could not be sent.' }, { status: 502 });
    if (r?.status === 'skipped_no_provider') return NextResponse.json({ ok: false, error: channel === 'sms' ? 'Texting is not set up yet for this business.' : 'Email is not set up yet for this business.' }, { status: 400 });
    if (r?.status === 'skipped_by_policy') return NextResponse.json({ ok: false, error: 'Messages like this are switched off in your message settings.' }, { status: 400 });
    return NextResponse.json({ ok: true, channel, status: r?.status || 'sent' });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
