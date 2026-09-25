// src/app/api/cron/hq/route.ts
//
// DAILY — HQ's onboarding helper.
//
// For every business in its first 30 days that hasn't finished setting up:
// work out its NEXT step and send the owner one friendly, specific email
// about it — at most twice per step, three days apart. Businesses still stuck
// after two nudges are listed in a short daily digest to you (with open help
// requests), so a person steps in exactly when automation hasn't worked.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { recordCronRun } from '@/lib/cron-heartbeat';
import { signals, ownersLastSignIn } from '@/lib/hq-signals';
import { setupScore } from '@/lib/hq-health';
import { linkOrigin } from '@/lib/app-origin';
import { resolveFromAddress } from '@/lib/notify';
import { platformAdminEmails } from '@/lib/platform-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const DAY = 86400000;

const NUDGE: Record<string, (biz: string, base: string, id: string) => { subject: string; body: string }> = {
  active: (biz, base) => ({ subject: `${biz} is one step from ready`, body: `Your ClarityFlow is set up — it just needs you to choose your tools and step inside.\n\nFinish here: ${base}/subscriptions` }),
  services: (biz, base) => ({ subject: `Add your services to ${biz}`, body: `Your booking page needs something to book. Add your services (name, time, price) — it takes a few minutes.\n\nAdd services: ${base}/services` }),
  stripe: (biz, base) => ({ subject: `Get paid through ${biz}`, body: `Connect payments so clients can pay deposits and you can check out in seconds. Money goes straight to your own Stripe account.\n\nConnect payments: ${base}/settings` }),
  clients: (biz, base) => ({ subject: `Bring your clients into ${biz}`, body: `Add or import your clients so reminders, rebooking nudges and history all work from day one.\n\nAdd clients: ${base}/clients` }),
  team: (biz, base) => ({ subject: `Invite your team to ${biz}`, body: `Add your team so they have their own schedule and bookings go to the right person.\n\nAdd your team: ${base}/staff` }),
  booking: (biz, base, id) => ({ subject: `Share your booking page`, body: `Everything’s ready — now let clients book. Put this link in your Instagram bio, on your website, or send it to a regular:\n\n${base}/book/${id}` }),
};

async function email(to: string, subject: string, text: string, replyTo?: string) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: resolveFromAddress(), to, ...(replyTo ? { reply_to: replyTo } : {}), subject, text }) });
    return r.ok;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  void recordCronRun('hq');
  const db = getAdminDb();
  const now = Date.now();
  const base = linkOrigin(null, req.nextUrl.origin);
  const admin = platformAdminEmails()[0];
  const recent = new Date(now - 30 * DAY).toISOString();
  const snap = await db.collection('tenants').where('createdAt', '>=', recent).limit(300).get();
  const tenants = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((t: any) => !t.accessLocked && t.subscriptionStatus !== 'cancelled');
  const owners = await ownersLastSignIn(Array.from(new Set(tenants.map((t: any) => t.userId).filter(Boolean))) as string[]);
  const sent: string[] = []; const stuck: string[] = [];

  for (const t of tenants) {
    if (Date.now() - now > 50000) break;
    const o = owners[t.userId]; if (!o?.email) continue;
    const s = await signals(db, t, o.lastSignIn);
    if (s.ageDays < 1) continue;                       // give them a day
    const next = setupScore(s).next; if (!next || !NUDGE[next.key]) continue;
    const ref = db.doc(`platformNudges/${t.id}_${next.key}`);
    const n = ((await ref.get()).data() as any) || { count: 0 };
    const since = n.lastAt ? (now - new Date(n.lastAt).getTime()) / DAY : 99;
    if (n.count >= 2) { if (since >= 3) stuck.push(`${t.name || t.id} — stuck on “${next.label}” (${s.ageDays} days in) · ${base}/admin/tenants/${t.id}`); continue; }
    if (since < 3) continue;
    const m = NUDGE[next.key](t.name || 'your business', base, t.id);
    const first = String(o.email).split('@')[0];
    const ok = await email(o.email, m.subject, `Hi ${first},\n\n${m.body}\n\nStuck or have a question? Just reply — a real person reads every message.\n\n— ClarityFlow`, admin);
    if (ok) { await ref.set({ tenantId: t.id, step: next.key, count: (n.count || 0) + 1, lastAt: new Date().toISOString() }, { merge: true }); sent.push(`${t.name}: ${next.key}`); }
  }

  // The daily digest to you — only when there's something to act on.
  const open = await db.collection('platformTickets').where('status', 'in', ['open', 'waiting_on_us']).limit(100).get().then((r: any) => r.size).catch(() => 0);
  const to = process.env.LEADS_NOTIFY_EMAIL || admin;
  if (to && (stuck.length || open)) {
    await email(to, `HQ today: ${stuck.length} stuck · ${open} help request${open === 1 ? '' : 's'} waiting`,
      `${stuck.length ? `Still stuck after two nudges:\n${stuck.map((x) => `• ${x}`).join('\n')}\n\n` : ''}${open ? `${open} help request${open === 1 ? '' : 's'} waiting on you: ${base}/admin/support\n\n` : ''}Nudges sent today: ${sent.length}\n\nHQ: ${base}/admin/tenants`);
  }
  return NextResponse.json({ ok: true, nudged: sent, stuck: stuck.length, openTickets: open });
}
