// src/app/api/appt/route.ts
//
// CLIENT SELF-SERVE for appointments — the engine behind the Cancel /
// Reschedule / Running-late buttons in confirmation and reminder
// messages. Auth is a per-appointment ACTION TOKEN (appointment doc's
// manageToken): the link in the client's own email/text is their key,
// scoped to that one appointment. No accounts, no dashboard exposure.
//
// POST { action, tenantId, apptId, k, ... }
//   'view'        → appointment details + policy + this studio's info
//   'cancel'      → cancels (inside the studio's cancel window), frees
//                   the slot, notifies owner + staff
//   'reschedule'  { newDate, newTime } → conflict-checked move on the SAME
//                   staff member; keeps duration; notifies owner + staff.
//                   The client sends WALL-CLOCK ('2026-07-16', '14:30') and
//                   the server turns it into an instant using the studio's
//                   zone. It used to send a finished ISO instant built in the
//                   browser from a fixed offset suffix, which booked every
//                   summer reschedule an hour off. { newStartIso } is still
//                   accepted so an older cached page keeps working.
//   'late'        → one-tap "running late" note to staff + owner
// GET ?tenantId=&apptId=&k=&ics=1 → calendar file (.ics)
//
// Every action stamps the appointment and writes the audit log — client
// self-service leaves the same paper trail as front-desk service.

import { unpaidFeeRuleOf, unpaidFeeLine } from '@/lib/booking-policies';
import { graceRule, graceRemaining } from '@/lib/grace';
import { internalPost, internalOrigin } from '@/lib/message-policy';
import { resolvePolicy } from '@/lib/booking-policies';
import { checkChange, chainAfterMove, deadlineStart, hoursToDeadline } from '@/lib/change-rules';
import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { smsConfigured, sendTenantSms } from '@/lib/sms';
import { addDays, formatDateTime, isValidTimeZone, tenantTimeZone, todayIn, wallToUtc } from '@/lib/tenant-time';

const overlaps = (s1: number, e1: number, s2: number, e2: number) => s1 < e2 && s2 < e1;

