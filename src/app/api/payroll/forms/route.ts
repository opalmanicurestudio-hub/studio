// /api/payroll/forms — Money › Payday, for anyone who runs payroll (the business's own record is the owner's to change,
// so these are saved here, by the server):
//   - { action: 'checkSettings', layout, nudge }: the check paper and the nudge that lines it up (Print checks), kept in
//     payrollTax.checkLayout and payrollTax.checkNudge (sixteenths of an inch, within three inches).
//   - { action: 'checkNumbers', count, first?, periodKey?, people? }: check numbers from the first one put in, or else
//     the next one kept, in a transaction (two devices printing at once never get the same ones from the next one kept);
//     payrollTax.nextCheckNo moves on past them, never back.
//     With a recorded payday's key, each person's number goes on that payday's run too (their pay stub shows it).
//   - { action: 'giveW2s', year, given }: the year's W-2s shown to each person in their own app (the Pay tab), once
//     they've been checked; payrollTax.w2Given[year].
// → { ok, numbers? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';

export async function POST(req: NextRequest) {
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 }); }
  const tenantId = String(b?.tenantId || '');
  const g = await requireCan(req, tenantId, 'money.payroll'); if (g.deny) return g.deny;
  const db = getAdminDb(); const tRef = db.doc(`tenants/${tenantId}`); const action = String(b?.action || '');
  const actor = { type: 'user' as const, id: g.actor?.uid || g.actor?.id, name: g.actor?.name || 'Team member', via: 'payday-tab' };
  try {
    if (action === 'checkSettings') {
      const clamp = (v: any) => Math.max(-48, Math.min(48, Math.round(Number(v) || 0)));
      await tRef.set({ payrollTax: { checkLayout: b?.layout === 'middle' ? 'middle' : 'top', checkNudge: { x: clamp(b?.nudge?.x), y: clamp(b?.nudge?.y) } } }, { merge: true });
      return NextResponse.json({ ok: true });
    }
    if (action === 'checkNumbers') {
      const count = Math.floor(Number(b?.count)); if (!(count >= 1 && count <= 300)) return NextResponse.json({ ok: false, error: 'No checks to number.' }, { status: 400 });
      const first = /^\d{1,10}$/.test(String(b?.first || '')) ? Number(b.first) : null;
      const people: string[] = Array.isArray(b?.people) ? b.people.map((x: any) => String(x || '')).filter((x: string) => x && x.length <= 128 && !x.includes('/')).slice(0, 300) : [];
      const periodKey = String(b?.periodKey || ''); const runRef = /^[A-Za-z0-9_-]{1,60}$/.test(periodKey) ? db.doc(`tenants/${tenantId}/payrollRuns/payday_${periodKey}`) : null;
      const numbers = await db.runTransaction(async (tx: any) => {
        const t: any = (await tx.get(tRef)).data() || {}; const run: any = runRef ? (await tx.get(runRef)).data() : null;
        const next = Number(t?.payrollTax?.nextCheckNo) || 0;
        // (From the number put in, or else the next one kept; the next one kept never moves back.)
        const start = first != null ? first : next || 1001;
        const nums = Array.from({ length: count }, (_, i) => String(start + i));
        tx.set(tRef, { payrollTax: { nextCheckNo: String(Math.max(next, start + count)) } }, { merge: true });
        if (run && Array.isArray(run.people) && people.length) {
          const byId = new Map(people.map((id, i) => [id, nums[i]]));
          tx.set(runRef, { people: run.people.map((p: any) => (byId.has(p?.staffId) ? { ...p, method: 'check', checkNo: byId.get(p.staffId) } : p)) }, { merge: true });
        }
        return nums;
      });
      await logAuditAdmin(db, tenantId, { action: 'payroll.checks_printed', targetType: 'payroll', targetId: periodKey ? `payday_${periodKey}` : 'checks', summary: `Printed ${count} paycheck${count === 1 ? '' : 's'}, numbers ${numbers[0]}${count > 1 ? ` to ${numbers[numbers.length - 1]}` : ''}`, actor });
      return NextResponse.json({ ok: true, numbers });
    }
    if (action === 'giveW2s') {
      const year = Number(b?.year); if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ ok: false, error: 'Pick the year.' }, { status: 400 });
      const given = b?.given !== false;
      await tRef.set({ payrollTax: { w2Given: { [String(year)]: given ? new Date().toISOString() : null } } }, { merge: true });
      await logAuditAdmin(db, tenantId, { action: 'payroll.w2s_given', targetType: 'payroll', targetId: `w2_${year}`, summary: given ? `Put the ${year} W-2s in each person’s app` : `Took the ${year} W-2s out of each person’s app`, actor });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  } catch (e: any) {
    console.error('[payroll/forms]', e?.message || e);
    return NextResponse.json({ ok: false, error: 'Not saved. Try again.' }, { status: 500 });
  }
}
