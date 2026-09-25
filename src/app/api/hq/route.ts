// src/app/api/hq/route.ts
//
// CLARITYFLOW HQ — the platform side. PLATFORM_ADMIN_EMAILS only.
//
//   whoami          → is the signed-in person an HQ admin? (shows the HQ link)
//   tenants         → every business with its signals, setup and health
//   tenant {id}     → one business: signals, setup steps, health reasons,
//                     owner, tools, and a TIMELINE (bookings, messages,
//                     audit history, help requests), newest first
//   tickets         → the help inbox (all businesses)
//   ticket-reply    → { ticketId, message, status? } — saved + emailed
//   ticket-status   → { ticketId, status }
//
// Counts use Firestore count() so the directory stays quick as it grows.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { verifyPlatformAdmin } from '@/lib/platform-admin';
import { healthScore, setupScore, type TenantSignals } from '@/lib/hq-health';
import { fromTenantModules } from '@/lib/module-catalog';
import { resolveFromAddress } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const DAY = 86400000;

async function count(q: any): Promise<number> { try { return (await q.count().get()).data().count; } catch { return 0; } }

async function signals(db: any, t: any, lastSignIn: string | null): Promise<TenantSignals> {
  const base = `tenants/${t.id}`;
  const now = Date.now();
  const d7 = new Date(now - 7 * DAY).toISOString(), d14 = new Date(now - 14 * DAY).toISOString();
  const appts = db.collection(`${base}/appointments`);
  const msgs = db.collection(`${base}/messageLog`);
  // Single-field queries only, so no composite indexes are needed: this
  // week's messages and this business's tickets are read and tallied here.
  const [services, clients, staff, appointmentsTotal, bookings7d, bookings14d, msgWeek, tickets] = await Promise.all([
    count(db.collection(`${base}/services`)), count(db.collection(`${base}/clients`)), count(db.collection(`${base}/staff`)),
    count(appts), count(appts.where('createdAt', '>=', d7)), count(appts.where('createdAt', '>=', d14)),
    msgs.where('sentAt', '>=', d7).select('status').limit(2000).get().then((r: any) => r.docs.map((d: any) => (d.data() as any).status)).catch(() => [] as string[]),
    db.collection('platformTickets').where('tenantId', '==', t.id).select('status').limit(200).get().then((r: any) => r.docs.map((d: any) => (d.data() as any).status)).catch(() => [] as string[]),
  ]);
  const sent7 = (msgWeek as string[]).filter((x) => x === 'sent').length;
  const failed7 = (msgWeek as string[]).filter((x) => x === 'failed').length;
  const openTickets = (tickets as string[]).filter((x) => x === 'open' || x === 'waiting_on_us').length;
  return {
    services, clients, staff, appointmentsTotal, bookings7d, bookingsPrev7d: Math.max(0, bookings14d - bookings7d),
    messagesSent7d: sent7, messagesFailed7d: failed7, openTickets,
    daysSinceOwnerSignIn: lastSignIn ? Math.floor((now - new Date(lastSignIn).getTime()) / DAY) : null,
    stripeConnected: !!(t.stripeAccountId && t.stripeChargesEnabled !== false),
    active: t.subscriptionStatus === 'active', teamSize: t.teamSize || 'solo',
    ageDays: t.createdAt ? Math.floor((now - new Date(t.createdAt).getTime()) / DAY) : 999,
  };
}

