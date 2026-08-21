/**
 * POST/GET /api/appointments/sweep-overdue
 *
 * The provider's clock, enforced. responseClock() has been showing "Respond by
 * 11:42" since round 14 and nothing has ever happened when 11:42 passed — a
 * deadline nobody enforces teaches people to ignore deadlines.
 *
 * WHY THIS IS NOT release-stale
 * That route is voice-only (source == 'ai_receptionist') and expires bookings
 * on the CLIENT's clock. This one runs across every channel and expires
 * nothing — the client's promise is untouched. Two different obligations,
 * two different jobs, deliberately not sharing a query.
 *
 * Run it hourly. Running it late is harmless; every action is idempotent and
 * stamped, so a missed hour catches up rather than double-firing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { resolveAuthority, responseClock, authorityAtLeast, type DecisionAuthority } from '@/lib/appointment-authority';

const DEFAULT_ACTION = 'escalate';
const DEFAULT_AUTO_ACCEPT_FLOOR: DecisionAuthority = 'limited';

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get('authorization') || '';
  return header.replace(/^Bearer\s+/i, '').trim() === secret;
}

async function sweepTenant(db: any, tenantId: string, nowIso: string) {
  const tenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const policy = (tenant.appointmentAuthority as any) || null;
  const hours = Number(policy?.providerResponseHours ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) {
    return { tenantId, skipped: 'no_response_window', reminded: 0, acted: 0 };
  }

  const action = String(policy?.overdueAction || DEFAULT_ACTION);
  const reminderMinutes = Number(policy?.overdueReminderMinutes ?? 0);
  const floor = (policy?.autoAcceptMinAuthority || DEFAULT_AUTO_ACCEPT_FLOOR) as DecisionAuthority;

  const snap = await db
    .collection(`tenants/${tenantId}/appointments`)
    .where('status', '==', 'requested')
    .get();

  const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
  const staffById = new Map<string, any>();
  staffSnap.docs.forEach((d: any) => staffById.set(d.id, { id: d.id, ...(d.data() as any) }));

  const managers = staffSnap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((s: any) => s.active !== false && ['owner', 'admin', 'manager'].includes(String(s.role || '')))
    .map((s: any) => String(s.id));
  if (tenant.userId && !managers.includes(String(tenant.userId))) managers.push(String(tenant.userId));

  let reminded = 0;
  let acted = 0;

  for (const d of snap.docs) {
    const apt: any = { id: d.id, ...(d.data() as any) };
    const clock = responseClock(apt, policy);
    if (!clock) continue;

    /* ── not yet due: remind once, close to the line ─────────────────── */
    if (!clock.overdue) {
      if (reminderMinutes <= 0 || clock.minutesLeft > reminderMinutes) continue;
      if (apt.overdueRemindedAt) continue;
      await d.ref.set({ overdueRemindedAt: nowIso }, { merge: true });
      if (apt.staffId) {
        await db.collection(`tenants/${tenantId}/notifications`).add({
          userId: String(apt.staffId),
          type: 'appointment_overdue',
          message: `${apt.clientName || 'A booking'} needs your answer within ${Math.max(1, clock.minutesLeft)} min.`,
          link: '/planner',
          appointmentId: apt.id,
          createdAt: nowIso,
          read: false,
        }).catch(() => undefined);
      }
      reminded += 1;
      continue;
    }

    /* ── overdue: act once ───────────────────────────────────────────── */
    if (apt.overdueHandledAt) continue;

    const provider = apt.staffId ? staffById.get(String(apt.staffId)) : null;
    const providerAuthority = resolveAuthority({
      isManager: ['owner', 'admin', 'manager'].includes(String(provider?.role || '')),
      employmentModel: provider?.employmentModel || null,
      decisionAuthority: provider?.decisionAuthority || null,
      role: provider?.role || null,
      policy,
    });

    /* Auto-accepting on behalf of somebody who could never have declined is
     * just an assignment with extra steps, and it quietly turns the shop's
     * own authority model off. When the floor is not met it escalates
     * instead — the safe direction. */
    const mayAutoAccept = action === 'auto_accept' && authorityAtLeast(providerAuthority, floor);
    const effective = action === 'auto_accept' && !mayAutoAccept ? 'escalate' : action;

    const patch: Record<string, any> = { overdueHandledAt: nowIso, overdueAction: effective };

    if (effective === 'auto_accept') {
      patch.status = 'confirmed';
      patch.autoAcceptedAt = nowIso;
      patch.autoAcceptedReason = 'provider_response_window_elapsed';
    }
    if (effective === 'raise_issue') {
      patch.issue = {
        code: 'management_review',
        label: 'No answer within the response window',
        note: null,
        raisedByUid: 'system',
        raisedByName: 'The response window',
        raisedAt: nowIso,
        status: 'open',
        resolvedByUid: null, resolvedByName: null, resolvedAt: null, outcome: null,
      };
    }

    await d.ref.set(patch, { merge: true });

    const who = provider?.name || 'A provider';
    const line = effective === 'auto_accept'
      ? `${apt.clientName || 'A booking'} was accepted automatically — ${who} did not answer in time.`
      : effective === 'raise_issue'
        ? `${apt.clientName || 'A booking'} went unanswered by ${who} and is now with you.`
        : `${apt.clientName || 'A booking'} is overdue — ${who} has not answered.`;

    await Promise.all(managers.map((id: string) => db
      .collection(`tenants/${tenantId}/notifications`)
      .add({
        userId: id,
        type: 'appointment_overdue',
        message: line,
        link: '/planner',
        appointmentId: apt.id,
        createdAt: nowIso,
        read: false,
      })
      .catch(() => undefined)));

    await db.collection(`tenants/${tenantId}/appointmentDecisions`).add({
      tenantId,
      appointmentId: apt.id,
      clientId: apt.clientId || null,
      clientName: apt.clientName || null,
      serviceId: apt.serviceId || null,
      staffId: apt.staffId || null,
      startTime: apt.startTime || null,
      source: apt.source || null,
      channel: 'system',
      action: 'response_window_elapsed',
      declineOutcome: null,
      reasonCode: null,
      reasonLabel: null,
      reason: null,
      issueOutcome: null,
      priorStatus: 'requested',
      resultStatus: effective === 'auto_accept' ? 'confirmed' : 'requested',
      depositCents: Number(apt.depositAmountCents || 0),
      chargedOnFile: false,
      decidedVia: 'system',
      actorUid: null,
      actorName: 'The response window',
      actorRole: 'system',
      actorIsManager: false,
      decidedAt: nowIso,
      requestedAt: apt.requestedAt || apt.createdAt || null,
      responseSeconds: null,
    }).catch(() => undefined);

    acted += 1;
  }

  return { tenantId, reminded, acted, action };
}

