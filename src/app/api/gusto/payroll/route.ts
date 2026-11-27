// src/app/api/gusto/payroll/route.ts
//
// v87 — real Gusto payroll wiring (sandbox-ready).
//
// POST — push an approved payroll draft into Gusto's current unprocessed
//        payroll and submit it. The flow:
//   1. Load tokens (auto-refresh) from tenants/{id}/private/gustoTokens.
//   2. Find the unprocessed payroll whose pay period covers the draft
//      (fallback: the earliest unprocessed one).
//   3. Update BY NAME against Gusto's own compensation entries — we take
//      the payroll Gusto gives us and adjust hours/amounts, so job uuids
//      and rates stay exactly what Gusto expects:
//        Regular Hours / Overtime          ← hours
//        Bonus / Commission / Paycheck Tips / Cash Tips / Reimbursement ← dollars
//      (Cash Tips: tips they already took home: reported for taxes, never paid again.)
//      Contractors aren't on the employee payroll: their lines are refused here, never sent.
//      Only a Gusto payroll whose pay period covers the draft's is filled in; with none, nothing is sent.
//   4. PUT the payroll (with its version — Gusto rejects stale writes),
//      then PUT /submit. From there Gusto owns the regulated work: exact
//      withholdings, direct deposits, filings, stubs.
//   5. Record the run in tenants/{id}/payrollRuns/{payrollId} + audit.
//
// If the update succeeds but submission is refused (e.g. the app's scopes
// don't include processing), the response is status 'synced_not_submitted'
// with an honest message — the owner finishes the run inside Gusto, and
// every number is already there.
//
// GET — ?tenantId=&payrollId= → processing status, mirrored to payrollRuns.

import { requireCan } from '@/lib/route-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { getGustoAuth, gustoFetch } from '@/lib/gusto-server';
import { withPay } from '@/lib/staff-pay-server';

const dollars = (n: any) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const hoursStr = (n: any) => String(Math.round((Number(n) || 0) * 1000) / 1000);