async function loadAuthed(db: any, tenantId: string, apptId: string, k: any) {
  if (!tenantId || !apptId || !k || String(k).length < 16) return null;
  const ref = db.doc(`tenants/${tenantId}/appointments/${apptId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const a = snap.data() as any;
  // v18 — two accepted keys: the manageToken (from email links) OR the
  // appointment's checkInToken (the master /check-in portal's own token),
  // so the portal's reschedule view authenticates with the key it already
  // has. Both are long random secrets delivered only to the client.
  const key = String(k);
  const ok = (a.manageToken && a.manageToken === key) || (a.checkInToken && a.checkInToken === key);
  if (!ok) return null;
  return { ref, a };
}

async function notifyStaffAndOwner(db: any, tenantId: string, a: any, message: string) {
  try {
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({ id: nRef.id, type: 'appointment', read: false, createdAt: new Date().toISOString(), link: '/planner', message });
  } catch { /* best-effort */ }
  try {
    if (a.staffId && smsConfigured()) {
      const s = (await db.doc(`tenants/${tenantId}/staff/${a.staffId}`).get()).data() as any;
      if (s?.phone) await sendTenantSms(db, tenantId, s.phone, message);
    }
  } catch { /* text is a bonus */ }
}

/** The time a client reads. Takes the studio's zone when it has one, and
 *  falls back to the stored fixed offset otherwise — same migration ladder as
 *  the reminder cron, and for the same reason: a correct zone is better, but
 *  nobody's times should silently shift by an hour because we improved the
 *  code. An offset cannot know that -300 becomes -240 in March, so every
 *  "when" label here was an hour out for eight months of the year. */
const fmtWhen = (iso: string, tzOffset: number, zone?: string | null) => {
  if (zone) return formatDateTime(iso, zone);
  const d = new Date(new Date(iso).getTime() + tzOffset * 60000);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}`;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId, apptId } = body || {};
    if (!action || !tenantId || !apptId) return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    const db = getAdminDb();
    const authed = await loadAuthed(db, tenantId, apptId, body.k);
    if (!authed) return NextResponse.json({ ok: false, error: 'This link is no longer valid — please open the link in your most recent confirmation.' }, { status: 401 });
    const { ref, a } = authed;

    const tDoc = (await db.doc(`tenants/${tenantId}`).get()).data() as any || {};
    const studioName = tDoc.name || tDoc.businessName || 'The studio';
    const cfg = tDoc.clientNotify || {};
    // Your cancellation window from Booking policies (the old hidden clientNotify.cancelHours is retired).
    const cancelHours = Math.max(0, Number(resolvePolicy(tDoc).cancel.windowHours.value) || 24);
    // v19 — RESCHEDULING has its OWN, much shorter cutoff (default 2h,
    // configurable via clientNotify.rescheduleCutoffHours). Psychology:
    // a reschedule KEEPS the booking and the revenue — every one you
    // allow is a cancellation or no-show you avoided. Only cancellation
    // (money walking out) uses the longer fee window, and even then the
    // fee engine recovers the cost rather than forcing a phone call.
    // The one change cutoff, from Booking policies (reads this older setting too).
    const rescheduleCutoffHours = Math.max(0, Number(resolvePolicy(tDoc).change.cutoffHours.value) || 0);
    const tzOffset = Number.isFinite(Number(cfg.tzOffsetMinutes)) ? Number(cfg.tzOffsetMinutes) : -300;
    // An IANA zone wins where the studio has set one; otherwise the legacy
    // offset above still drives everything, unchanged.
    const hasZone = isValidTimeZone(tDoc.timezone) || isValidTimeZone(tDoc.timeZone) || isValidTimeZone(tDoc.retailSettings?.timezone);
    const zone = hasZone ? tenantTimeZone(tDoc) : null;
    // Deadlines count from the booking's ORIGINAL time unless the business chose otherwise.
    const startMs = deadlineStart(tDoc, a).getTime();
    const insideWindow = Date.now() <= startMs - cancelHours * 3600000;
    // Moving it: the shared change rules (cutoff + how many times it's been moved).
    // When WE asked them to move it (running late → "please pick a new time"), the usual cutoff and change limit don't apply.
    // Our doing (we asked them to reschedule, or their provider is running late and they haven't chosen yet): no limits, no fee, not counted.
    const studioCaused = !!a.studioAskedToMove || !!(a.providerDelay && !['keep', 'cancel'].includes(String(a.providerDelay.reply || ''))) || a.disruption?.status === 'pending';
    // Record an outcome against the disruption (callout / interruption) this booking belongs to — for the insurance packet and renter reimbursements.
    const recordDisruption = async (fields: any) => { const d = a.disruption; if (!d?.id || d.status !== 'pending') return;
      await db.doc(`tenants/${tenantId}/${d.kind === 'callout' ? 'providerCallouts' : 'interruptions'}/${d.id}`).set({ affected: { [apptId]: { ...fields, outcomeAt: new Date().toISOString(), by: a.clientName || 'Client' } } }, { merge: true }).catch(() => {});
      await ref.set({ disruption: { ...d, status: 'resolved', outcome: fields.outcome } }, { merge: true }).catch(() => {}); };
    const change = studioCaused ? { ...checkChange(tDoc, a, 'client'), allowed: true, needsApproval: false, blocked: false, canRequest: false, reason: null } : checkChange(tDoc, a, 'client');
    const insideRescheduleWindow = change.allowed;
    // Your reschedule fee (Booking policies) — counted from the ORIGINAL time; none when WE asked them to move it; renters keep their own rules.
    const rp = resolvePolicy(tDoc).change;
    const rFee = Number(rp.fee.value) || 0, rWin = Number(rp.feeWindowHours.value) || 0;
    // Late-reschedule grace the client can use themselves (Booking policies → grace → "online").
    let selfGrace: { remaining: number; allowance: number; periodMonths: number } | null = null;
    { const gr = graceRule(tDoc, 'late_reschedule');
      if (gr.enabled && gr.selfServe && a.clientId) { const us = (await db.collection(`tenants/${tenantId}/graceUses`).where('clientId', '==', String(a.clientId)).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
        const g = graceRemaining(tDoc, 'late_reschedule', us, { clientId: String(a.clientId), serviceId: a.serviceId || null, staffId: a.staffId || null });
        if (g.remaining > 0) selfGrace = { remaining: g.remaining, allowance: g.allowance, periodMonths: g.periodMonths }; } }
    const feeIfMovedNow = !studioCaused && !a.isRenterBooking && rFee > 0 && rWin > 0 && hoursToDeadline(tDoc, a) < rWin ? rFee : 0;
    // Over the change limit and the business approves further moves → tell the team, ONCE, with the client's note.
    const requestChange = async (note: string | null) => {
      if (a.changeRequestedAt) return false;
      const nowIso = new Date().toISOString();
      await ref.set({ changeRequestedAt: nowIso, ...(note ? { changeRequestNote: note } : {}) }, { merge: true }).catch(() => {});
      const n = db.collection(`tenants/${tenantId}/notifications`).doc();
      await n.set({ id: n.id, userId: null, read: false, createdAt: nowIso, type: 'change_request', link: 'pos',
        message: `${a.clientName || 'A client'} is asking you to reschedule their ${a.serviceName || 'appointment'}${change.count ? ` (already rescheduled ${change.count} time${change.count === 1 ? '' : 's'})` : ' (inside your change cutoff)'}${note ? ` — “${note}”` : ''}. Please reschedule it for them.` }).catch(() => {});
      await logAuditAdmin(db, tenantId, { action: 'appointment.change_requested', targetType: 'appointment', targetId: apptId, summary: `${a.clientName || 'Client'} asked us to reschedule it — ${change.count >= change.limit && change.limit > 0 ? `over the change limit (${change.count}/${change.limit})` : 'inside the change cutoff'}${note ? `: “${note}”` : ''}`, actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'visit link' } }).catch(() => {});
      return true;
    };
    const already = ['cancelled', 'canceled', 'completed', 'no_show'].includes(String(a.status || ''));

    if (action === 'view') {
      return NextResponse.json({
        ok: true, studioName,
        appt: {
          serviceName: a.serviceName || a.service || 'Appointment',
          staffName: a.staffName || null,
          startTime: a.startTime, endTime: a.endTime || null,
          status: a.status || 'confirmed',
          whenLabel: fmtWhen(a.startTime, tzOffset, zone),
        },
        policy: {
          cancelHours, canChange: insideWindow && !already, tzOffsetMinutes: tzOffset,
          rescheduleCutoffHours, canReschedule: insideRescheduleWindow && !already,
          changeRule: change.allowed ? null : { reason: change.reason, needsApproval: change.needsApproval, canRequest: change.canRequest, count: change.count, limit: change.limit },
          rescheduleFee: feeIfMovedNow, rescheduleFeeWindowHours: rWin, graceAvailable: feeIfMovedNow > 0 ? selfGrace : null,
          unpaidLine: feeIfMovedNow > 0 ? unpaidFeeLine(unpaidFeeRuleOf(tDoc)) : null,
          // The earliest date the CLIENT may pick, on the STUDIO's calendar.
          // The pages used to compute this from the browser's clock, so a
          // client travelling — or simply awake late — could be offered a
          // date the studio already considers past.
          earliestDate: zone ? addDays(todayIn(zone), 1) : addDays(todayIn(null, new Date(Date.now() + tzOffset * 60000)), 1),
          timeZone: zone || null,
        },
      });
    }

    if (already) return NextResponse.json({ ok: false, error: 'This appointment is already finished or cancelled.' }, { status: 409 });

    if (action === 'late') {
      const nowIso = new Date().toISOString();
      await ref.set({ clientRunningLateAt: nowIso }, { merge: true });
      await notifyStaffAndOwner(db, tenantId, a, `${a.clientName || 'Your client'} is running late for ${fmtWhen(a.startTime, tzOffset, zone)} — they tapped "running late".`);
      return NextResponse.json({ ok: true });
    }

    if (action === 'cancel') {
      // Inside the window, cancelling goes through the visit link, where your late-cancellation policy (and fee) applies.
      if (!insideWindow) return NextResponse.json({ ok: false, error: `It’s within ${cancelHours} hours of your appointment, so a late-cancellation policy applies — cancel from your visit link to see exactly what that means.`, visitLink: a.checkInToken ? `/check-in/${a.checkInToken}` : null }, { status: 422 });
      const nowIso = new Date().toISOString();
      const cancelFields = { status: 'cancelled', cancelledAt: nowIso, cancelledBy: 'client_self_serve' };
      await ref.set(cancelFields, { merge: true });
      if (a.checkInToken) {
        // The portal she is standing on reads the mirror, so it has to move too.
        await Promise.all([
          db.doc(`appointmentCheckIns/${a.checkInToken}`).set({ ...cancelFields, tenantId }, { merge: true }).catch(() => {}),
          db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`).set({ ...cancelFields, tenantId }, { merge: true }).catch(() => {}),
        ]);
      }

      // ── THE REST OF THE SAME VISIT ────────────────────────────────────────
      // A multi-provider visit is stored as one row per leg. Cancelling only
      // the leg she happened to tap left her booked for the others: the studio
      // still expected her, the chairs stayed held, and she got a reminder for
      // an appointment she believed she had cancelled. The legs go together.
      //
      // A party is one row per GUEST — different people — so a guest cancelling
      // never touches anyone else. Only the organizer's row cancels the party,
      // which is what cancelling a party of five means.
      const visitId = a.multiProviderGroupId || null;
      const partyId = a.isPrimaryGroup ? (a.groupBookingId || null) : null;
      let alsoCancelled = 0;
      if (visitId || partyId) {
        const apptsCol = db.collection(`tenants/${tenantId}/appointments`);
        const sibSnaps = await Promise.all([
          visitId ? apptsCol.where('multiProviderGroupId', '==', visitId).get().catch(() => ({ docs: [] as any[] })) : Promise.resolve({ docs: [] as any[] }),
          partyId ? apptsCol.where('groupBookingId', '==', partyId).get().catch(() => ({ docs: [] as any[] })) : Promise.resolve({ docs: [] as any[] }),
        ]);
        const seen = new Set<string>([apptId]);
        for (const snap of sibSnaps) {
          for (const d of (snap as any).docs) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            const s = d.data() as any;
            if (['cancelled', 'canceled', 'completed', 'no_show'].includes(String(s.status || ''))) continue;
            const sib = { ...cancelFields, cancelledWithAppointmentId: apptId };
            await d.ref.set(sib, { merge: true }).catch(() => {});
            if (s.checkInToken) {
              await Promise.all([
                db.doc(`appointmentCheckIns/${s.checkInToken}`).set({ ...sib, tenantId }, { merge: true }).catch(() => {}),
                db.doc(`tenants/${tenantId}/appointmentCheckIns/${s.checkInToken}`).set({ ...sib, tenantId }, { merge: true }).catch(() => {}),
              ]);
            }
            alsoCancelled++;
          }
        }
      }

      const extra = alsoCancelled > 0
        ? ` This freed ${alsoCancelled + 1} linked bookings on the same visit.`
        : '';
      await notifyStaffAndOwner(db, tenantId, a, `${a.clientName || 'A client'} cancelled ${fmtWhen(a.startTime, tzOffset, zone)}${a.staffName ? ` with ${a.staffName}` : ''} (self-serve). The slot is open again.${extra}`);
      await logAuditAdmin(db, tenantId, {
        action: 'appointment.client_cancelled', targetType: 'appointment', targetId: apptId,
        summary: `${a.clientName || 'Client'} self-cancelled ${fmtWhen(a.startTime, tzOffset, zone)}${alsoCancelled > 0 ? ` (+${alsoCancelled} linked)` : ''}`,
        actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'manage-link' },
      });
      return NextResponse.json({ ok: true, ...(alsoCancelled > 0 ? { alsoCancelled } : {}) });
    }

    // Running late, past the grace time → they chose from the options we sent (a shorter visit, another provider, a new time).
    if (action === 'late_choice') {
      const lc = a.lateChoices;
      if (!lc || lc.status !== 'sent' || lc.choice) return NextResponse.json({ ok: false, error: 'These options aren’t open any more — the team will be in touch.' }, { status: 409 });
      const choice = String(body.choice || '');
      if (!Array.isArray(lc.options) || !lc.options.includes(choice)) return NextResponse.json({ ok: false, error: 'That option isn’t available.' }, { status: 400 });
      const nowIso = new Date().toISOString(); const who = a.clientName || 'Client';
      const answered = { lateChoices: { ...lc, choice, answeredAt: nowIso } };
      const put = async (f: any) => { await ref.set(f, { merge: true }); if (a.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {}), db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {})]); };
      const tellTeam = async (message: string) => { const n = db.collection(`tenants/${tenantId}/notifications`).doc(); await n.set({ id: n.id, userId: a.staffId || null, read: false, createdAt: nowIso, type: 'late_choice', link: 'pos', appointmentId: apptId, message }).catch(() => {}); };
      if (choice === 'condense') {
        const drop: string[] = Array.isArray(lc.dropAddOnIds) ? lc.dropAddOnIds : [];
        const names = (lc.dropNames || []).join(' and ') || 'the add-ons';
        await put({ ...answered, addOnIds: (a.addOnIds || []).filter((id: string) => !drop.includes(id)), droppedAddOnIds: drop,
          lateReply: { kind: 'condense', message: `Thanks — we’ll do a shorter visit today, without ${names}, so you finish on time.`, at: nowIso, by: who, clientAgreed: true } });
        await tellTeam(`${who} (running late) chose a shorter visit — without ${names}.`);
        await logAuditAdmin(db, tenantId, { action: 'late.client_chose', targetType: 'appointment', targetId: apptId, summary: `${who} chose a shorter visit (without ${names}) after running late`, actor: { type: 'user', name: who, role: 'client', via: 'visit link' } }).catch(() => {});
        return NextResponse.json({ ok: true, choice });
      }
      if (choice === 'switch') {
        const offer = { toStaffId: lc.toStaffId, toStaffName: lc.toStaffName || null, fromStaffId: a.staffId || null, fromStaffName: a.staffName || null, startAt: lc.etaAt, at: nowIso, by: 'client’s choice (running late)', status: 'pending' };
        await put({ ...answered, providerOffer: offer });
        return NextResponse.json({ ok: true, choice, next: 'accept_offer' });   // the visit link confirms it (re-checks they're still free)
      }
      await put(answered);                                                     // reschedule → their usual reschedule screen
      await tellTeam(`${who} (running late) chose to pick a new time.`);
      return NextResponse.json({ ok: true, choice, next: 'reschedule' });
    }
    // A callout or business interruption → they cancel with no fee, deposit refunded or kept as credit (their choice).
    if (action === 'disruption_reply') {
      const d = a.disruption;
      if (!d || d.status !== 'pending') return NextResponse.json({ ok: false, error: 'Your appointment is going ahead as booked.' }, { status: 409 });
      if (String(body.choice || '') !== 'cancel') return NextResponse.json({ ok: false, error: 'Choose a new time or cancel.' }, { status: 400 });
      const nowIso = new Date().toISOString();
      const dep = a.depositStatus === 'paid' ? Number(a.depositAmountCents) || 0 : 0;
      const asCredit = body.deposit === 'credit';
      const cancelFields = { status: 'cancelled', cancelledAt: nowIso, cancelledBy: 'client_self_serve', cancellationReason: d.kind === 'callout' ? 'provider_callout' : 'business_interruption', cancellationFeeCharged: 0, cancellationFeeWaived: true, studioCancelled: true, ...(d.kind === 'interruption' ? { interruptionId: d.id, lostToInterruption: true } : { calloutId: d.id }) };
      await ref.set(cancelFields, { merge: true });
      if (a.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set({ ...cancelFields, tenantId }, { merge: true }).catch(() => {}), db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`).set({ ...cancelFields, tenantId }, { merge: true }).catch(() => {})]);
      if (dep > 0) { const dRef = db.collection(`tenants/${tenantId}/depositDecisions`).doc(); await dRef.set({ id: dRef.id, tenantId, appointmentId: apptId, clientId: a.clientId || null, trigger: d.kind === 'callout' ? 'provider_callout' : 'business_interruption', outcome: asCredit ? 'rollover' : 'refund_pending', reason: `${d.reasonLabel || 'Disruption'} — client cancelled`, amountDollars: dep / 100, decidedAt: nowIso }).catch(() => {}); }
      await recordDisruption({ outcome: 'cancelled', ...(dep > 0 ? (asCredit ? { creditCents: dep } : { refundCents: dep }) : {}) });
      const n = db.collection(`tenants/${tenantId}/notifications`).doc();
      await n.set({ id: n.id, userId: a.staffId || null, read: false, createdAt: nowIso, type: 'disruption_reply', link: 'pos', appointmentId: apptId, message: `${a.clientName || 'A client'} cancelled (${d.kind === 'callout' ? 'callout' : 'interruption'}) — no fee${dep > 0 ? `; deposit ${asCredit ? 'kept as credit' : 'to refund'}` : ''}.` }).catch(() => {});
      await logAuditAdmin(db, tenantId, { action: 'disruption.client_cancelled', targetType: 'appointment', targetId: apptId, summary: `${a.clientName || 'Client'} cancelled because of the ${d.kind === 'callout' ? 'provider callout' : 'business interruption'} — no fee${dep > 0 ? `; $${(dep / 100).toFixed(2)} deposit ${asCredit ? 'kept as credit' : 'to be refunded'}` : ''}`, actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'visit link' } }).catch(() => {});
      return NextResponse.json({ ok: true, deposit: dep > 0 ? (asCredit ? 'credit' : 'refund') : null });
    }
    // We offered another provider → they accept (it's applied) or decline (back to the team).
    if (action === 'provider_offer_reply') {
      const po = a.providerOffer;
      if (!po || po.status !== 'pending') return NextResponse.json({ ok: false, error: 'There’s no open offer on this appointment.' }, { status: 409 });
      const choice = String(body.choice || ''); const nowIso = new Date().toISOString();
      const mirrorSet = async (f: any) => { if (a.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {}), db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {})]); };
      const tellStaff = async (userId: string | null, message: string) => { const n = db.collection(`tenants/${tenantId}/notifications`).doc(); await n.set({ id: n.id, userId, read: false, createdAt: nowIso, type: 'provider_offer_reply', link: 'pos', appointmentId: apptId, message }).catch(() => {}); };
      const when = new Date(po.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone || undefined });
      if (choice === 'decline') {
        const f = { providerOffer: { ...po, status: 'declined', answeredAt: nowIso } };
        await ref.set(f, { merge: true }); await mirrorSet(f);
        await tellStaff(po.fromStaffId || null, `${a.clientName || 'Your client'} declined ${po.toStaffName ? String(po.toStaffName).split(' ')[0] : 'the other provider'} at ${when} — decide what happens next (Operations).`);
        await logAuditAdmin(db, tenantId, { action: 'appointment.provider_offer_declined', targetType: 'appointment', targetId: apptId, summary: `${a.clientName || 'Client'} declined ${po.toStaffName || 'another provider'} at ${when}`, actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'visit link' } }).catch(() => {});
        return NextResponse.json({ ok: true, choice });
      }
      if (choice !== 'accept') return NextResponse.json({ ok: false, error: 'Accept or decline.' }, { status: 400 });
      const durMs = Math.max(15 * 60000, (Date.parse(a.endTime || a.startTime) - Date.parse(a.startTime)) || 60 * 60000);
      const s0 = Date.parse(po.startAt);
      const { providerFree } = await import('@/lib/provider-availability');
      if (!(await providerFree(db, `tenants/${tenantId}`, po.toStaffId, s0, s0 + durMs, apptId))) {
        const f = { providerOffer: { ...po, status: 'expired', answeredAt: nowIso } };
        await ref.set(f, { merge: true }); await mirrorSet(f);
        await tellStaff(po.fromStaffId || null, `${a.clientName || 'Your client'} accepted ${po.toStaffName || 'the other provider'} at ${when}, but that time is no longer free — decide what happens next.`);
        return NextResponse.json({ ok: false, error: 'Sorry — that time has just been taken. We’ll be in touch with another option.' }, { status: 409 });
      }
      // Apply it. The ORIGINAL time and provider are kept (history); the planner shows the new ones.
      const applied = {
        staffId: po.toStaffId, staffName: po.toStaffName || null,
        startTime: new Date(s0).toISOString(), endTime: new Date(s0 + durMs).toISOString(),
        originalScheduledTime: a.originalScheduledTime || a.startTime, originalStaffId: a.originalStaffId || a.staffId || null,
        providerHistory: FieldValue.arrayUnion({ from: a.staffId || null, fromName: po.fromStaffName || null, to: po.toStaffId, toName: po.toStaffName || null, at: nowIso, by: 'client consent', offeredBy: po.by || null }),
        providerOffer: { ...po, status: 'accepted', answeredAt: nowIso },
        lateReply: { kind: 'switch', message: `Thanks — ${String(po.toStaffName || 'our team').split(' ')[0]} will see you at ${when}.`, at: nowIso, by: a.clientName || 'Client' },
        studioAskedToMove: false,
      };
      await ref.set(applied, { merge: true });
      await mirrorSet({ staffId: applied.staffId, staffName: applied.staffName, startTime: applied.startTime, endTime: applied.endTime, providerOffer: applied.providerOffer, lateReply: applied.lateReply, studioAskedToMove: false });
      await recordDisruption({ outcome: 'reassigned', newStaffId: po.toStaffId, newStartTime: applied.startTime });
      await tellStaff(po.toStaffId, `${a.clientName || 'A client'} is now with you at ${when} (moved from ${po.fromStaffName ? String(po.fromStaffName).split(' ')[0] : 'another provider'}).`);
      if (po.fromStaffId) await tellStaff(po.fromStaffId, `${a.clientName || 'Your client'} accepted ${po.toStaffName ? String(po.toStaffName).split(' ')[0] : 'another provider'} at ${when} — they’re no longer on your schedule.`);
      await logAuditAdmin(db, tenantId, { action: 'appointment.provider_changed', targetType: 'appointment', targetId: apptId,
        summary: `${a.clientName || 'Client'} accepted ${po.toStaffName || 'another provider'} at ${when} (was ${po.fromStaffName || 'their provider'} at ${new Date(a.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone || undefined })}). Late fee and provider pay unchanged — review if needed.`,
        actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'visit link' } }).catch(() => {});
      return NextResponse.json({ ok: true, choice, startTime: applied.startTime, staffName: applied.staffName });
    }
    // Their provider is running late → they choose: keep it, or cancel with no fee (reschedule uses the normal flow, unrestricted).
    if (action === 'provider_delay_reply') {
      const pd = a.providerDelay;
      if (!pd) return NextResponse.json({ ok: false, error: 'Your appointment is on schedule.' }, { status: 409 });
      const choice = String(body.choice || '');
      const nowIso = new Date().toISOString();
      if (choice === 'keep') {
        // An optional thank-you credit for waiting (Booking policies) — issued once.
        const creditCents = Math.round((Number(tDoc.bookingPolicies?.providerDelayCredit) || 0) * 100);
        let credited = 0;
        if (creditCents > 0 && a.clientId && !pd.creditIssued) {
          const r = await internalPost(internalOrigin(tDoc, req.nextUrl.origin), '/api/credits/issue', { tenantId, clientId: a.clientId, amountCents: creditCents, type: 'courtesy', source: 'provider_delay', reason: `Thank you for waiting (${pd.minutes} min delay)`, createdBy: 'system' }, { retries: 0 });
          if (r.ok && r.data?.ok !== false) credited = creditCents;
        }
        const f = { providerDelay: { ...pd, reply: 'keep', replyAt: nowIso, ...(credited ? { creditIssued: credited } : {}) } };
        await ref.set(f, { merge: true });
        if (a.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {}), db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {})]);
        const n = db.collection(`tenants/${tenantId}/notifications`).doc();
        await n.set({ id: n.id, userId: a.staffId || null, read: false, createdAt: nowIso, type: 'provider_delay_reply', link: 'pos', appointmentId: apptId, message: `${a.clientName || 'Your client'} will wait — see them around ${new Date(pd.newStartAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone || undefined })}.` }).catch(() => {});
        await logAuditAdmin(db, tenantId, { action: 'appointment.provider_delay_reply', targetType: 'appointment', targetId: apptId, summary: `${a.clientName || 'Client'} chose to keep it (provider running ~${pd.minutes} min behind)`, actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'visit link' } }).catch(() => {});
        return NextResponse.json({ ok: true, choice, creditCents: credited });
      }
      if (choice === 'cancel') {
        const depositPaid = a.depositStatus === 'paid' || Number(a.depositAmountCents) > 0 && a.status !== 'pending_payment';
        const cancelFields = { status: 'cancelled', cancelledAt: nowIso, cancelledBy: 'client_self_serve', cancellationReason: 'provider_delay', cancellationFeeCharged: 0, cancellationFeeWaived: true, providerDelay: { ...pd, reply: 'cancel', replyAt: nowIso }, studioCancelled: true };
        await ref.set(cancelFields, { merge: true });
        if (a.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set({ ...cancelFields, tenantId }, { merge: true }).catch(() => {}), db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`).set({ ...cancelFields, tenantId }, { merge: true }).catch(() => {})]);
        if (depositPaid) { const dRef = db.collection(`tenants/${tenantId}/depositDecisions`).doc(); await dRef.set({ id: dRef.id, tenantId, appointmentId: apptId, clientId: a.clientId || null, trigger: 'provider_delay', outcome: resolvePolicy(tDoc).deposit.outcomes.onStudioCancel === 'rollover' ? 'rollover' : 'refund_pending', reason: 'Provider running late — client cancelled', amountDollars: (Number(a.depositAmountCents) || 0) / 100, decidedAt: nowIso }).catch(() => {}); }
        const n = db.collection(`tenants/${tenantId}/notifications`).doc();
        await n.set({ id: n.id, userId: a.staffId || null, read: false, createdAt: nowIso, type: 'provider_delay_reply', link: 'pos', appointmentId: apptId, message: `${a.clientName || 'Your client'} cancelled because of the delay — no fee${depositPaid ? '; their deposit needs refunding (or crediting)' : ''}.` }).catch(() => {});
        await logAuditAdmin(db, tenantId, { action: 'appointment.provider_delay_reply', targetType: 'appointment', targetId: apptId, summary: `${a.clientName || 'Client'} cancelled — provider running ~${pd.minutes} min behind (no fee${depositPaid ? '; deposit to refund/credit' : ''})`, actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'visit link' } }).catch(() => {});
        return NextResponse.json({ ok: true, choice, depositRefund: depositPaid });
      }
      return NextResponse.json({ ok: false, error: 'Choose keep, reschedule or cancel.' }, { status: 400 });
    }
    // "Ask us to move it" — when the change limit needs the team's OK.
    // Open times to move to — same provider, service and length; the business's normal client rules.
    if (action === 'slots') {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || '')) ? String(body.from) : new Date().toISOString().slice(0, 10);
      const { clientOpenTimes } = await import('@/lib/reschedule-slots');
      const r = await clientOpenTimes(db, tenantId, apptId, a, from, Number(body.days) || 14);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    if (action === 'request_change') {
      if (change.allowed) return NextResponse.json({ ok: false, error: 'You can move this one yourself — pick a new time.' }, { status: 400 });
      if (!change.canRequest) return NextResponse.json({ ok: false, error: change.reason }, { status: 409 });
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
      const first = await requestChange(note || null);
      return NextResponse.json({ ok: true, requested: true, alreadyAsked: !first });
    }
    if (action === 'reschedule') {
      if (!change.allowed) {
        if (change.needsApproval) await requestChange(null);
        return NextResponse.json({ ok: false, error: change.reason, requested: change.needsApproval }, { status: 409 });
      }
      // WALL CLOCK IN, INSTANT OUT. '2026-07-16' + '14:30' means half past two
      // on the studio's wall — a fact only the server can turn into a moment,
      // because only it knows the zone and whether daylight saving applies on
      // that date. newStartIso stays accepted for pages served before this.
      const usingGrace = body.useGrace === true && feeIfMovedNow > 0 && !!selfGrace;
      const newDate = String(body.newDate || '').slice(0, 10);
      const newTime = String(body.newTime || '').slice(0, 5);
      let newStart: Date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(newDate) && /^\d{2}:\d{2}$/.test(newTime)) {
        const [hh, mm] = newTime.split(':').map(Number);
        newStart = zone
          ? wallToUtc(newDate, hh, mm, zone)
          : new Date(Date.UTC(+newDate.slice(0, 4), +newDate.slice(5, 7) - 1, +newDate.slice(8, 10), hh, mm) - tzOffset * 60000);
      } else {
        newStart = new Date(String(body.newStartIso || ''));
      }
      if (Number.isNaN(newStart.getTime())) return NextResponse.json({ ok: false, error: 'Pick a date and time.' }, { status: 400 });
      const nowMs = Date.now();
      if (newStart.getTime() < nowMs + 2 * 3600000) return NextResponse.json({ ok: false, error: 'Pick a time at least 2 hours from now.' }, { status: 422 });
      if (newStart.getTime() > nowMs + 60 * 86400000) return NextResponse.json({ ok: false, error: 'Pick a time within the next 60 days.' }, { status: 422 });

      const durMs = Math.max(15 * 60000, new Date(a.endTime || a.startTime).getTime() - startMs || 60 * 60000);
      const newEnd = new Date(newStart.getTime() + durMs);
      // Conflict check against the SAME staff member's calendar, honoring pads.
      const dayStart = new Date(newStart.getTime() - 86400000).toISOString();
      const dayEnd = new Date(newEnd.getTime() + 86400000).toISOString();
      const takenBy = (docs: any[]) => docs.some((d: any) => { if (d.id === apptId) return false; const o = d.data() as any;
        if (o.staffId !== a.staffId || ['cancelled', 'canceled'].includes(String(o.status || ''))) return false;
        return overlaps(newStart.getTime(), newEnd.getTime(), new Date(o.startTime).getTime() - (Number(o.padBefore) || 0) * 60000, new Date(o.endTime || o.startTime).getTime() + (Number(o.padAfter) || 0) * 60000); });
      // The fee is part of the change: charge their saved card FIRST — only for a time that's free — so the
      // business's rule ("don't make the change") can be honoured. If the time is taken a split second later, it's refunded.
      const owesFee = feeIfMovedNow > 0 && !usingGrace && !!a.clientId && !a.isRenterBooking;
      let feeIntent: string | null = null;
      if (owesFee) {
        if (takenBy((await db.collection(`tenants/${tenantId}/appointments`).where('startTime', '>=', dayStart).where('startTime', '<=', dayEnd).get()).docs))
          return NextResponse.json({ ok: false, error: `${a.staffName || 'That staff member'} is booked then — try another time.` }, { status: 409 });
        const cl: any = ((await db.doc(`tenants/${tenantId}/clients/${a.clientId}`).get()).data() as any) || {};
        const hasCard = !!(cl.cardOnFile?.paymentMethodId && (cl.cardOnFile?.customerId || cl.cardOnFile?.stripeCustomerId || cl.stripeCustomerId));
        if (hasCard) {
          const cr = await internalPost(internalOrigin(tDoc, req.nextUrl.origin), '/api/stripe/charge-card', { tenantId, clientId: a.clientId, amountCents: Math.round(feeIfMovedNow * 100),
            description: 'Late-reschedule fee', category: 'Reschedule Fees', appointmentId: apptId, reason: 'Client rescheduled inside the window', mode: 'auto', kind: 'deposit' }, { retries: 0 });
          if (cr.ok && cr.data?.ok && cr.data?.paymentIntentId) feeIntent = cr.data.paymentIntentId;
        }
        if (!feeIntent && unpaidFeeRuleOf(tDoc) === 'keep_booking') return NextResponse.json({ ok: false, code: 'fee_unpaid', error: hasCard
          ? 'Your card was declined, so your appointment hasn’t been moved. You can update your card and try again, or keep your current time.'
          : `Rescheduling now needs the $${feeIfMovedNow.toFixed(2)} fee paid by card, and there’s no card on file — so your appointment hasn’t been moved.` }, { status: 402 });
      }
      const result = await db.runTransaction(async (tx: any) => {
        const nearby = await tx.get(db.collection(`tenants/${tenantId}/appointments`)
          .where('startTime', '>=', dayStart).where('startTime', '<=', dayEnd));
        for (const d of nearby.docs) {
          if (d.id === apptId) continue;
          const o = d.data() as any;
          if (o.staffId !== a.staffId || ['cancelled', 'canceled'].includes(String(o.status || ''))) continue;
          const oS = new Date(o.startTime).getTime() - (Number(o.padBefore) || 0) * 60000;
          const oE = new Date(o.endTime || o.startTime).getTime() + (Number(o.padAfter) || 0) * 60000;
          if (overlaps(newStart.getTime(), newEnd.getTime(), oS, oE)) return { conflict: true };
        }
        const move = {
          ...chainAfterMove(a, { byStudio: studioCaused }),   // original time + count (not counted when WE asked them to reschedule)
          ...(feeIfMovedNow > 0 && !usingGrace ? { rescheduleFeeApplied: feeIfMovedNow, rescheduleFeePaid: !!feeIntent, ...(feeIntent ? { rescheduleFeeIntentId: feeIntent } : {}) } : {}),
          ...(usingGrace ? { rescheduleGraceUsed: true } : {}),
          // A new time is a fresh start: no longer late, no longer asked to move.
          studioAskedToMove: false, lateReply: null, providerDelay: null, providerLateMinutes: 0, checkInStatus: null, lateTimeMinutes: null, clientCheckInStatus: null, clientLateMinutes: null, clientEtaAt: null, etaAt: null, clientLateNote: null, clientTrip: null,
          startTime: newStart.toISOString(), endTime: newEnd.toISOString(),
          rescheduledAt: new Date().toISOString(), rescheduledBy: 'client_self_serve',
          previousStartTime: a.startTime,
          reminderSentAt: null, // the new time earns its own reminder
        };
        tx.set(ref, move, { merge: true });
        // v18 — keep the check-in MIRRORS in step: the master portal reads
        // appointmentCheckIns/{token}, so without this the portal would
        // keep showing the old time after a successful move.
        if (a.checkInToken) {
          tx.set(db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`), move, { merge: true });
          tx.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), move, { merge: true });
        }
        return { conflict: false };
      });
      if (!result.conflict) await recordDisruption({ outcome: 'rescheduled', newStartTime: newStart.toISOString() });
      if (!result.conflict && usingGrace && a.clientId) {
        const gRef = db.collection(`tenants/${tenantId}/graceUses`).doc(); const gNow = new Date().toISOString();
        await gRef.set({ id: gRef.id, tenantId, clientId: String(a.clientId), event: 'late_reschedule', at: gNow, appointmentId: apptId, serviceId: a.serviceId || null, staffId: a.staffId || null, permit: 'free_reschedule', reason: null, appliedBy: a.clientName || 'Client', appliedById: null, approvedBy: null, voidedAt: null, via: 'visit link' });
        await logAuditAdmin(db, tenantId, { action: 'grace.used', targetType: 'appointment', targetId: apptId, summary: `Grace used by the client — late reschedule: no fee. ${selfGrace!.remaining - 1} left in this ${selfGrace!.periodMonths}-month period.`, actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'visit link' } }).catch(() => {});
      }
      if (result.conflict && feeIntent) {   // the time went in the split second after charging → give the fee back
        const { refundPaymentIntent } = await import('@/lib/stripe-refund');
        const back = await refundPaymentIntent(tDoc.stripeAccountId, feeIntent);
        await logAuditAdmin(db, tenantId, { action: 'fee.auto_refunded', targetType: 'appointment', targetId: apptId, summary: `Reschedule fee $${feeIfMovedNow.toFixed(2)} ${back ? 'refunded automatically' : 'NEEDS A MANUAL REFUND'} — the new time was taken before the move completed`, actor: { type: 'system', name: 'Booking' } } as any).catch(() => {});
        return NextResponse.json({ ok: false, error: `That time was just taken — ${back ? 'your fee has been refunded' : 'we’ll refund your fee'}. Please pick another time.` }, { status: 409 });
      }
      if (!result.conflict && feeIfMovedNow > 0 && !usingGrace && a.clientId && !feeIntent) {
        const feeId = `rf_${Date.now().toString(36)}`;
        await db.doc(`tenants/${tenantId}/clients/${a.clientId}`).set({ outstandingBalance: FieldValue.increment(feeIfMovedNow),
          unpaidFees: FieldValue.arrayUnion({ feeId, appointmentId: apptId, appointmentDate: new Date().toISOString(), feeAmount: feeIfMovedNow, reason: 'reschedule_fee' }) }, { merge: true }).catch(() => {});
      }
      if (result.conflict) return NextResponse.json({ ok: false, error: `${a.staffName || 'That staff member'} is booked then — try another time.` }, { status: 409 });
      await notifyStaffAndOwner(db, tenantId, a,
        `${a.clientName || 'A client'} moved their appointment${a.staffName ? ` with ${a.staffName}` : ''}: ${fmtWhen(a.startTime, tzOffset, zone)} → ${fmtWhen(newStart.toISOString(), tzOffset, zone)} (self-serve).`);
      await logAuditAdmin(db, tenantId, {
        action: 'appointment.client_rescheduled', targetType: 'appointment', targetId: apptId,
        summary: `${a.clientName || 'Client'} self-rescheduled to ${fmtWhen(newStart.toISOString(), tzOffset, zone)}${usingGrace ? ' · grace used — no fee' : feeIfMovedNow > 0 ? ` · $${feeIfMovedNow.toFixed(2)} reschedule fee added to their balance` : ''}${a.studioAskedToMove ? ' (we asked them to choose a new time)' : ''}`,
        actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'manage-link' },
      });
      return NextResponse.json({ ok: true, newStartIso: newStart.toISOString(), whenLabel: fmtWhen(newStart.toISOString(), tzOffset, zone), feeApplied: usingGrace ? 0 : feeIfMovedNow, feePaid: !!feeIntent, graceUsed: usingGrace });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[appt] failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — try again.' }, { status: 500 });
  }
}

// ── Add to calendar (.ics) ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId') || '';
    const apptId = url.searchParams.get('apptId') || '';
    const k = url.searchParams.get('k') || '';
    const db = getAdminDb();
    const authed = await loadAuthed(db, tenantId, apptId, k);
    if (!authed) return new NextResponse('Link expired', { status: 401 });
    const { a } = authed;
    const tDoc = (await db.doc(`tenants/${tenantId}`).get()).data() as any || {};
    const studioName = tDoc.name || 'Studio';
    const dt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClarityFlow//EN', 'BEGIN:VEVENT',
      `UID:${apptId}@clarityflow`,
      `DTSTART:${dt(a.startTime)}`,
      `DTEND:${dt(a.endTime || new Date(new Date(a.startTime).getTime() + 3600000).toISOString())}`,
      `SUMMARY:${(a.serviceName || 'Appointment')} — ${studioName}`.replace(/[\n,;]/g, ' '),
      `DESCRIPTION:${studioName}${a.staffName ? ` with ${a.staffName}` : ''}`.replace(/[\n,;]/g, ' '),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return new NextResponse(ics, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="appointment.ics"' },
    });
  } catch { return new NextResponse('Error', { status: 500 }); }
}
