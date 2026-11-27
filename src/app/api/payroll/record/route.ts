// /api/payroll/record — Money › Payday › Record payday (lib/payday-record): once per pay period, the team's pay as one
// line for employees, one for contractors and one for cash tips taken home, who was paid what kept where only payroll
// reads it, and pay the bank already booked from a payroll company never booked twice.
// POST { tenantId, periodKey, from, to, people: [{ staffId, name, amount, cash, contractor, method?, checkNo?, tips? }], setAsides: [{ key, label, amount }] }
//   Pay between paydays (a bonus): { …, periodKey: 'bonus_{date}_{id}', offCycle: { date, supplemental } }, only when
//   payroll is run in ClarityFlow (a payroll company runs its own).
//   → { ok, recordedAt, viaBankCents, taxes? } | 409 { recorded: { on, from, to } } when payday for those dates is in already.
// When payroll is run in ClarityFlow, each employee's taxes are worked out here from their tax forms (staffPay).
// For the owner and anyone whose role runs payroll.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { cleanPayday, recordPayday } from '@/lib/payday-record';
import { runByOf } from '@/lib/payroll-taxes';
import type { TaxForms } from '@/lib/withholding';

const usd = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function POST(req: NextRequest) {
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 }); }
  const tenantId = String(b?.tenantId || '');
  const g = await requireCan(req, tenantId, 'money.payroll'); if (g.deny) return g.deny;
  const input = cleanPayday(b); if (typeof input === 'string') return NextResponse.json({ ok: false, error: input }, { status: 400 });
  const db = getAdminDb(); const tenant = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  if (input.offCycle && runByOf(tenant) !== 'clarityflow') return NextResponse.json({ ok: false, error: 'Pay a bonus through your payroll company: it works out the taxes.' }, { status: 400 });
  try {
    // (Each employee's W-4 and state form, from their pay: only when payroll is run here.)
    const forms: Record<string, TaxForms | null> = {};
    if (runByOf(tenant) === 'clarityflow') {
      const ids = input.people.filter((p) => !p.contractor).map((p) => p.staffId);
      const docs = await Promise.all(ids.map((id) => db.doc(`tenants/${tenantId}/staffPay/${id}`).get()));
      docs.forEach((d: any, i: number) => { forms[ids[i]] = (d.exists && d.data()?.taxForms) || null; });
    }
    const r = await recordPayday(db, tenantId, tenant, input, { id: g.actor?.uid || g.actor?.id, name: g.actor?.name }, new Date().toISOString(), forms);
    if (!r.ok) return NextResponse.json(r, { status: r.status });
    const pay = input.people.reduce((n, p) => n + Math.max(0, p.amount) + p.cash, 0); const asides = input.setAsides.reduce((n, a) => n + a.amount, 0);
    const people = input.people.filter((p) => p.amount > 0 || p.cash > 0).length;
    await logAuditAdmin(db, tenantId, {
      action: 'payroll.distribute', targetType: 'payroll', targetId: `payday_${input.periodKey}`,
      summary: `${input.offCycle ? `Recorded pay between paydays, paid ${input.offCycle.date}${input.offCycle.supplemental ? ' as a bonus' : ''}` : `Recorded payday for ${input.from} to ${input.to}`}: ${people} ${people === 1 ? 'person' : 'people'} paid ${usd(pay)}${r.taxes ? ` (${usd(r.taxes.employee)} of it withheld for taxes, and ${usd(r.taxes.employer)} in employer payroll taxes)` : ''}${asides > 0 ? `, and ${usd(asides)} split to set aside` : ''}${r.viaBankCents ? `. ${usd(r.viaBankCents / 100)} of it was already in the books from the bank` : ''}`,
      amount: pay, actor: { type: 'user', id: g.actor?.uid || g.actor?.id, name: g.actor?.name || 'Team member', via: 'payday-tab' },
    });
    return NextResponse.json(r);
  } catch (e: any) {
    console.error('[payroll/record]', e?.message || e);
    return NextResponse.json({ ok: false, error: 'Payday wasn’t recorded. Nothing was added to your books. Try again.' }, { status: 500 });
  }
}
