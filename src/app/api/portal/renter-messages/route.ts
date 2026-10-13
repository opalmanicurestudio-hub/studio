// src/app/api/portal/renter-messages/route.ts — A RENTER'S MESSAGES (design canvas RF5). Their clients' replies, routed
// to them by lib/renter-inbox, and their answers. Signed in with the renter portal's session token; a renter only ever
// sees their own conversations and can only write to their own clients or to someone already in a conversation with them.
//   list                      → conversations, newest first, with unread counts
//   read { key }              → mark a conversation read
//   send { key, body }        → reply (texting hours, opt-outs and the per-person limit are checked)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renterSession } from '@/lib/renter-session';
import { renterThreads, last10 } from '@/lib/renter-inbox';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120);
  const db = getAdminDb(); const s = await renterSession(db, tenantId, b.token);
  if (!s) return j({ ok: false, error: 'Please sign in again.' }, 401);
  const T = `tenants/${tenantId}`; const action = String(b.action || 'list'); const renterId = s.renterId;
  try {
    if (action === 'list') { const threads = await renterThreads(db, tenantId, renterId); return j({ ok: true, threads, unread: threads.reduce((n, t) => n + t.unread, 0) }); }
    const key = last10(b.key); if (key.length !== 10) return j({ ok: false, error: 'Please choose a conversation.' }, 400);
    const mine = (await db.collection(`${T}/renterInbox`).where('renterId', '==', renterId).get()).docs.map((d: any) => ({ ref: d.ref, ...(d.data() || {}) })).filter((m: any) => last10(m.phone) === key);
    if (action === 'read') { for (const m of mine) if (m.direction === 'in' && !m.read) await m.ref.update({ read: true }); return j({ ok: true }); }
    if (action === 'send') {
      const body = String(b.body || '').trim().slice(0, 600); if (!body) return j({ ok: false, error: 'Please write a message.' }, 400);
      const clients = (await db.collection(`${T}/clients`).where('ownerRenterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((c: any) => last10(c.phone) === key);
      if (!mine.length && !clients.length) return j({ ok: false, error: 'You can only message your own clients.' }, 403);
      const c: any = clients[0] || null;
      if (c?.smsOptOut || c?.smsConsent === false) return j({ ok: false, error: 'This client has opted out of texts. Please call instead.' }, 409);
      const tenant: any = (await db.doc(T).get()).data() || {};
      const { tenantTimeZone } = await import('@/lib/tenant-time'); const { inTextWindow } = await import('@/lib/campaigns');
      if (!inTextWindow(tenantTimeZone(tenant), new Date())) return j({ ok: false, error: 'It is outside texting hours (9:00 AM to 8:00 PM). Please send it in the morning, or call instead.' }, 409);
      const { renterVoice } = await import('@/lib/renter-comms'); const v = await renterVoice(db, tenantId, renterId);
      const { sendTenantSms } = await import('@/lib/sms');
      const name = c?.name || mine.find((m: any) => m.clientName)?.clientName || null; const clientId = c?.id || mine.find((m: any) => m.clientId)?.clientId || null;
      const r = await sendTenantSms(db, tenantId, `+1${key}`, `${v.renterName}: ${body}`, undefined, { kind: 'renter_message', recipientType: 'client', recipientId: clientId, recipientName: name, renterId } as any);
      if (!r.ok) return j({ ok: false, error: 'The text could not be sent. Please try again, or call instead.' }, 502);
      for (const m of mine) if (m.direction === 'in' && !m.read) await m.ref.update({ read: true });
      return j({ ok: true });
    }
    return j({ ok: false, error: 'Unknown action.' }, 400);
  } catch (e: any) { console.error('[renter-messages]', e); return j({ ok: false, error: 'That didn’t work. Please try again.' }, 500); }
}
