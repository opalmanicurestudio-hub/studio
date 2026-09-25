// src/app/api/support/route.ts
//
// THE HELP BUTTON — from inside a business's app to ClarityFlow HQ.
//
//   create  { tenantId, subject, message, kind, context } → a ticket with the
//           context attached (page, device, app version, recent errors), so
//           nobody has to ask "what were you doing?". HQ is emailed.
//   mine    { tenantId } → this business's requests and replies
//   reply   { tenantId, ticketId, message } → the business answers back
//
// Any signed-in owner or team member of the business can use it.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { platformAdminEmails } from '@/lib/platform-admin';
import { resolveFromAddress } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const db = getAdminDb();
  const at = new Date().toISOString();

  if (b.action === 'mine') {
    const snap = await db.collection('platformTickets').where('tenantId', '==', tenantId).limit(50).get();
    const tickets = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, c: any) => String(c.createdAt).localeCompare(String(a.createdAt)));
    return NextResponse.json({ ok: true, tickets: tickets.map((k: any) => ({ id: k.id, subject: k.subject, status: k.status, createdAt: k.createdAt, thread: k.thread || [], message: k.message })) });
  }

  if (b.action === 'reply') {
    const ref = db.doc(`platformTickets/${String(b.ticketId || '')}`);
    const k = ((await ref.get()).data() as any) || null;
    if (!k || k.tenantId !== tenantId) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    const message = String(b.message || '').trim().slice(0, 4000);
    if (!message) return NextResponse.json({ ok: false, error: 'Write a message first.' }, { status: 400 });
    await ref.set({ status: 'waiting_on_us', updatedAt: at, thread: [...(k.thread || []), { at, from: 'business', by: auth.actor.name || 'Owner', message }] }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  // create
  let actorEmail: string | null = null;
  try { actorEmail = (await getAdminAuth().getUser(auth.actor.uid)).email || null; } catch { /* no email on file */ }
  const subject = String(b.subject || '').trim().slice(0, 140);
  const message = String(b.message || '').trim().slice(0, 4000);
  if (message.length < 5) return NextResponse.json({ ok: false, error: 'Tell us a little more.' }, { status: 400 });
  const kind = ['broken', 'question', 'idea'].includes(b.kind) ? b.kind : 'question';
  const c = b.context || {};
  const context = {
    page: String(c.page || '').slice(0, 300), userAgent: String(req.headers.get('user-agent') || '').slice(0, 300),
    appVersion: String(c.appVersion || '').slice(0, 60), host: String(c.host || '').slice(0, 120),
    screen: String(c.screen || '').slice(0, 40), errors: Array.isArray(c.errors) ? c.errors.slice(-10).map((e: any) => ({ at: String(e.at || '').slice(0, 40), message: String(e.message || '').slice(0, 300), page: String(e.page || '').slice(0, 200) })) : [],
  };
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const ref = db.collection('platformTickets').doc();
  await ref.set({ id: ref.id, tenantId, tenantName: t.name || null, subject: subject || (kind === 'broken' ? 'Something isn’t working' : kind === 'idea' ? 'An idea' : 'A question'),
    message, kind, status: 'open', createdAt: at, updatedAt: at, contactEmail: actorEmail || null, contactName: auth.actor.name || null, contactUid: auth.actor.uid, context, thread: [] });

  const to = process.env.LEADS_NOTIFY_EMAIL || platformAdminEmails()[0];
  if (to && process.env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: resolveFromAddress(), to, ...(actorEmail ? { reply_to: actorEmail } : {}), subject: `Help · ${t.name || tenantId} · ${kind}`,
          text: `${message}\n\nFrom: ${auth.actor.name || ''} ${actorEmail || ''}\nPage: ${context.page}\nVersion: ${context.appVersion} on ${context.host}\n${context.errors.length ? `Recent errors:\n${context.errors.map((e: any) => `- ${e.message}`).join('\n')}` : 'No recent errors'}` }) });
    } catch { /* ticket is saved */ }
  }
  return NextResponse.json({ ok: true, id: ref.id });
}
