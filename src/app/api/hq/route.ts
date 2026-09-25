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
import { platformAdminEmails, signupIsOpen, can, permsFor, type HqPerm } from '@/lib/platform-admin';
import { aiDraftReply, CATEGORY_LABEL, SLA_HOURS, type Priority } from '@/lib/support-triage';
import { computeMetrics } from '@/lib/hq-metrics';
import { askClaude, aiConfigured } from '@/lib/ai';
import { syncStripeMonth, profitLadder, planner, monthKey, DEFAULT_SETTINGS, type FinanceSettings } from '@/lib/hq-finance';

// Which permission each action needs (see src/lib/platform-admin.ts).
const NEEDS: Record<string, HqPerm> = {
  tenants: 'tenants', tenant: 'tenants', fix: 'fix', system: 'system', tickets: 'tickets', 'ticket-reply': 'tickets', 'ticket-status': 'tickets',
  'ticket-update': 'tickets', 'ticket-note': 'tickets', 'ticket-draft': 'tickets', macros: 'tickets', 'macro-save': 'tickets', 'macro-delete': 'tickets',
  insights: 'insights', 'insights-refresh': 'insights', 'insights-brief': 'insights', team: 'team', 'team-save': 'team', 'team-remove': 'team',
  finance: 'finance', 'finance-sync': 'finance', 'finance-settings': 'finance', 'expense-save': 'finance', 'expense-delete': 'finance',
};
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
  if (b.action === 'whoami') return NextResponse.json({ ok: true, admin: !!admin, role: admin?.role || null, perms: admin ? permsFor(admin.role) : [], name: admin?.name || null, email: admin?.email || null, ai: aiConfigured() });
  if (!admin) return NextResponse.json({ ok: false, error: 'HQ is for the ClarityFlow team. (Owners: PLATFORM_ADMIN_EMAILS in Vercel; others: HQ → Team.)' }, { status: 403 });
  const need = NEEDS[String(b.action)];
  if (need && !can(admin.role, need)) return NextResponse.json({ ok: false, error: `Your HQ role (${admin.role}) can’t do that.` }, { status: 403 });
  if (b.action === 'fix' && (b.fix === 'suspend' || b.fix === 'restore') && !can(admin.role, 'suspend')) return NextResponse.json({ ok: false, error: 'Only an owner can pause or restore access.' }, { status: 403 });
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
    const [notesSnap, presenceSnap, hqAudit, metricsSnap] = await Promise.all([
      db.doc(`platformNotes/${id}`).get(), db.doc(`platformPresence/${id}`).get(),
      safe(db.collection('platformAudit').where('tenantId', '==', id).limit(30)),
      db.doc(`platformTenantMetrics/${id}`).get(),
    ]);
    const recent = appts.slice(0, 12).map((a: any) => ({ id: a.id, clientName: a.clientName || null, serviceName: a.serviceName || null, startTime: a.startTime || null, status: a.status || null, hasCheckIn: !!a.checkInToken }));
    return NextResponse.json({ ok: true, metrics: metricsSnap.exists ? metricsSnap.data() : null, recent, notes: ((notesSnap.data() as any)?.notes || []).slice(-50).reverse(), presence: presenceSnap.exists ? presenceSnap.data() : null,
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
      if (!k.firstRespondedAt) patch.firstRespondedAt = at;
      if (!k.assignee) patch.assignee = admin.email;
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

  // ── Tickets: assign, prioritise, categorise, escalate, internal notes ──
  if (b.action === 'ticket-update') {
    const ref = db.doc(`platformTickets/${String(b.ticketId || '')}`);
    const k = ((await ref.get()).data() as any) || null;
    if (!k) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
    const patch: any = { updatedAt: new Date().toISOString() };
    if ('assignee' in b) patch.assignee = b.assignee ? String(b.assignee).toLowerCase().slice(0, 120) : null;
    if (b.priority && ['urgent', 'high', 'normal', 'low'].includes(b.priority)) { patch.priority = b.priority; if (!k.firstRespondedAt) patch.firstResponseDueAt = new Date(new Date(k.createdAt).getTime() + SLA_HOURS[b.priority as Priority] * 3600000).toISOString(); }
    if (b.category && (CATEGORY_LABEL as any)[b.category]) patch.category = b.category;
    if (b.escalate) { patch.devStatus = 'new'; patch.escalatedAt = patch.updatedAt; patch.escalatedBy = admin.email; patch.category = 'bug'; }
    if (b.devStatus && ['new', 'investigating', 'fixed', 'wont_fix'].includes(b.devStatus)) patch.devStatus = b.devStatus;
    await ref.set(patch, { merge: true });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'ticket-note') {
    const ref = db.doc(`platformTickets/${String(b.ticketId || '')}`);
    const k = ((await ref.get()).data() as any) || null;
    const text = String(b.text || '').trim().slice(0, 3000);
    if (!k || !text) return NextResponse.json({ ok: false, error: 'Nothing to add.' }, { status: 400 });
    await ref.set({ internalNotes: [...(k.internalNotes || []), { at: new Date().toISOString(), by: admin.email, text }], updatedAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'ticket-draft') {
    const k = ((await db.doc(`platformTickets/${String(b.ticketId || '')}`).get()).data() as any) || null;
    if (!k) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
    const r = await aiDraftReply({ ticket: k, instructions: String(b.instructions || '').slice(0, 500) });
    return NextResponse.json({ ok: r.ok, draft: r.text, error: r.error, costUsd: r.costUsd });
  }
  // Saved replies ("macros") the whole team can reuse.
  if (b.action === 'macros') {
    const snap = await db.collection('platformMacros').limit(200).get();
    return NextResponse.json({ ok: true, macros: snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, c: any) => String(a.title).localeCompare(String(c.title))) });
  }
  if (b.action === 'macro-save') {
    const title = String(b.title || '').trim().slice(0, 80), body = String(b.body || '').trim().slice(0, 3000);
    if (!title || !body) return NextResponse.json({ ok: false, error: 'A title and a reply are needed.' }, { status: 400 });
    const ref = b.id ? db.doc(`platformMacros/${String(b.id)}`) : db.collection('platformMacros').doc();
    await ref.set({ id: ref.id, title, body, category: String(b.category || '') || null, updatedAt: new Date().toISOString(), by: admin.email }, { merge: true });
    return NextResponse.json({ ok: true, id: ref.id });
  }
  if (b.action === 'macro-delete') { await db.doc(`platformMacros/${String(b.id || '')}`).delete(); return NextResponse.json({ ok: true }); }

  // ── Insights ──
  if (b.action === 'insights' || b.action === 'insights-refresh') {
    if (b.action === 'insights-refresh') await computeMetrics();
    const [snaps, tm] = await Promise.all([
      db.collection('platformMetrics').orderBy('date', 'desc').limit(60).get(),
      db.collection('platformTenantMetrics').limit(500).get(),
    ]);
    const days = snaps.docs.map((d: any) => d.data() as any).reverse();
    return NextResponse.json({ ok: true, latest: days[days.length - 1] || null, days: days.map((d: any) => ({ date: d.date, revenue30: d.revenue30, bookings30: d.bookings30, activeBusinesses: d.activeBusinesses, cost: d.cost30?.total })),
      tenants: tm.docs.map((d: any) => { const v = d.data() as any; delete v.history; return v; }), ai: aiConfigured() });
  }
  if (b.action === 'insights-brief') {
    const snap = await db.collection('platformMetrics').orderBy('date', 'desc').limit(8).get();
    const days = snap.docs.map((d: any) => d.data() as any);
    if (!days.length) return NextResponse.json({ ok: false, error: 'No metrics yet — refresh Insights first.' });
    const r = await askClaude({ tier: 'smart', maxTokens: 700, purpose: 'insights_brief',
      system: 'You are the chief of staff for ClarityFlow, a small SaaS company run by its founder. Write a short weekly briefing in plain English: 1) what changed (with numbers), 2) three specific actions for this week, most valuable first, 3) one risk to watch. Under 220 words. Use only the data given; never invent figures. No headings with #; use short bold labels.',
      prompt: `Latest platform snapshot:
${JSON.stringify(days[0]).slice(0, 6000)}

A week earlier:
${JSON.stringify(days[days.length - 1]).slice(0, 3000)}` });
    return NextResponse.json({ ok: r.ok, brief: r.text, error: r.error });
  }

  // ── Finance (owners only): ClarityFlow the company ──
  if (b.action === 'finance-sync') {
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ ok: false, error: 'STRIPE_SECRET_KEY isn’t set.' }, { status: 400 });
    const month = /^\d{4}-\d{2}$/.test(String(b.month || '')) ? String(b.month) : monthKey(new Date());
    try { const doc = await syncStripeMonth(month); return NextResponse.json({ ok: true, month, feesCents: doc.feesCents }); }
    catch (e: any) { return NextResponse.json({ ok: false, error: `Stripe: ${String(e?.message || e).slice(0, 200)}` }, { status: 500 }); }
  }
  if (b.action === 'finance-settings') {
    const cur = { ...DEFAULT_SETTINGS, ...(((await db.doc('platformSettings/finance').get()).data() as any) || {}) };
    const num = (k: keyof FinanceSettings, lo: number, hi: number) => (b[k] == null || b[k] === '' ? cur[k] : Math.min(hi, Math.max(lo, Number(b[k]) || 0)));
    const next: FinanceSettings = { taxRatePct: num('taxRatePct', 0, 60), ownerPayMonthly: num('ownerPayMonthly', 0, 1e6), cashOnHand: num('cashOnHand', -1e8, 1e9), reinvestPct: num('reinvestPct', 0, 100), profitGoalMonthly: num('profitGoalMonthly', 0, 1e7), arpa: num('arpa', 0, 100000) };
    await db.doc('platformSettings/finance').set(next);
    await audit(db, admin.email, null, 'finance-settings', 'Updated finance settings');
    return NextResponse.json({ ok: true, settings: next });
  }
  if (b.action === 'expense-save') {
    const name = String(b.name || '').trim().slice(0, 80);
    const monthly = Number(b.monthly);
    const category = ['staff', 'software', 'marketing', 'contractors', 'office', 'insurance', 'other'].includes(b.category) ? b.category : 'other';
    if (!name || !Number.isFinite(monthly) || monthly < 0) return NextResponse.json({ ok: false, error: 'A name and a monthly amount are needed.' }, { status: 400 });
    const ref = b.id ? db.doc(`platformExpenses/${String(b.id)}`) : db.collection('platformExpenses').doc();
    await ref.set({ id: ref.id, name, monthly: Math.round(monthly * 100) / 100, category, note: String(b.note || '').slice(0, 200) || null, updatedAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'expense-delete') { await db.doc(`platformExpenses/${String(b.id || '')}`).delete(); return NextResponse.json({ ok: true }); }
  if (b.action === 'finance') {
    const now = new Date();
    const thisM = monthKey(now), lastM = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const month = /^\d{4}-\d{2}$/.test(String(b.month || '')) ? String(b.month) : thisM;
    const [fin, last, settingsSnap, expSnap, metricsSnap] = await Promise.all([
      db.doc(`platformFinance/${month}`).get(), db.doc(`platformFinance/${lastM}`).get(), db.doc('platformSettings/finance').get(),
      db.collection('platformExpenses').limit(200).get(), db.collection('platformMetrics').orderBy('date', 'desc').limit(1).get(),
    ]);
    const settings: FinanceSettings = { ...DEFAULT_SETTINGS, ...((settingsSnap.data() as any) || {}) };
    const expenses = expSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, c: any) => c.monthly - a.monthly);
    const opex = expenses.reduce((n: number, e: any) => n + (Number(e.monthly) || 0), 0);
    const m = metricsSnap.docs[0]?.data() as any || null;
    const f = (fin.data() as any) || null;
    const active = Math.max(1, m?.activeBusinesses || 1);
    // Cost to serve: what Stripe actually charged + texts/emails/AI/hosting (measured daily in Insights).
    const serviceCosts = m ? (m.cost30.texts + m.cost30.emails + m.cost30.ai + m.cost30.infra) : 0;
    const stripeCosts = f ? f.stripeCostsCents / 100 : 0;
    const feeIncome = f ? f.netFeesCents / 100 : 0;
    const subscriptions = 0;   // subscription billing is the next build
    const revenue = feeIncome + subscriptions;
    const costToServe = serviceCosts + stripeCosts;
    const ladder = profitLadder({ revenue, costToServe, opex, settings });
    const costPerBusiness = costToServe / active;
    const feesPerBusiness = feeIncome / active;
    const plan = planner({ arpa: settings.arpa + feesPerBusiness, costPerBusiness, opex, settings });
    const monthlyBurn = Math.max(0, -ladder.afterTax);
    return NextResponse.json({ ok: true, month, lastMonth: lastM, finance: f, lastFinance: (last.data() as any) || null, settings, expenses, opex,
      costs: { service: serviceCosts, stripe: stripeCosts, perBusiness: costPerBusiness, activeBusinesses: m?.activeBusinesses || 0 },
      income: { fees: feeIncome, feesPerBusiness, subscriptions }, ladder, plan,
      runwayMonths: monthlyBurn > 0 && settings.cashOnHand > 0 ? Math.floor(settings.cashOnHand / monthlyBurn) : null,
      stripeReady: !!process.env.STRIPE_SECRET_KEY });
  }

  // ── Team (owners only) ──
  if (b.action === 'team') {
    const snap = await db.collection('platformTeam').limit(100).get();
    return NextResponse.json({ ok: true, owners: platformAdminEmails(), members: snap.docs.map((d: any) => ({ email: d.id, ...(d.data() as any) })) });
  }
  if (b.action === 'team-save') {
    const email = String(b.email || '').trim().toLowerCase();
    const role = String(b.role || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !['support', 'developer', 'analyst'].includes(role)) return NextResponse.json({ ok: false, error: 'An email and a role (support, developer or analyst) are needed.' }, { status: 400 });
    await db.doc(`platformTeam/${email}`).set({ role, name: String(b.name || '').trim().slice(0, 60) || email.split('@')[0], active: true, addedBy: admin.email, addedAt: new Date().toISOString() }, { merge: true });
    await audit(db, admin.email, null, 'team-save', `Gave ${email} the ${role} role`);
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'team-remove') {
    const email = String(b.email || '').trim().toLowerCase();
    await db.doc(`platformTeam/${email}`).set({ active: false, removedAt: new Date().toISOString(), removedBy: admin.email }, { merge: true });
    await audit(db, admin.email, null, 'team-remove', `Removed ${email} from HQ`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
