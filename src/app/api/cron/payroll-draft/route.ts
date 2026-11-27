// src/app/api/cron/payroll-draft/route.ts
//
// Payroll auto-draft (Level 2) — runs daily. For tenants with payroll.autoDraft on:
//
//   1. Once a pay period has ended (the business's own periods, lib/pay-periods: the same ones the stubs and Payday
//      use), build a draft for it with the shared engine, once (payroll.lastDraftKey = the period's first day).
//   2. Save it to tenants/{id}/payrollDrafts (superseding older pending
//      drafts) and write a notification doc the app can surface.
//   3. LEVEL 3 (off by default): if payroll.autoSubmit is true AND every
//      safeguard gate passes, submit to Gusto with no tap. A failed gate
//      never submits — it notifies instead.
//
// Also, for businesses whose payroll is worked out in ClarityFlow: a note when a payroll tax is due soon, due today or
// late, once each (lib/payroll-owed remindersDue; sent ones kept in tenants/{t}/private/payrollTaxReminders).
//
// Vercel: schedule "0 8 * * *" (see vercel.cron.json) + CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { refuseCron } from '@/lib/cron-auth';
import { buildPayrollDraft, runPayrollGates } from '@/lib/payroll-draft';
import { recentPeriods, periodRange } from '@/lib/pay-periods';
import { logAuditAdmin } from '@/lib/audit';
import { owedItems, remindersDue } from '@/lib/payroll-owed';
import { todayIn } from '@/lib/pay-periods';
import { getStateProfile } from '@/lib/state-tax-profiles';
import { payrollStateOf, owedRunsFrom } from '@/lib/payroll-taxes';
import { ensureOwnerTeamMember } from '@/lib/owner-staff';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Only the scheduler, holding the secret. No secret set: nobody.
  const refused = refuseCron(req); if (refused) return refused;

  const db = getAdminDb();
  const tenantsSnap = await db.collection('tenants').where('payroll.autoDraft', '==', true).get();
  const results: Record<string, any> = {};
  const now = new Date();

  for (const tDoc of tenantsSnap.docs) {
    const tenantId = tDoc.id;
    try {
      const tenant: any = tDoc.data() || {}; const payroll = tenant.payroll || {};
      // The period that ended last, as the business's own pay periods have it: drafted once.
      const ended = recentPeriods(tenant, 2, now.getTime())[1];
      if (!ended || payroll.lastDraftKey === ended.from) { results[tenantId] = { skipped: 'not due' }; continue; }
      const { fromIso, toIso } = periodRange(tenant, ended);
      const periodStart = new Date(fromIso), periodEnd = new Date(toIso);
      const draft = await buildPayrollDraft(db, tenantId, periodStart, periodEnd);
      const { gates, allPassed } = runPayrollGates(draft);

      // Supersede any older pending draft so exactly one is actionable
      const pendingSnap = await db.collection(`tenants/${tenantId}/payrollDrafts`)
        .where('status', '==', 'pending').get();
      const batch = db.batch();
      for (const d of pendingSnap.docs) batch.set(d.ref, { status: 'superseded' }, { merge: true });
      const draftRef = db.collection(`tenants/${tenantId}/payrollDrafts`).doc();
      batch.set(draftRef, { ...draft, id: draftRef.id, periodKey: ended.from, payday: ended.payday, gates, allGatesPassed: allPassed });
      batch.set(tDoc.ref, { payroll: { ...payroll, lastDraftAt: now.toISOString(), lastDraftKey: ended.from } }, { merge: true });
      const people = `${draft.lines.length} ${draft.lines.length === 1 ? 'person' : 'people'}`;
      const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Notification the app (or a future email hook) can surface
      const noteRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      batch.set(noteRef, {
        id: noteRef.id, type: 'payroll_draft',
        title: 'A payroll draft is ready',
        body: `${people}, ${usd(draft.grossTotal)} to pay and about ${usd(draft.estimatedEmployerTaxes)} in payroll taxes. Open Payday to look it over and approve it.`,
        draftId: draftRef.id, link: '/money?tab=payday', read: false, createdAt: now.toISOString(),
      });
      await batch.commit();
      await logAuditAdmin(db, tenantId, {
        action: 'payroll.draft_created', targetType: 'payroll', targetId: draftRef.id,
        summary: `Payroll draft for ${ended.from} to ${ended.to}: ${people}, ${usd(draft.grossTotal)} to pay, about ${usd(draft.estimatedEmployerTaxes)} in payroll taxes`,
        amount: draft.grossTotal, actor: { type: 'system', name: 'payroll-cron' },
      });

      // ── LEVEL 3 — auto-submit, disabled unless explicitly opted in ──
      if (payroll.autoSubmit === true && allPassed && draft.lines.length > 0) {
        // TODO(level-3): load Gusto tokens (see /api/gusto/payroll TODO),
        // map draft.lines → employee_compensations, submit, then:
        //   draftRef.set({ status: 'submitted', submittedAt: ... })
        // Deliberately left unwired until Level 2 drafts have a proven
        // track record — a wrong paycheck costs more than a tap saves.
        results[tenantId] = { drafted: true, autoSubmit: 'gates passed — submission stub (not yet wired)' };
      } else {
        results[tenantId] = { drafted: true, gatesPassed: allPassed };
      }
    } catch (e: any) {
      results[tenantId] = { error: String(e?.message || e).slice(0, 200) };
    }
  }

  // Payroll taxes due, for businesses whose payroll is worked out in ClarityFlow.
  const selfSnap = await db.collection('tenants').where('payrollTax.runBy', '==', 'clarityflow').get();
  for (const tDoc of selfSnap.docs) {
    const tenantId = tDoc.id;
    try {
      const tenant: any = tDoc.data() || {}; const today = todayIn(tenant, now.getTime());
      const runs = (await db.collection(`tenants/${tenantId}/payrollRuns`).where('recordedAt', '>=', owedRunsFrom(Number(today.slice(0, 4)))).limit(1500).get()).docs.map((d: any) => d.data() || {});
      const st = payrollStateOf(tenant);
      const items = owedItems(runs, tenant, today, st ? getStateProfile(st).name : 'State');
      const markRef = db.doc(`tenants/${tenantId}/private/payrollTaxReminders`); const sent: any = (await markRef.get()).data()?.sent || {};
      const due = remindersDue(items, today, sent);
      if (!due.length) { results[`${tenantId}:taxes`] = { reminders: 0 }; continue; }
      // (To the owner's own team record: notices are addressed to a person on the team.)
      const ownerId = await ensureOwnerTeamMember(db, tenantId);
      if (!ownerId) { results[`${tenantId}:taxes`] = { skipped: 'no owner' }; continue; }
      const batch = db.batch(); const marks: any = {};
      for (const r of due) {
        const noteRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        batch.set(noteRef, { id: noteRef.id, userId: ownerId, type: 'payroll_tax_due', priority: r.stage === 'soon' ? 'normal' : 'high', title: r.title, body: r.body, message: `${r.title}. ${r.body}`,
          link: '/money?tab=payday', read: false, createdAt: now.toISOString() });
        marks[`${r.key}_${r.stage}`] = now.toISOString();
      }
      batch.set(markRef, { sent: marks }, { merge: true });
      await batch.commit();
      results[`${tenantId}:taxes`] = { reminders: due.length };
    } catch (e: any) {
      results[`${tenantId}:taxes`] = { error: String(e?.message || e).slice(0, 200) };
    }
  }

  return NextResponse.json({ ok: true, tenants: tenantsSnap.size, results });
}
