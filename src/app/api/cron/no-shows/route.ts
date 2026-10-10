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
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stageOf } from '@/lib/visit';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const iso = (v: any): number => { if (!v) return 0; if (typeof v === 'string') return Date.parse(v) || 0; if (v?.seconds) return v.seconds * 1000; return Number(new Date(v)) || 0; };

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); const now = Date.now(); const nowIso = new Date(now).toISOString();
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
    try { const { watchVisits } = await import('@/lib/visit-watch'); await watchVisits(db, t.id, tenant, now); } catch { /* next run */ }
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
            timeline: [...(Array.isArray(a.timeline) ? a.timeline : []), { at: nowIso, kind: 'note', text: `Flagged as a possible no-show — no arrival ${windowMin} min after start`, by: 'System', via: 'no-show check' }].slice(-60) }, { merge: true });
          const n = db.collection(`${T}/notifications`).doc();
          b.set(n, { id: n.id, userId: a.staffId || null, type: 'suspected_no_show', priority: 'high', appointmentId: a.id, clientId: a.clientId || null, link: `/pos?visit=${a.id}`,
            message: `${a.clientName || 'Guest'} may be a no-show — their appointment started ${windowMin} min ago and they haven’t arrived`,
            actions: [{ label: 'Confirm No-Show', action: 'confirm_no_show', style: 'destructive' }, { label: 'Client Is Here', action: 'dismiss_no_show', style: 'primary' }],
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
            message: `No answer yet: ${a.clientName || 'Guest'} may be a no-show — please confirm`,
            actions: [{ label: 'Confirm No-Show', action: 'confirm_no_show', style: 'destructive' }, { label: 'Client Is Here', action: 'dismiss_no_show', style: 'primary' }], createdAt: nowIso, read: false, resolved: false }); }
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
        message: `Nobody has taken ${r.requestedByName ? r.requestedByName.split(' ')[0] + '’s' : 'a'} request: ${String(r.label || 'help').toLowerCase()}${r.stationName ? ` at ${r.stationName}` : ''}` }); }
      await b.commit(); assistEscalated++; }
  } catch (e) { console.error('[cron/no-shows] assist', t.id, e); } }
  await heartbeat(db, 'no-shows');   // HQ's account check uses this to spot a stopped task
  return NextResponse.json({ ok: true, flagged, escalated, assistEscalated, turnoverNudges, kitsReleased, linenVisits });
}
