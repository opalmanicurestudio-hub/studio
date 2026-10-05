// src/app/api/clients/messages/route.ts — ONE CLIENT'S MESSAGES (staff only).
//   { action: 'list', clientId }                       → what the business sent (messageLog: channel, preview, delivery
//                                                         status, who it went to) + texts that came in from their number
//                                                         (smsInbox, matched on the last 10 digits), newest last
//   { action: 'send', clientId, text, channel?, subject? } → a one-off text or email through the shared sender (logged,
//                                                         policy-governed); text only when they haven't said no to texts
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { sendNotification } from '@/lib/notify';
export const dynamic = 'force-dynamic';
const s = (v: any, n = 200) => String(v ?? '').trim().slice(0, n);
const last10 = (v: any) => String(v || '').replace(/\D/g, '').slice(-10);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = s(b.tenantId, 80); const clientId = s(b.clientId, 120);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!clientId) return NextResponse.json({ ok: false, error: 'Which client?' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const client: any = (await db.doc(`${T}/clients/${clientId}`).get()).data();
  if (!client) return NextResponse.json({ ok: false, error: 'That client wasn’t found.' }, { status: 404 });

  if (b.action === 'list') {
    const out = (await db.collection(`${T}/messageLog`).where('clientId', '==', clientId).limit(150).get()).docs.map((d: any) => { const m: any = d.data() || {};
      return { id: d.id, dir: 'out', channel: m.channel, kind: m.kind || null, subject: m.subject || null, text: m.preview || null, at: m.sentAt || m.at || null, status: m.bouncedAt ? 'bounced' : m.deliveredAt ? 'delivered' : m.status || 'sent', to: m.recipientName || null, error: m.error || m.failureDetail || null }; });
    const digits = last10(client.phone); let inbound: any[] = [];
    if (digits.length === 10) inbound = (await db.collection(`${T}/smsInbox`).orderBy('at', 'desc').limit(300).get()).docs.map((d: any) => d.data() || {})
      .filter((m: any) => last10(m.from) === digits).map((m: any) => ({ id: m.id, dir: 'in', channel: 'sms', text: m.body || (m.mediaCount ? `${m.mediaCount} photo(s)` : ''), at: m.at, status: 'received' }));
    const rows = [...out, ...inbound].filter((r) => r.at).sort((x, y) => String(x.at).localeCompare(String(y.at)));
    return NextResponse.json({ ok: true, rows, canText: !!client.phone && client.smsConsent !== false && client.smsOptOut !== true, canEmail: !!client.email });
  }
  if (b.action === 'send') {
    const text = s(b.text, 1200); if (!text) return NextResponse.json({ ok: false, error: 'Write a message first.' }, { status: 400 });
    const canText = !!client.phone && client.smsConsent !== false && client.smsOptOut !== true;
    const channel: 'sms' | 'email' = b.channel === 'email' ? 'email' : b.channel === 'sms' ? 'sms' : canText ? 'sms' : 'email';
    if (channel === 'sms' && !canText) return NextResponse.json({ ok: false, error: client.phone ? 'They’ve asked not to get texts — send an email instead.' : 'No mobile number on file.' }, { status: 400 });
    if (channel === 'email' && !client.email) return NextResponse.json({ ok: false, error: 'No email address on file.' }, { status: 400 });
    const tenant: any = (await db.doc(T).get()).data() || {};
    const r: any = await sendNotification(db, { tenantId, channel, to: channel === 'sms' ? String(client.phone) : String(client.email), text, ...(channel === 'email' ? { subject: s(b.subject, 140) || `A message from ${tenant.name || 'us'}`, html: `<p>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]).replace(/\n/g, '<br>')}</p>` } : {}),
      kind: 'staff_message', clientId, clientName: client.name || null, recipientType: 'client', recipientId: clientId, recipientName: client.name || null } as any).catch((e: any) => ({ status: 'failed', error: String(e?.message || e) }));
    if (r?.status === 'failed') return NextResponse.json({ ok: false, error: r.error || 'It didn’t send.' }, { status: 502 });
    if (r?.status === 'skipped_no_provider') return NextResponse.json({ ok: false, error: channel === 'sms' ? 'Texting isn’t set up yet for this business.' : 'Email isn’t set up yet for this business.' }, { status: 400 });
    if (r?.status === 'skipped_by_policy') return NextResponse.json({ ok: false, error: 'Messages like this are switched off in your message settings.' }, { status: 400 });
    return NextResponse.json({ ok: true, channel, status: r?.status || 'sent' });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
