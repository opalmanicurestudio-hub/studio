// src/lib/automations.ts
//
// EVERYTHING CLARITYFLOW DOES AUTOMATICALLY — in one list, in plain words,
// with an honest status for each:
//   working      on, and what it needs is in place
//   off          switched off by the business
//   needs_setup  on, but can't run — e.g. texting or payments not set up,
//                or its daily job hasn't run
//   failing      recent sends mostly failed, or cancellations waiting unsent
//
// Built on the message catalog (message-policy.ts MESSAGE_KINDS — 48 kinds,
// each with a plain "when" sentence) plus the automatic actions and messages
// that live outside it (tour reminders, interviews, admissions, rent autopay,
// online-cancellation handling…), so nothing that runs is invisible.
// Server-only (reads the message log, job heartbeats and the business).

import { getAdminDb } from '@/lib/firebase-admin';
import { MESSAGE_KINDS, resolveMessagePolicy } from '@/lib/message-policy';
import { SCHEDULED_JOBS } from '@/lib/cron-heartbeat';

export type Audience = 'Clients' | 'Visitors & renters' | 'Students & applicants' | 'You & your team';
export type Need = 'email' | 'sms' | 'stripe';
export interface Automation {
  id: string; who: Audience; when: string; then: string;
  kinds: string[]; channels: ('email' | 'sms')[]; needs: Need[];
  job?: string; canDisable: boolean; settingsHref: string; source: 'message' | 'action';
}
export type Status = 'working' | 'off' | 'needs_setup' | 'failing';
export interface AutomationHealth extends Automation {
  status: Status; reason: string | null; emailOn: boolean; smsOn: boolean; sent7: number; failed7: number; lastSentAt: string | null;
}

const WHO: Record<string, Audience> = { Booking: 'Clients', Reminders: 'Clients', Money: 'Clients', Retail: 'Clients', Account: 'Clients', Renters: 'Visitors & renters' };
const TO_TEAM = new Set(['staff_new_request', 'booth_application_owner', 'grievance_received']);
const REMINDER_JOB: Record<string, string> = { appointment_reminder: 'reminders', rent_charge_upcoming: 'nightly', rent_overdue: 'nightly', rent_dunning: 'nightly', lease_renewal: 'nightly', renter_rent_due: 'nightly', balance_outstanding: 'nightly' };
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The automatic things that aren't in the message catalog. */
const EXTRA: Automation[] = [
  // Online cancellations: sent by the Firebase function directly (not in the
  // message log, so no count) — its health is "no cancellations left waiting".
  { id: 'act:cancellation', who: 'Clients', when: 'A client cancels or moves a visit online', then: 'confirm it by email and text, and charge the late-cancellation fee if your policy says so', kinds: [], channels: ['email', 'sms'], needs: ['email'], canDisable: false, settingsHref: '/settings/booking', source: 'action' },
  { id: 'msg:waitlist_offer', who: 'Clients', when: 'A time opens up', then: 'offer it to the next person on the waitlist', kinds: ['waitlist_offer', 'waitlist_opening'], channels: ['email', 'sms'], needs: ['email'], canDisable: false, settingsHref: '/settings/booking', source: 'message' },
  { id: 'msg:tour_reminder', who: 'Visitors & renters', when: 'A tour is coming up', then: 'remind the visitor, with directions and a link to change it', kinds: ['tour_reminder'], channels: ['email', 'sms'], needs: ['email'], job: 'nightly', canDisable: false, settingsHref: '/booths', source: 'message' },
  { id: 'msg:tour_changed', who: 'Visitors & renters', when: 'A tour is moved or cancelled', then: 'tell the visitor', kinds: ['tour_rescheduled', 'tour_cancelled'], channels: ['email'], needs: ['email'], canDisable: false, settingsHref: '/booths', source: 'message' },
  { id: 'act:rent_autopay', who: 'Visitors & renters', when: 'Rent is due for a renter on autopay', then: 'charge their card on file and send a receipt', kinds: ['rent_receipt', 'autopay_failed'], channels: ['email'], needs: ['email', 'stripe'], job: 'autopay-leases', canDisable: false, settingsHref: '/booths', source: 'action' },
  { id: 'msg:reservation', who: 'Visitors & renters', when: 'Someone reserves a space online', then: 'send their confirmation', kinds: ['reservation_confirmation', 'day_pass'], channels: ['email'], needs: ['email'], canDisable: false, settingsHref: '/booths', source: 'message' },
  { id: 'msg:admissions', who: 'Students & applicants', when: 'An application moves along — documents checked or sent back, interview offered or moved, a decision', then: 'email the applicant (and text them, if they asked for texts)', kinds: ['admissions_update', 'doc_rejected', 'docs_received', 'docs_verified', 'interview_offered', 'interview_booked', 'interview_cancelled'], channels: ['email', 'sms'], needs: ['email'], canDisable: false, settingsHref: '/academy?section=admissions', source: 'message' },
  { id: 'act:admissions_daily', who: 'Students & applicants', when: 'Every morning', then: 'remind applicants about offers and missing documents, and release expired offers to the waitlist', kinds: [], channels: ['email'], needs: ['email'], job: 'hq', canDisable: false, settingsHref: '/academy?section=admissions', source: 'action' },
  { id: 'act:campaigns', who: 'Clients', when: 'A scheduled campaign or marketing automation is due', then: 'send it', kinds: ['campaign', 'miss_you', 'post_visit_followup', 'rebooking'], channels: ['email', 'sms'], needs: ['email'], job: 'campaigns', canDisable: false, settingsHref: '/campaigns', source: 'action' },
];

