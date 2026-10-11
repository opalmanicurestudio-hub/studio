// src/lib/redo-pay.ts — HOW A REDO OR REFUND TOUCHES PAY, from Settings → Making it right → Pay (payRules). Written as pay
// corrections (payAdjustments), so they show on the pay stub and in payroll with the reason, like any other correction.
//   • When a free redo is finished: whoever did it is paid nothing / half / their usual commission on the service; the
//     original provider keeps their pay, shares the cost (half their commission on the original visit comes back off)
//     or covers it (all of it comes back off). Only for people paid by commission — hourly pay already covers the time.
//     A fix the client pays for goes through checkout like any visit, so these don't apply.
//   • When a refund is marked done and the business chose "commission stays", it's added back (Money takes it off).
// Each is written once (redoPaidAt / refundPayAt on the case).
import { settingsOf } from '@/lib/making-it-right';
import { earnsCommission, usualRate } from '@/lib/commission';
import { staffWithPay } from '@/lib/staff-pay-server';

const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();
const cents = (x: number) => Math.round(x * 100);

async function adjust(db: any, tenantId: string, staffId: string, amountCents: number, reason: string, caseId: string) {
  if (!staffId || !amountCents) return; const a = db.collection(`${T(tenantId)}/payAdjustments`).doc();
  await a.set({ id: a.id, staffId, amountCents, date: now(), reason, caseId, by: 'making_it_right', byName: 'Making it right', createdAt: now() });
}

export async function redoPaySweep(db: any, tenantId: string, tenant: any) {
  if (!tenant?.makingItRight) return 0; const S = settingsOf(tenant); let n = 0;
  const done = (await db.collection(`${T(tenantId)}/appointments`).where('isRedo', '==', true).get()).docs.filter((d: any) => { const a = d.data() || {}; return a.status === 'completed' && !a.redoPaidAt && a.caseId; });
  for (const d of done) {
    const a: any = d.data(); const cSnap = await db.doc(`${T(tenantId)}/cases/${a.caseId}`).get(); const c: any = cSnap.data();
    await d.ref.set({ redoPaidAt: now() }, { merge: true });
    if (!c || Number(a.price) > 0) continue;
    const staffDoc = async (id: string) => (id ? await staffWithPay(db, tenantId, id) : null);
    const base = Number(c.visit?.paid) || 0; const who = c.clientName || 'a client';
    const doer: any = await staffDoc(a.staffId);
    if (doer && earnsCommission(doer) && S.payRules.redoProvider !== 'none' && base > 0) {
      const share = S.payRules.redoProvider === 'half' ? 0.5 : 1;
      await adjust(db, tenantId, a.staffId, cents(base * usualRate(doer) / 100 * share), `Free redo for ${who} (${share === 1 ? 'usual' : 'half'} commission, ${c.number})`, c.id); n++;
    }
    const origId = c.visit?.providerId; const orig: any = await staffDoc(origId);
    if (orig && earnsCommission(orig) && S.payRules.originalProvider !== 'keep' && base > 0) {
      const share = S.payRules.originalProvider === 'pays' ? 1 : 0.5;
      await adjust(db, tenantId, origId, -cents(base * usualRate(orig) / 100 * share), `${share === 1 ? 'Covers' : 'Shares'} the redo for ${who} (${c.number})`, c.id); n++;
    }
    await cSnap.ref.set({ redoPaidAt: now() }, { merge: true });
  }
  return n;
}

/** A refund marked done, when the business keeps the provider's commission: add back what Money took off. */
export async function refundKeepsPay(db: any, tenantId: string, tenant: any, c: any) {
  const S = settingsOf(tenant); if (S.payRules.refund !== 'keep' || c.fix?.kind !== 'refund' || c.refundPayAt) return;
  const origId = c.visit?.providerId; const orig: any = origId ? await staffWithPay(db, tenantId, origId) : null;
  if (orig && earnsCommission(orig) && c.fix.amountCents > 0) await adjust(db, tenantId, origId, Math.round(c.fix.amountCents * usualRate(orig) / 100), `Commission kept on ${c.clientName || 'a client'}’s refund (${c.number})`, c.id);
  await db.doc(`${T(tenantId)}/cases/${c.id}`).set({ refundPayAt: now() }, { merge: true });
}