export async function POST(req: NextRequest) {
  const draft = await req.json().catch(() => null);
  if (!draft?.tenantId || !Array.isArray(draft?.lines) || draft.lines.length === 0) {
    return NextResponse.json({ error: 'There’s no pay to send.' }, { status: 400 });
  }
  const tenantId = String(draft.tenantId);
  // (The owner, and anyone whose role runs payroll.)
  const guard = await requireCan(req, tenantId, 'money.payroll'); if (guard.deny) return guard.deny;

  try {
    const db = getAdminDb();
    const auth = await getGustoAuth(db, tenantId);

    // ── Resolve gustoEmployeeId for every line (draft value, else staff doc) ──
    const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
    const staffById = new Map((await withPay(db, tenantId, staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })))).map((m: any) => [m.id, m]));
    if (draft.lines.some((l: any) => l.contractor)) return NextResponse.json({ status: 'failed', error: 'Contractors aren’t on the employee payroll. Pay them directly, then record payday.' }, { status: 400 });
    const lines = draft.lines.map((l: any) => ({
      ...l,
      gustoEmployeeId: l.gustoEmployeeId || (staffById.get(l.staffId) as any)?.gustoEmployeeId || null,
    }));
    const unmatched = lines.filter((l: any) => !l.gustoEmployeeId).map((l: any) => l.name || l.staffId);
    if (unmatched.length > 0) {
      return NextResponse.json({
        status: 'failed',
        error: `Not matched to Gusto yet: ${unmatched.join(', ')}. Match each person to their Gusto employee, then send it again.`,
      }, { status: 409 });
    }

    // ── Find the unprocessed payroll covering this draft's period ──
    const unprocessed: any[] = await gustoFetch(auth,
      `/v1/companies/${auth.companyId}/payrolls?processing_statuses=unprocessed`);
    const list = Array.isArray(unprocessed) ? unprocessed : [];
    if (list.length === 0) {
      return NextResponse.json({
        status: 'failed',
        error: 'There’s no open payroll in Gusto right now. Check the company’s pay schedule in Gusto.',
      }, { status: 409 });
    }
    // (The open Gusto payroll whose pay period holds the draft's last day; never another one in its place.)
    const endDay = String(draft.periodEndDay || draft.periodEnd || '').slice(0, 10);   // the business's own last day of the period
    const covers = (p: any) =>
      p?.pay_period?.start_date && p?.pay_period?.end_date && endDay
      && p.pay_period.start_date <= endDay && endDay <= p.pay_period.end_date;
    const target = list.find(covers);
    if (!target) {
      return NextResponse.json({
        status: 'failed',
        error: `No open payroll in Gusto covers the period ending ${endDay}. Make Gusto’s pay schedule match your pay periods in Settings, then send it again.`,
      }, { status: 409 });
    }
    const payrollId = target.uuid || target.payroll_uuid || target.id;

    // ── Pull the full payroll (version + Gusto's own compensation shapes) ──
    const payroll: any = await gustoFetch(auth,
      `/v1/companies/${auth.companyId}/payrolls/${payrollId}`);

    const byEmployee = new Map(lines.map((l: any) => [l.gustoEmployeeId, l]));
    const updatedComps = (payroll.employee_compensations || [])
      .map((comp: any) => {
        const line: any = byEmployee.get(comp.employee_uuid);
        if (!line) return null; // untouched employees keep Gusto's values
        // Salaried people: Gusto pays the salary itself — their hours rows are left exactly as Gusto has them.
        const hourly = line.payStructure === 'salary' ? (comp.hourly_compensations || []) : (comp.hourly_compensations || []).map((h: any) => {
          const n = String(h.name || '').toLowerCase();
          if (n === 'regular hours') return { ...h, hours: hoursStr(line.regularHours) };
          if (n === 'overtime') return { ...h, hours: hoursStr(line.overtimeHours) };
          if (n === 'double overtime' && line.doubleOvertimeHours != null) return { ...h, hours: hoursStr(line.doubleOvertimeHours) };
          return h;
        });
        const FIXED: Record<string, number> = {
          'bonus': line.bonus,
          'commission': line.commission,
          'paycheck tips': line.tips,
          'cash tips': line.cashTips || 0,
          'reimbursement': line.reimbursements,
        };
        const seen = new Set<string>();
        const fixed = (comp.fixed_compensations || []).map((f: any) => {
          const n = String(f.name || '').toLowerCase();
          if (n in FIXED) { seen.add(n); return { ...f, amount: dollars(FIXED[n]) }; }
          return f;
        });
        // Entries Gusto didn't include but the draft pays → added by name, on the person's own job (cash tips included, so
        // they're reported). One Gusto won't take stops the whole payroll before it's submitted: nothing is dropped quietly.
        const job = (comp.fixed_compensations || [])[0]?.job_uuid || (comp.hourly_compensations || [])[0]?.job_uuid;
        for (const [n, amt] of Object.entries(FIXED)) {
          if (!seen.has(n) && (Number(amt) || 0) > 0) {
            fixed.push({ name: n.replace(/(^|\s)\S/g, (c: string) => c.toUpperCase()), amount: dollars(amt), ...(job ? { job_uuid: job } : {}) });
          }
        }
        return {
          employee_uuid: comp.employee_uuid,
          version: comp.version,
          hourly_compensations: hourly,
          fixed_compensations: fixed,
        };
      })
      .filter(Boolean);

    if (updatedComps.length === 0) {
      return NextResponse.json({
        status: 'failed',
        error: 'Nobody on this payroll is on Gusto’s open payroll. Check the pay schedule in Gusto and that each person is matched.',
      }, { status: 409 });
    }

    // ── Write the numbers into Gusto (version-checked) ──
    await gustoFetch(auth, `/v1/companies/${auth.companyId}/payrolls/${payrollId}`, {
      method: 'PUT',
      body: JSON.stringify({ version: payroll.version, employee_compensations: updatedComps }),
    });

    // ── Submit — Gusto takes over taxes, deposits, filings ──
    const nowIso = new Date().toISOString();
    let status: string = 'submitted';
    let message: string | undefined;
    try {
      await gustoFetch(auth, `/v1/companies/${auth.companyId}/payrolls/${payrollId}/submit`, {
        method: 'PUT', body: JSON.stringify({ version: payroll.version }),
      });
    } catch (e: any) {
      // Numbers ARE in Gusto — only the final button was refused. Say so.
      status = 'synced_not_submitted';
      message = `The pay is in Gusto, but Gusto didn’t let it be submitted from here (${e?.message || 'permission'}). Open Gusto and submit it there: every number is already filled in.`;
    }

    await db.doc(`tenants/${tenantId}/payrollRuns/${payrollId}`).set({
      payrollId, status,
      periodStart: draft.periodStart || payroll?.pay_period?.start_date || null,
      periodEnd: draft.periodEnd || payroll?.pay_period?.end_date || null,
      checkDate: payroll?.check_date || null,
      grossTotal: draft.grossTotal ?? null,
      people: updatedComps.length,
      submittedAt: nowIso,
    }, { merge: true });

    await logAuditAdmin(db, tenantId, {
      action: status === 'submitted' ? 'payroll.submitted_to_gusto' : 'payroll.synced_to_gusto',
      targetType: 'payrollRun', targetId: payrollId,
      summary: status === 'submitted'
        ? `Sent payroll to Gusto: ${updatedComps.length} ${updatedComps.length === 1 ? 'person' : 'people'}, for the period ending ${endDay}`
        : `Put payroll in Gusto, to be submitted there: ${updatedComps.length} ${updatedComps.length === 1 ? 'person' : 'people'}, for the period ending ${endDay}`,
      amount: Number(draft.grossTotal) || undefined,
      actor: { type: 'user', id: guard.actor?.uid, name: guard.actor?.name || 'Team member', via: 'payday-tab' },
    });

    return NextResponse.json({ status, payrollId, checkDate: payroll?.check_date || null, message });
  } catch (e: any) {
    const status = e?.status === 409 ? 409 : e?.status === 401 ? 401 : 502;
    return NextResponse.json({ status: 'failed', error: e?.message || 'Gusto didn’t take the payroll.' }, { status });
  }
}

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  { const g = await requireCan(req, String(tenantId || ''), 'money.payroll'); if (g.deny) return g.deny; }
  const payrollId = req.nextUrl.searchParams.get('payrollId');
  if (!tenantId || !payrollId) {
    return NextResponse.json({ error: 'tenantId and payrollId are required' }, { status: 400 });
  }
  try {
    const db = getAdminDb();
    const auth = await getGustoAuth(db, tenantId);
    const payroll: any = await gustoFetch(auth,
      `/v1/companies/${auth.companyId}/payrolls/${payrollId}`);
    const status = payroll?.processed ? 'processed' : 'processing';
    await db.doc(`tenants/${tenantId}/payrollRuns/${payrollId}`).set({
      status, checkDate: payroll?.check_date || null, checkedAt: new Date().toISOString(),
    }, { merge: true });
    return NextResponse.json({ status, payrollId, checkDate: payroll?.check_date || null });
  } catch (e: any) {
    return NextResponse.json({ status: 'failed', error: e?.message || 'Status check failed.' }, { status: 502 });
  }
}
