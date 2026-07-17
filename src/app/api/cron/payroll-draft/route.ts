// src/app/api/cron/payroll-draft/route.ts
//
// Payroll auto-draft (Level 2) — runs daily; each tenant's cadence decides
// whether a draft is actually due. For tenants with payroll.autoDraft on:
//
//   1. If enough days have passed since the last draft (7 / 14 / ~30 per
//      cadence), build a draft with the shared engine.
//   2. Save it to tenants/{id}/payrollDrafts (superseding older pending
//      drafts) and write a notification doc the app can surface.
//   3. LEVEL 3 (off by default): if payroll.autoSubmit is true AND every
//      safeguard gate passes, submit to Gusto with no tap. A failed gate
//      never submits — it notifies instead.
//
// Vercel: schedule "0 8 * * *" (see vercel.cron.json) + CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { buildPayrollDraft, runPayrollGates, CADENCE_DAYS } from '@/lib/payroll-draft';
import { logAuditAdmin } from '@/lib/audit';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const db = getAdminDb();
  const tenantsSnap = await db.collection('tenants').where('payroll.autoDraft', '==', true).get();
  const results: Record<string, any> = {};
  const now = new Date();

  for (const tDoc of tenantsSnap.docs) {
    const tenantId = tDoc.id;
    try {
      const payroll = (tDoc.data() as any)?.payroll || {};
      const cadence: string = payroll.cadence || 'bi-weekly';
      const cadenceDays = CADENCE_DAYS[cadence] || 14;

      // Due when at least (cadence − 1) days have passed — the daily run
      // self-corrects drift without needing a fixed anchor day.
      const lastDraftAt = payroll.lastDraftAt ? new Date(payroll.lastDraftAt) : null;
      const daysSince = lastDraftAt ? (now.getTime() - lastDraftAt.getTime()) / 86400000 : Infinity;
      if (daysSince < cadenceDays - 0.5) { results[tenantId] = { skipped: 'not due' }; continue; }

      const periodStart = new Date(now.getTime() - cadenceDays * 86400000);
      const draft = await buildPayrollDraft(db, tenantId, periodStart, now);
      const { gates, allPassed } = runPayrollGates(draft);

      // Supersede any older pending draft so exactly one is actionable
      const pendingSnap = await db.collection(`tenants/${tenantId}/payrollDrafts`)
        .where('status', '==', 'pending').get();
      const batch = db.batch();
      for (const d of pendingSnap.docs) batch.set(d.ref, { status: 'superseded' }, { merge: true });
      const draftRef = db.collection(`tenants/${tenantId}/payrollDrafts`).doc();
      batch.set(draftRef, { ...draft, id: draftRef.id, gates, allGatesPassed: allPassed });
      batch.set(tDoc.ref, { payroll: { ...payroll, lastDraftAt: now.toISOString() } }, { merge: true });

      // Notification the app (or a future email hook) can surface
      const noteRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      batch.set(noteRef, {
        id: noteRef.id, type: 'payroll_draft',
        title: 'Payroll draft ready',
        body: `${draft.lines.length} employee(s) · gross $${draft.grossTotal.toFixed(2)} + est. employer taxes $${draft.estimatedEmployerTaxes.toFixed(2)}. Open Payday to review & approve.`,
        draftId: draftRef.id, read: false, createdAt: now.toISOString(),
      });
      await batch.commit();
      await logAuditAdmin(db, tenantId, {
        action: 'payroll.draft_created', targetType: 'payroll', targetId: draftRef.id,
        summary: `Auto-draft created: ${draft.lines.length} staff, gross $${draft.grossTotal.toFixed(2)}, est. employer taxes $${draft.estimatedEmployerTaxes.toFixed(2)} (${cadence})`,
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

  return NextResponse.json({ ok: true, tenants: tenantsSnap.size, results });
}