async function ownersLastSignIn(uids: string[]): Promise<Record<string, { email: string | null; lastSignIn: string | null }>> {
  const out: Record<string, any> = {};
  const auth = getAdminAuth();
  for (let i = 0; i < uids.length; i += 100) {
    try {
      const r = await auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
      for (const u of r.users) out[u.uid] = { email: u.email || null, lastSignIn: u.metadata.lastRefreshTime || u.metadata.lastSignInTime || null };
    } catch { /* keep going */ }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const admin = await verifyPlatformAdmin(req);
  const b = await req.json().catch(() => ({}));
  if (b.action === 'whoami') return NextResponse.json({ ok: true, admin: !!admin });
  if (!admin) return NextResponse.json({ ok: false, error: 'HQ is for ClarityFlow admins. (Set PLATFORM_ADMIN_EMAILS in Vercel.)' }, { status: 403 });
  const db = getAdminDb();

  if (b.action === 'tenants') {
    const snap = await db.collection('tenants').limit(500).get();
    const tenants = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    const owners = await ownersLastSignIn(Array.from(new Set(tenants.map((t: any) => t.userId).filter(Boolean))) as string[]);
    const rows: any[] = [];
    for (let i = 0; i < tenants.length; i += 8) {   // a few at a time — polite to Firestore
      const chunk = await Promise.all(tenants.slice(i, i + 8).map(async (t: any) => {
        const o = owners[t.userId] || { email: null, lastSignIn: null };
        const s = await signals(db, t, o.lastSignIn);
        const setup = setupScore(s); const health = healthScore(s);
        return { id: t.id, name: t.name || 'Untitled', businessType: t.businessType || t.category || 'other', createdAt: t.createdAt || null,
          status: t.subscriptionStatus || 'inactive', ownerEmail: o.email, lastSignIn: o.lastSignIn, signals: s,
          setup: { done: setup.done, total: setup.total, pct: setup.pct, next: setup.next?.label || null }, health };
      }));
      rows.push(...chunk);
    }
    rows.sort((a, b2) => a.health.score - b2.health.score);   // who needs you most, first
    return NextResponse.json({ ok: true, tenants: rows });
  }

  if (b.action === 'tenant') {
    const id = String(b.id || '');
    const t = ((await db.doc(`tenants/${id}`).get()).data() as any) || null;
    if (!t) return NextResponse.json({ ok: false, error: 'Business not found.' }, { status: 404 });
    t.id = id;
    const owners = t.userId ? await ownersLastSignIn([t.userId]) : {};
    const o = owners[t.userId] || { email: null, lastSignIn: null };
    const s = await signals(db, t, o.lastSignIn);
    const base = `tenants/${id}`;
    const safe = async (q: any) => { try { return (await q.get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })); } catch { return []; } };
    const [appts, msgs, audit, tickets] = await Promise.all([
      safe(db.collection(`${base}/appointments`).orderBy('createdAt', 'desc').limit(30)),
      safe(db.collection(`${base}/messageLog`).orderBy('sentAt', 'desc').limit(30)),
      safe(db.collection(`${base}/auditLogs`).orderBy('at', 'desc').limit(30)),
      safe(db.collection('platformTickets').where('tenantId', '==', id).limit(30)),
    ]);
    const timeline = [
      ...appts.map((a: any) => ({ at: a.createdAt, kind: 'booking', tone: a.status === 'cancelled' ? 'warn' : 'info', text: `${a.clientName || 'A client'} booked ${a.serviceName || 'a service'} for ${a.startTime ? new Date(a.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'} · ${a.status || ''}${a.source ? ` · via ${a.source}` : ''}` })),
      ...msgs.map((m: any) => ({ at: m.sentAt, kind: 'message', tone: m.status === 'failed' ? 'bad' : 'info', text: `${m.channel === 'sms' ? 'Text' : 'Email'} ${m.status === 'failed' ? 'FAILED' : m.status} · ${m.kind || ''} → ${m.recipientName || m.recipientType || 'someone'}${m.error ? ` — ${String(m.error).slice(0, 120)}` : ''}` })),
      ...audit.map((a: any) => ({ at: a.at, kind: 'change', tone: 'info', text: `${a.summary || a.action}${a.actor?.name ? ` — ${a.actor.name}` : ''}` })),
      ...tickets.map((k: any) => ({ at: k.createdAt, kind: 'help', tone: 'warn', text: `Help request: “${String(k.subject || k.message || '').slice(0, 90)}” · ${k.status}` })),
    ].filter((e) => e.at).sort((a, b2) => String(b2.at).localeCompare(String(a.at))).slice(0, 80);
    return NextResponse.json({ ok: true, tenant: {
      id, name: t.name, businessType: t.businessType || t.category || 'other', status: t.subscriptionStatus || 'inactive', createdAt: t.createdAt || null,
      activatedAt: t.activatedAt || null, inviteCode: t.inviteCode || null, teamSize: t.teamSize || null, tools: fromTenantModules(t.modules),
      owner: { email: o.email, lastSignIn: o.lastSignIn, uid: t.userId || null }, bookingUrl: `/book/${id}`,
    }, signals: s, setup: setupScore(s), health: healthScore(s), timeline, tickets });
  }

  if (b.action === 'tickets') {
    const snap = await db.collection('platformTickets').orderBy('createdAt', 'desc').limit(200).get();
    return NextResponse.json({ ok: true, tickets: snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })) });
  }

  if (b.action === 'ticket-status' || b.action === 'ticket-reply') {
    const ref = db.doc(`platformTickets/${String(b.ticketId || '')}`);
    const k = ((await ref.get()).data() as any) || null;
    if (!k) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
    const status = ['open', 'waiting_on_them', 'waiting_on_us', 'solved'].includes(b.status) ? b.status : (b.action === 'ticket-reply' ? 'waiting_on_them' : k.status);
    const at = new Date().toISOString();
    const patch: any = { status, updatedAt: at };
    let emailed = false;
    if (b.action === 'ticket-reply') {
      const message = String(b.message || '').trim().slice(0, 4000);
      if (!message) return NextResponse.json({ ok: false, error: 'Write a reply first.' }, { status: 400 });
      patch.thread = [...(Array.isArray(k.thread) ? k.thread : []), { at, from: 'hq', by: admin.email, message }];
      if (k.contactEmail && process.env.RESEND_API_KEY) {
        try {
          const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: resolveFromAddress(), to: k.contactEmail, reply_to: admin.email, subject: `Re: ${k.subject || 'Your help request'} — ClarityFlow`,
              text: `${message}\n\n—\nYou can also see this reply in ClarityFlow under Help.` }) });
          emailed = r.ok;
        } catch { /* saved either way */ }
      }
    }
    await ref.set(patch, { merge: true });
    return NextResponse.json({ ok: true, emailed });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