async function run(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminDb();
  const nowIso = new Date().toISOString();
  const url = new URL(req.url);
  const only = url.searchParams.get('tenantId');

  const tenantIds = only
    ? [only]
    : (await db.collection('tenants').get()).docs.map((d: any) => d.id);

  const { sweepUnpaidAccepted } = await import('@/lib/retail-sweeps');

  const results = [];
  for (const tenantId of tenantIds) {
    try {
      const overdue = await sweepTenant(db, tenantId, nowIso);
      /* THE UNPAID CLOCK RUNS HOURLY TOO. sweepUnpaidAccepted already existed
       * and already did the right thing — it just ran nightly, so a shop with
       * a two-hour grace window could hold a slot for twenty-two hours past
       * its own deadline. Same sweep, sane frequency. It is idempotent, so
       * the nightly run can stay where it is. */
      let unpaid: any = null;
      try {
        unpaid = await sweepUnpaidAccepted(db, tenantId);
      } catch (e) {
        console.error('[sweep-overdue] unpaid sweep failed', tenantId, e);
      }
      results.push({ ...overdue, unpaid });
    } catch (e: any) {
      console.error('[sweep-overdue] tenant failed', tenantId, e);
      results.push({ tenantId, error: String(e?.message || e) });
    }
  }

  return NextResponse.json({ ok: true, at: nowIso, tenants: results.length, results });
}

export async function POST(req: NextRequest) {
  return run(req);
}

export async function GET(req: NextRequest) {
  return run(req);
}
