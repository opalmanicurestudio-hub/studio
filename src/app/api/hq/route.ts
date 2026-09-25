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
import { healthScore, setupScore } from '@/lib/hq-health';
import { signals, ownersLastSignIn } from '@/lib/hq-signals';
import { fromTenantModules, toTenantModules, TOOL_BY_ID, type ToolId } from '@/lib/module-catalog';
import { SCHEDULED_JOBS } from '@/lib/cron-heartbeat';
import { internalOrigin } from '@/lib/message-policy';
import { platformAdminEmails, signupIsOpen } from '@/lib/platform-admin';
import { smsConfigured } from '@/lib/sms';

// Every HQ action that changes something is written here: who, what, when.
async function audit(db: any, by: string, tenantId: string | null, action: string, summary: string, extra: any = {}) {
  try { const r = db.collection('platformAudit').doc(); await r.set({ id: r.id, at: new Date().toISOString(), by, tenantId, action, summary, ...extra }); } catch { /* never block the action */ }
}
import { resolveFromAddress } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    const [notesSnap, presenceSnap, hqAudit] = await Promise.all([
      db.doc(`platformNotes/${id}`).get(), db.doc(`platformPresence/${id}`).get(),
      safe(db.collection('platformAudit').where('tenantId', '==', id).limit(30)),
    ]);
    const recent = appts.slice(0, 12).map((a: any) => ({ id: a.id, clientName: a.clientName || null, serviceName: a.serviceName || null, startTime: a.startTime || null, status: a.status || null, hasCheckIn: !!a.checkInToken }));
    return NextResponse.json({ ok: true, recent, notes: ((notesSnap.data() as any)?.notes || []).slice(-50).reverse(), presence: presenceSnap.exists ? presenceSnap.data() : null,
      currentVersion: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || null, accessLocked: t.accessLocked === true,
      hqActions: hqAudit.sort((a: any, c: any) => String(c.at).localeCompare(String(a.at))).slice(0, 15),
      tenant: {
      id, name: t.name, businessType: t.businessType || t.category || 'other', status: t.subscriptionStatus || 'inactive', createdAt: t.createdAt || null,
      activatedAt: t.activatedAt || null, inviteCode: t.inviteCode || null, teamSize: t.teamSize || null, tools: fromTenantModules(t.modules),
      owner: { email: o.email, lastSignIn: o.lastSignIn, uid: t.userId || null }, bookingUrl: `/book/${id}`,
    }, signals: s, setup: setupScore(s), health: healthScore(s), timeline, tickets });
  }

  // ── Fix & manage one business — every action logged in platformAudit ──
  if (b.action === 'fix') {
    const tenantId = String(b.tenantId || '');
    const tRef = db.doc(`tenants/${tenantId}`);
    const t = ((await tRef.get()).data() as any) || null;
    if (!t) return NextResponse.json({ ok: false, error: 'Business not found.' }, { status: 404 });
    const fix = String(b.fix || '');
    const at = new Date().toISOString();

    if (fix === 'resend-confirmation') {
      const r = await fetch(`${internalOrigin(t, req.nextUrl.origin)}/api/notifications/resend-confirmation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: String(b.appointmentId || '') }) });
      const d = await r.json().catch(() => ({}));
      await audit(db, admin.email, tenantId, fix, `Resent the confirmation for appointment ${b.appointmentId}`, { result: d });
      return NextResponse.json({ ok: !!(d.emailSent || d.smsSent), message: d.emailSent || d.smsSent ? `Sent${d.emailSent ? ' by email' : ''}${d.smsSent ? ' by text' : ''}.` : (d.reason || 'Nothing was sent.') });
    }
    if (fix === 'resync-checkin') {
      // The check-in copy of a booking drifting from the booking itself — the
      // bug that made accepted requests still say "requested".
      const aRef = db.doc(`tenants/${tenantId}/appointments/${String(b.appointmentId || '')}`);
      const a = ((await aRef.get()).data() as any) || null;
      if (!a?.checkInToken) return NextResponse.json({ ok: false, message: 'This booking has no check-in record.' });
      const patch = { status: a.status, startTime: a.startTime || null, updatedAt: at };
      await Promise.all([db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`).set(patch, { merge: true }).catch(() => {}), db.doc(`appointmentCheckIns/${a.checkInToken}`).set(patch, { merge: true }).catch(() => {})]);
      await audit(db, admin.email, tenantId, fix, `Re-synced the check-in record of appointment ${b.appointmentId} to "${a.status}"`);
      return NextResponse.json({ ok: true, message: `Check-in record now matches: ${a.status}.` });
    }
    if (fix === 'password-link') {
      if (!t.userId) return NextResponse.json({ ok: false, message: 'No owner account.' });
      const email = (await getAdminAuth().getUser(t.userId)).email;
      if (!email) return NextResponse.json({ ok: false, message: 'The owner has no email on file.' });
      const link = await getAdminAuth().generatePasswordResetLink(email);
      let emailed = false;
      if (b.send && process.env.RESEND_API_KEY) {
        const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: resolveFromAddress(), to: email, reply_to: admin.email, subject: 'Reset your ClarityFlow password', text: `Here’s a link to set a new password:

${link}

If you didn’t ask for this, you can ignore it.

— ClarityFlow` }) }).catch(() => null);
        emailed = !!r?.ok;
      }
      await audit(db, admin.email, tenantId, fix, `${emailed ? 'Emailed' : 'Created'} a password reset link for ${email}`);
      return NextResponse.json({ ok: true, link, message: emailed ? `Reset link emailed to ${email}.` : 'Reset link created and copied.' });
    }
    if (fix === 'suspend' || fix === 'restore') {
      await tRef.set({ accessLocked: fix === 'suspend', accessLockedAt: fix === 'suspend' ? at : null, accessLockedReason: fix === 'suspend' ? String(b.reason || '').slice(0, 200) || null : null }, { merge: true });
      await audit(db, admin.email, tenantId, fix, fix === 'suspend' ? `Paused access${b.reason ? `: ${b.reason}` : ''}` : 'Restored access');
      return NextResponse.json({ ok: true, message: fix === 'suspend' ? 'Access paused — they’ll see the suspended page.' : 'Access restored.' });
    }
    if (fix === 'set-tools') {
      const tools = (Array.isArray(b.tools) ? b.tools : []).map(String).filter((x: string) => TOOL_BY_ID[x as ToolId]) as ToolId[];
      await tRef.set({ modules: toTenantModules(tools) }, { merge: true });
      await audit(db, admin.email, tenantId, fix, `Set tools: ${tools.join(', ')}`);
      return NextResponse.json({ ok: true, message: 'Tools updated — their sidebar follows.' });
    }
    if (fix === 'note') {
      const text = String(b.text || '').trim().slice(0, 2000);
      if (!text) return NextResponse.json({ ok: false, message: 'Write a note first.' });
      const ref = db.doc(`platformNotes/${tenantId}`);
      const cur = ((await ref.get()).data() as any)?.notes || [];
      await ref.set({ notes: [...cur, { at, by: admin.email, text }].slice(-200) }, { merge: true });
      return NextResponse.json({ ok: true, message: 'Note saved (only HQ can see it).' });
    }
    return NextResponse.json({ ok: false, error: 'Unknown fix' }, { status: 400 });
  }

  // ── System: is the platform itself healthy? ──
  if (b.action === 'system') {
    const now = Date.now();
    const [jobs, presence, tenantsSnap, openTickets] = await Promise.all([
      Promise.all(SCHEDULED_JOBS.map(async (j) => { const d = ((await db.doc(`platformHealth/cron_${j.name}`).get()).data() as any) || null; const hrs = d?.lastRunAt ? (now - new Date(d.lastRunAt).getTime()) / 3600000 : null;
        return { ...j, lastRunAt: d?.lastRunAt || null, late: hrs === null || hrs > j.everyHours + 3, hoursAgo: hrs === null ? null : Math.round(hrs) }; })),
      db.collection('platformPresence').limit(500).get(),
      db.collection('tenants').select('name').limit(300).get(),
      db.collection('platformTickets').where('status', 'in', ['open', 'waiting_on_us']).limit(200).get().catch(() => ({ size: 0 })),
    ]);
    // Delivery over the last 7 days, across every business.
    const since = new Date(now - 7 * 86400000).toISOString();
    const delivery: Record<string, { sent: number; failed: number; other: number }> = { email: { sent: 0, failed: 0, other: 0 }, sms: { sent: 0, failed: 0, other: 0 } };
    const failures: any[] = [];
    for (const td of tenantsSnap.docs) {
      try {
        const m = await db.collection(`tenants/${td.id}/messageLog`).where('sentAt', '>=', since).select('channel', 'status', 'error', 'sentAt', 'kind').limit(1000).get();
        for (const x of m.docs) { const v = x.data() as any; const ch = v.channel === 'sms' ? 'sms' : 'email'; const k = v.status === 'sent' ? 'sent' : v.status === 'failed' ? 'failed' : 'other'; delivery[ch][k]++;
          if (k === 'failed' && failures.length < 12) failures.push({ tenant: (td.data() as any).name || td.id, tenantId: td.id, channel: ch, kind: v.kind, error: String(v.error || '').slice(0, 140), at: v.sentAt }); }
      } catch { /* skip */ }
    }
    const current = String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || null;
    const versions: Record<string, number> = {};
    const behind: any[] = [];
    for (const d of presence.docs) { const v = d.data() as any; const ver = v.version || 'unknown'; versions[ver] = (versions[ver] || 0) + 1;
      if (current && ver !== current && v.lastSeenAt && now - new Date(v.lastSeenAt).getTime() < 3 * 86400000) behind.push({ tenantId: d.id, version: ver, host: v.host || null, lastSeenAt: v.lastSeenAt }); }
    const from = resolveFromAddress();
    const settings = [
      { key: 'PLATFORM_ADMIN_EMAILS', ok: platformAdminEmails().length > 0, note: 'Who can open HQ' },
      { key: 'RESEND_API_KEY', ok: !!process.env.RESEND_API_KEY, note: 'All email' },
      { key: 'NOTIFY_FROM_EMAIL', ok: !!process.env.NOTIFY_FROM_EMAIL && !/resend\.dev/i.test(from), note: /resend\.dev/i.test(from) ? `Sending from Resend’s test address (${from}) — only reaches you` : `Sending as ${from}` },
      { key: 'Texting (Twilio)', ok: smsConfigured(), note: smsConfigured() ? 'Connected' : 'TWILIO_* not set — no texts' },
      { key: 'CRON_SECRET', ok: !!process.env.CRON_SECRET, note: 'Protects the daily jobs' },
      { key: 'LEADS_NOTIFY_EMAIL', ok: !!process.env.LEADS_NOTIFY_EMAIL, note: 'Where access requests and help requests are emailed' },
      { key: 'Live address', ok: !!process.env.VERCEL_PROJECT_PRODUCTION_URL, note: process.env.VERCEL_PROJECT_PRODUCTION_URL || 'Turn on “Automatically expose System Environment Variables”' },
      { key: 'Sign-up', ok: true, note: signupIsOpen() ? 'Open to everyone' : 'Invite only' },
    ];
    return NextResponse.json({ ok: true, jobs, delivery, failures, versions, behind: behind.slice(0, 20), current, settings, openTickets: (openTickets as any).size || 0, tenants: tenantsSnap.size });
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
