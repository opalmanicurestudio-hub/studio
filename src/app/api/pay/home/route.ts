// src/app/api/pay/home/route.ts — the Pay tab: this period so far (day by day) and the paid stubs before it (lib/pay-stub).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { payHome } from '@/lib/pay-stub';
import { runByOf, payrollStateOf, yearRunsFrom } from '@/lib/payroll-taxes';
import { stateSpec } from '@/lib/state-payroll';
import { w2sFor } from '@/lib/payroll-yearend';
import { todayIn } from '@/lib/pay-periods';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const staffId = String(req.nextUrl.searchParams.get('staffId') || who.actor.staffId);
  if (staffId !== who.actor.staffId && !who.actor.isManager) return NextResponse.json({ ok: false, error: 'You can only see your own pay.' }, { status: 403 });
  const m: any = (await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data();
  if (!m) return NextResponse.json({ ok: false, error: 'Team member not found.' }, { status: 404 });
  if (m.isRenter === true || m.role === 'renter') return NextResponse.json({ ok: false, error: 'Renters keep their own takings — there’s no pay stub.' }, { status: 400 });
  // (Their own tax forms and, from January to April, last year's W-2: payroll run in ClarityFlow, employees only.)
  let mine: any = null;
  if (staffId === who.actor.staffId && m.employmentType !== 'contractor') {
    const tenant = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    if (runByOf(tenant) === 'clarityflow') {
      const code = payrollStateOf(tenant); const spec = stateSpec(code); const today = todayIn(tenant); const month = Number(today.slice(5, 7)); const year = Number(today.slice(0, 4)) - 1;
      const pay: any = (await db.doc(`tenants/${tenantId}/staffPay/${staffId}`).get()).data() || {};
      let w2 = null;
      // (Only once the business has checked them and put them in the app: api/payroll/forms giveW2s.)
      if (month <= 4 && tenant?.payrollTax?.w2Given?.[String(year)]) { const runs = (await db.collection(`tenants/${tenantId}/payrollRuns`).where('recordedAt', '>=', yearRunsFrom(year)).limit(500).get()).docs.map((d: any) => d.data() || {});
        w2 = w2sFor(runs, tenant, year).find((x) => x.staffId === staffId) || null; }
      mine = { business: String(tenant.name || ''), state: code, stateName: spec?.name || '', formName: spec?.form && !spec.form.federal ? spec.form.name : null,
        forms: pay.taxForms ? { federal: pay.taxForms.federal || null, state: pay.taxForms.state || null, signed: pay.taxForms.signed || null, updatedAt: pay.taxForms.updatedAt || null } : null,
        ...(w2 ? { w2, w2Year: year } : {}) };
    }
  }
  return NextResponse.json({ ok: true, ...(await payHome(db, tenantId, staffId)), ...(mine ? { taxForms: mine } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
}
