// src/app/api/cron/no-shows/route.ts — SUSPECTED NO-SHOWS (every 5 minutes, Vercel Cron + CRON_SECRET).
// Moved from the Cloud Function autoFlagSuspectedNoShows (never deployed — the repo can't deploy functions). NEVER
// cancels anything: it FLAGS a booking only when every signal agrees, asks the provider "Confirm no-show / Client is
// here", and escalates to owners/admins if nobody answers by the deadline. The actual no-show (fees, deposit) stays
// with /api/notifications/handle-no-show-action → confirm_no_show, once a person confirms.
// Fixed on the way: "not checked in" now reads the VISIT's stage (ticket/kiosk arrivals never set checkedInAt), the
// query needs no composite index, and escalation actually fires (the old flag never set noShowEscalated:false, and
// the escalation query only matched noShowEscalated == false).
import { automationOn, noteAutomation } from '@/lib/automation-switches';
import { heartbeat } from '@/lib/account-health';
import { recordCronRun } from '@/lib/cron-heartbeat';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stageOf } from '@/lib/visit';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const iso = (v: any): number => { if (!v) return 0; if (typeof v === 'string') return Date.parse(v) || 0; if (v?.seconds) return v.seconds * 1000; return Number(new Date(v)) || 0; };

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); const now = Date.now(); const nowIso = new Date(now).toISOString();
  await recordCronRun('no-shows', { startedAt: nowIso });
  let flagged = 0, escalated = 0;
  const tenants = (await db.collection('tenants').get()).docs;
  for (const t of tenants) {
    const tenant: any = t.data() || {}; const T = `tenants/${t.id}`;
    // Cancellations still waiting to be finished (an interrupted call) — always, whatever the no-show switch says.
    try { const Stripe = (await import('stripe')).default; const { sweepPendingCancellations } = await import('@/lib/cancellation-events');
      await sweepPendingCancellations(db, new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }), t.id); } catch { /* next run */ }
    // Booth guests' texts (booked, welcome, credit, overage) — their own switch; only with booth rental.
    try { const { sendBoothGuestTexts } = await import('@/lib/booth-texts'); await sendBoothGuestTexts(db, t.id, tenant); } catch { /* next run */ }
    // Providers hear about changes to their visits (moved, cancelled, handed over, added on) — lib/visit-watch.
    const justCancelled: Array<{ clientId: string | null; appointmentId: string }> = [];
    try { const { releaseHeldTexts } = await import('@/lib/notify'); await releaseHeldTexts(db, t.id, tenant, now); } catch { /* next run */ }   // texts held for quiet hours go out when they end
    try { const { watchVisits } = await import('@/lib/visit-watch'); await watchVisits(db, t.id, tenant, now, (x) => justCancelled.push(x)); } catch { /* next run */ }
    try { const { caseNudges } = await import('@/lib/case-nudges'); await caseNudges(db, t.id, tenant); } catch { /* next run */ }
    try { const { redoPaySweep } = await import('@/lib/redo-pay'); await redoPaySweep(db, t.id, tenant); } catch { /* next run */ }
    try { const { missedPickupSweep } = await import('@/lib/refund-payouts'); await missedPickupSweep(db, t.id, tenant); } catch { /* next run */ }
    // Client aftercare right after checkout, and the check-in a few days later (lib/aftercare-send).
    try { const { aftercareSweep } = await import('@/lib/aftercare-send'); await aftercareSweep(db, t.id, tenant, now); } catch { /* next run */ }
    try { const { renterAftercareSweep } = await import('@/lib/renter-aftercare'); await renterAftercareSweep(db, t.id, tenant, now); } catch { /* next run */ }   // renters' own aftercare
    // Before the visit: the check goes out your cancellation window plus a day before, one nudge (lib/prep-check-server).
    try { const { prepSweep } = await import('@/lib/prep-check-server'); await prepSweep(db, t.id, tenant, now); } catch { /* next run */ }
    // The waitlist: cancelled times become openings, offered to whoever fits; holds that run out move on (lib/waitlist-server).
    // Tidy my day: asks past their deadline end with nobody moved (lib/tidy-server) — before the waitlist looks at gaps.
    try { const { expireTidy } = await import('@/lib/tidy-server'); await expireTidy(db, t.id, now); } catch { /* next run */ }
    try { const { calloutSweep } = await import('@/lib/callout-choices'); await calloutSweep(db, t.id, now); } catch { /* next run */ }   // callouts: call list, then kept times to the waitlist
    try { const { appReplyFallback } = await import('@/lib/client-messages'); await appReplyFallback(db, t.id, now); } catch { /* next run */ }   // app replies unseen for 10 minutes → a text
    try { const { waitlistSweep } = await import('@/lib/waitlist-server'); await waitlistSweep(db, t.id, tenant, now); } catch { /* next run */ }
    // Opportunities: once a day after 9 am local — find, hand out, expire, check who came back (lib/opportunities-server).
    try { const { opportunitySweep } = await import('@/lib/opportunities-server'); await opportunitySweep(db, t.id, tenant, now); } catch { /* next run */ }
    try { const { renterOpportunitySweep } = await import('@/lib/opportunities-server'); await renterOpportunitySweep(db, t.id, tenant, now); } catch { /* next run */ }   // renters' own, when the business allows it
    // Referrals: credit for a friend's first paid visit, holds for a manager, refunds taken back (lib/referrals-server). Every 30 minutes.
    if ((tenant as any)?.referrals?.on === true) { try { const mk = db.doc(`tenants/${t.id}/private/referralSweep`); const last = Date.parse(String(((await mk.get()).data() || {}).at || '')) || 0;
      if (now - last > 30 * 60e3) { await mk.set({ at: new Date(now).toISOString() }, { merge: true }); const { referralSweep } = await import('@/lib/referrals-server'); await referralSweep(db, t.id, tenant, now);
        try { const { campaignSweep } = await import('@/lib/creator-campaigns-server'); await campaignSweep(db, t.id, tenant, now); } catch (e) { console.error('[cron] creator campaigns', e); } } } catch { /* next run */ } }   // …and creator campaigns: reminders, late marks, the cost guard
    // …and the moment something happens (a cancellation, a confirmed no-show, a checkout with nothing booked next): a task for
    // that client now, sent at its time — then anything scheduled whose time has come.
    try { const { opportunityEvents } = await import('@/lib/opportunities-server'); await opportunityEvents(db, t.id, tenant, now, justCancelled); } catch { /* next run */ }
    try { const { opportunityDue } = await import('@/lib/opportunities-server'); await opportunityDue(db, t.id, tenant, now); } catch { /* next run */ }
    // A spare time the waitlist couldn't fill, 3 to 48 hours away: a "would you like it?" to a few clients who are about due.
    try { const { opportunityGaps } = await import('@/lib/opportunities-server'); await opportunityGaps(db, t.id, tenant, now); } catch { /* next run */ }
    try { const { opportunitySoloList } = await import('@/lib/opportunities-server'); await opportunitySoloList(db, t.id, tenant, now); } catch { /* next run */ }   // solo: the evening list is ready
    if (!automationOn(tenant, 'no-show-check')) continue;   // switched off in Automations
    const windowMin = Number(tenant.noShowWindowMinutes ?? 15); const confirmMin = Number(tenant.noShowConfirmWindowMinutes ?? 10);
    try {
      // Bookings that started in the last 12 hours (one-field range — no special index needed); the rest is checked here.
      const snap = await db.collection(`${T}/appointments`).where('startTime', '>=', new Date(now - 12 * 3600000).toISOString()).where('startTime', '<=', new Date(now - windowMin * 60000).toISOString()).get();
      let admins: any[] | null = null;
      for (const d of snap.docs) {
        const a: any = { id: d.id, ...(d.data() || {}) };
        if (a.isWalkIn || a.noBookedTime || a.isTable) continue;   // no booked time to miss
        // 1) FLAG — every signal must agree
        if (!a.suspectedNoShow) {
          const stillBooked = stageOf(a) === 'booked';   // not arrived, waiting, in service, paid, cancelled…
          const quiet = !a.lastTouchedAt || now - iso(a.lastTouchedAt) > windowMin * 60000;
          if (!stillBooked || a.actualStartTime || a.checkedInAt || !quiet) continue;
          const deadline = new Date(now + confirmMin * 60000).toISOString();
          const b = db.batch();
          b.set(d.ref, { suspectedNoShow: true, suspectedNoShowAt: nowIso, noShowConfirmDeadline: deadline, noShowConfirmedBy: null, noShowEscalated: false,
            timeline: [...(Array.isArray(a.timeline) ? a.timeline : []), { at: nowIso, kind: 'note', text: `Flagged as a possible missed appointment. The client had not arrived ${windowMin} minutes after the start time.`, by: 'System', via: 'no-show check' }].slice(-60) }, { merge: true });
          const n = db.collection(`${T}/notifications`).doc();
          b.set(n, { id: n.id, userId: a.staffId || null, type: 'suspected_no_show', priority: 'high', appointmentId: a.id, clientId: a.clientId || null, link: `/pos?visit=${a.id}`,
            message: `Action needed: ${a.clientName || 'Guest'} has not arrived for their appointment, which started ${windowMin} minutes ago. Please confirm whether the client is here.`,
            actions: [{ label: 'Confirm Missed Appointment', action: 'confirm_no_show', style: 'destructive' }, { label: 'Client Is Here', action: 'dismiss_no_show', style: 'primary' }],
            expiresAt: deadline, createdAt: nowIso, read: false, resolved: false });
          await b.commit(); flagged++; await noteAutomation(db, t.id, 'no-show-check'); continue;
        }
        // 2) ESCALATE — flagged, deadline passed, nobody answered, still not here
        if (a.noShowEscalated === true || !a.noShowConfirmDeadline || iso(a.noShowConfirmDeadline) > now) continue;
        if (a.noShowConfirmedBy || stageOf(a) !== 'booked') { await d.ref.set({ noShowEscalated: true }, { merge: true }); continue; }
        if (!admins) admins = (await db.collection(`${T}/staff`).where('role', 'in', ['admin', 'owner']).get()).docs;
        const b = db.batch(); b.set(d.ref, { noShowEscalated: true, noShowEscalatedAt: nowIso }, { merge: true });
        for (const m of admins) { const n = db.collection(`${T}/notifications`).doc();
          b.set(n, { id: n.id, userId: m.id, type: 'no_show_escalation', priority: 'urgent', appointmentId: a.id, clientId: a.clientId || null, link: `/pos?visit=${a.id}`,
            message: `Action needed: ${a.clientName || 'Guest'} has not arrived for their appointment, and no one has confirmed it yet. Please confirm whether this is a missed appointment.`,
            actions: [{ label: 'Confirm Missed Appointment', action: 'confirm_no_show', style: 'destructive' }, { label: 'Client Is Here', action: 'dismiss_no_show', style: 'primary' }], createdAt: nowIso, read: false, resolved: false }); }
        await b.commit(); escalated++;
      }
    } catch (e) { console.error('[cron/no-shows]', t.id, e); }
  }
  // Stations, kits and linens (O3/O5/O6): reminders to reset a station, and closing out finished visits. The same
  // step also runs from an open front desk (/api/desk/tick), so it doesn't depend on this schedule alone.
  let turnoverNudges = 0, kitsReleased = 0, linenVisits = 0;
  { const { opsTick } = await import('@/lib/ops-tick');
    for (const t of tenants) { try { const r = await opsTick(db, t.id, t.data() || {}, now); turnoverNudges += r.turnoverNudges; kitsReleased += r.kitsReleased; linenVisits += r.linenVisits; } catch (e) { console.error('[cron/no-shows] ops', t.id, e); } } }
  // Station Assist: requests nobody accepted in time → alert the managers once.
  let assistEscalated = 0;
  for (const t of tenants) { try {
    const open = (await db.collection(`tenants/${t.id}/assistRequests`).where('status', '==', 'open').limit(100).get()).docs;
    const due = open.filter((d: any) => { const r: any = d.data() || {}; return !r.escalatedAt && Date.parse(r.escalateAt || '') <= Date.now(); });
    if (!due.length) continue;
    const managers = (await db.collection(`tenants/${t.id}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get()).docs;
    for (const d of due) { const r: any = d.data(); const b = db.batch(); b.set(d.ref, { escalatedAt: nowIso }, { merge: true });
      for (const m of managers) { const n = db.collection(`tenants/${t.id}/notifications`).doc(); b.set(n, { id: n.id, userId: m.id, type: 'assist_escalation', priority: 'urgent', link: '/pos', assistId: d.id, createdAt: nowIso, read: false, resolved: false,
        message: `Action needed: ${r.requestedByName ? r.requestedByName.split(' ')[0] + '’s' : 'a'} request for ${String(r.label || 'help').toLowerCase()}${r.stationName ? ` at ${r.stationName}` : ''} has not been accepted yet.` }); }
      await b.commit(); assistEscalated++; }
  } catch (e) { console.error('[cron/no-shows] assist', t.id, e); } }
  await heartbeat(db, 'no-shows');   // HQ's account check uses this to spot a stopped task
  await recordCronRun('no-shows', { flagged, escalated });   // the watchdog (lib/cron-heartbeat watchCrons) reads this
  return NextResponse.json({ ok: true, flagged, escalated, assistEscalated, turnoverNudges, kitsReleased, linenVisits });
}
