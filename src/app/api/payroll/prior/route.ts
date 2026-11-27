// /api/payroll/prior — Settings › Payroll › Pay from before ClarityFlow (lib/payroll-prior): what each person was paid
// and had withheld this year through the last payday elsewhere, so the year's wage limits, that quarter's forms and the
// year-end forms are whole. Kept as payrollRuns/prior_{year} (kind 'prior'), which only payroll reads and only the
// server writes. Never added to what's owed: the old payroll's taxes stay paid.
// POST { tenantId, lastPayDate, people: [{ staffId, name, wages, tips, federal, ss, medicare, state, q: {…the same} }], futaPaid }
//   → { ok } · DELETE { tenantId, year } → { ok }
// For the owner and anyone whose role runs payroll.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { cleanPrior } from '@/lib/payroll-prior';
import { todayIn } from '@/lib/pay-periods';

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayWords = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
async function body(req: NextRequest) { try { return await req.json(); } catch { return null; } }

export async function POST(req: NextRequest) {
  const b: any = await body(req); const tenantId = String(b?.tenantId || '');
  const g = await requireCan(req, tenantId, 'money.payroll'); if (g.deny) return g.deny;
  const db = getAdminDb(); const tenant = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const input = cleanPrior(b, todayIn(tenant)); if (typeof input === 'string') return NextResponse.json({ ok: false, error: input }, { status: 400 });
  const nowIso = new Date().toISOString(); const by = { id: g.actor?.uid || g.actor?.id || null, name: g.actor?.name || null };
  try {
    await db.doc(`tenants/${tenantId}/payrollRuns/prior_${input.year}`).set({ kind: 'prior', ...input, recordedAt: nowIso, by });
    const wages = Math.round(input.people.reduce((n, p) => n + p.wages, 0) * 100) / 100;
    await logAuditAdmin(db, tenantId, {
      action: 'payroll.prior', targetType: 'payroll', targetId: `prior_${input.year}`,
      summary: `Put in pay from before ClarityFlow for ${input.year}, through ${dayWords(input.lastPayDate)}: ${input.people.length} ${input.people.length === 1 ? 'person' : 'people'}, ${usd(wages)} in wages and tips`,
      amount: wages, actor: { type: 'user', id: by.id, name: by.name || 'Team member', via: 'settings' },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[payroll/prior]', e?.message || e);
    return NextResponse.json({ ok: false, error: 'Not saved. Try again.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const b: any = await body(req); const tenantId = String(b?.tenantId || '');
  const g = await requireCan(req, tenantId, 'money.payroll'); if (g.deny) return g.deny;
  const year = Number(b?.year); if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ ok: false, error: 'Pick the year.' }, { status: 400 });
  const db = getAdminDb();
  try {
    await db.doc(`tenants/${tenantId}/payrollRuns/prior_${year}`).delete();
    await logAuditAdmin(db, tenantId, { action: 'payroll.prior_removed', targetType: 'payroll', targetId: `prior_${year}`, summary: `Took out pay from before ClarityFlow for ${year}`,
      actor: { type: 'user', id: g.actor?.uid || g.actor?.id || null, name: g.actor?.name || 'Team member', via: 'settings' } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[payroll/prior]', e?.message || e);
    return NextResponse.json({ ok: false, error: 'Not changed. Try again.' }, { status: 500 });
  }
}