export function automationList(): Automation[] {
  const fromCatalog: Automation[] = MESSAGE_KINDS.map((k) => ({
    id: `msg:${k.id}`, who: TO_TEAM.has(k.id) ? 'You & your team' : WHO[k.group] || 'Clients',
    when: k.when.replace(/\.$/, ''), then: `send “${lower1(k.label)}”${k.channels.length > 1 ? ' by email and text' : k.channels[0] === 'sms' ? ' by text' : ' by email'}`,
    kinds: [k.id], channels: k.channels, needs: [k.channels.includes('email') ? 'email' : 'sms'] as Need[], job: REMINDER_JOB[k.id],
    canDisable: k.canDisable, settingsHref: `/settings/messages#${k.id}`, source: 'message' as const,
  }));
  const seen = new Set(fromCatalog.map((a) => a.id));
  return [...fromCatalog, ...EXTRA.filter((a) => !seen.has(a.id))];
}

/** What's in place for this business: email, texting, payments. */
export function readiness(t: any) {
  const env = process.env;
  return {
    email: !!env.RESEND_API_KEY,
    sms: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID || t?.sms?.fromNumber || t?.sms?.messagingServiceSid)),
    stripe: !!t?.stripeAccountId && t?.stripeChargesEnabled !== false,
  };
}
const NEED_WORDS: Record<Need, string> = { email: 'Email sending isn’t set up for ClarityFlow', sms: 'Texting isn’t set up yet', stripe: 'Connect Stripe to take payments' };

export async function automationHealth(tenantId: string): Promise<{ items: AutomationHealth[]; ready: ReturnType<typeof readiness>; jobs: { name: string; label: string; lastRunAt: string | null; late: boolean }[] }> {
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const t = ((await db.doc(T).get()).data() as any) || {};
  const ready = readiness(t);
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [logs, beats, stuck] = await Promise.all([
    db.collection(`${T}/messageLog`).where('sentAt', '>=', since).limit(5000).get().catch(() => ({ docs: [] as any[] })),
    Promise.all(SCHEDULED_JOBS.map((j) => db.doc(`platformHealth/cron_${j.name}`).get().then((d: any) => ({ ...j, lastRunAt: (d.data() as any)?.lastRunAt || null })).catch(() => ({ ...j, lastRunAt: null })))),
    db.collection(`${T}/cancellationEvents`).where('status', '==', 'pending').limit(50).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const jobs = beats.map((j: any) => ({ name: j.name, label: j.label, lastRunAt: j.lastRunAt, late: !j.lastRunAt || Date.now() - Date.parse(j.lastRunAt) > j.everyHours * 1.5 * 3600000 }));
  const byKind = new Map<string, { sent: number; failed: number; last: string | null }>();
  for (const d of logs.docs) {
    const m = d.data() as any; const k = String(m.kind || ''); const x = byKind.get(k) || { sent: 0, failed: 0, last: null };
    if (m.status === 'sent') x.sent++; else if (m.status === 'failed' || m.status === 'error') x.failed++;
    if (!x.last || String(m.sentAt) > x.last) x.last = m.sentAt; byKind.set(k, x);
  }
  const stuckCount = stuck.docs.filter((d: any) => Date.now() - Date.parse((d.data() as any).createdAt || '') > 30 * 60000).length;

  const items = automationList().map((a) => {
    const counts = a.kinds.map((k) => byKind.get(k)).filter(Boolean) as { sent: number; failed: number; last: string | null }[];
    const sent7 = counts.reduce((n, c) => n + c.sent, 0), failed7 = counts.reduce((n, c) => n + c.failed, 0);
    const lastSentAt = counts.map((c) => c.last).filter(Boolean).sort().pop() || null;
    const catalogKind = a.source === 'message' && a.id.startsWith('msg:') && a.kinds.length === 1 ? a.kinds[0] : null;
    const emailOn = catalogKind && a.channels.includes('email') ? resolveMessagePolicy(t, catalogKind, 'email').enabled : a.channels.includes('email');
    const smsOn = catalogKind && a.channels.includes('sms') ? resolveMessagePolicy(t, catalogKind, 'sms').enabled : a.channels.includes('sms');
    let status: Status = 'working'; let reason: string | null = null;
    if (!emailOn && !smsOn) { status = 'off'; }
    else {
      const missing = a.needs.find((n) => !ready[n]);
      const job = a.job ? jobs.find((j) => j.name === a.job) : null;
      if (missing) { status = 'needs_setup'; reason = NEED_WORDS[missing]; }
      else if (job?.late) { status = 'needs_setup'; reason = job.lastRunAt ? `Its daily job (“${job.label}”) hasn’t run since ${new Date(job.lastRunAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `Its daily job (“${job.label}”) has never run`; }
      else if (a.id === 'act:cancellation' && stuckCount > 0) { status = 'failing'; reason = `${stuckCount} online cancellation${stuckCount === 1 ? ' is' : 's are'} waiting to be processed — the cancellation function may not be running`; }
      else if (failed7 >= 3 && failed7 > sent7) { status = 'failing'; reason = `${failed7} of the last ${failed7 + sent7} didn’t go through this week`; }
    }
    return { ...a, status, reason, emailOn: !!emailOn, smsOn: !!smsOn, sent7, failed7, lastSentAt };
  });
  return { items, ready, jobs };
}
