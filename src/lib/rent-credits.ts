// src/lib/rent-credits.ts — CREDITS COME OFF BILLS ALREADY OPEN (server). A credit posted to a renter's account (a
// closure credit, time away, sublet income, money paid ahead, gift cards they took, their shop sales) used to wait for
// the next new bill, so a renter with a bill already open was asked to pay it in full while the business held their
// credit. Now the credit is drawn down against their open bills, oldest first, in one step that re-reads both, so the
// same credit is never used twice and a bill is never credited past what's owed. Bills autopay may still be charging are
// left for autopay to settle (lib/rent-payment-plan billTakesCredit).
import { planCredits, creditLabel, RENT_CREDIT_TYPES } from '@/lib/rent-payment-plan';

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Apply one renter's unused credits to their open bills. Returns how much was applied. */
export async function applyCreditsToOpenBills(db: any, tenantId: string, renterId: string, nowIso: string = new Date().toISOString()): Promise<number> {
  const T = `tenants/${tenantId}`;
  const res: any = await db.runTransaction(async (tx: any) => {
    const [invSnap, ledSnap] = await Promise.all([
      tx.get(db.collection(`${T}/rentInvoices`).where('renterId', '==', renterId)),
      tx.get(db.collection(`${T}/rentLedger`).where('renterId', '==', renterId)),
    ]);
    const invoices = invSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const ledger = ledSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const plan = planCredits(invoices, ledger);
    if (!plan.bills.length) return { applied: 0, lines: [] as string[] };
    const byLine = new Map<string, number>();
    const lines: string[] = [];
    let applied = 0;
    for (const b of plan.bills) {
      const inv: any = invoices.find((i: any) => i.id === b.id) || {};
      const note = b.uses.map((u) => `${creditLabel(u.type)} ${usd(u.takeCents)}`).join(', ');
      tx.set(db.doc(`${T}/rentInvoices/${b.id}`), {
        paidCents: b.paidCentsBefore + b.takeCents,
        creditAppliedCents: n(inv.creditAppliedCents) + b.takeCents,
        creditNote: [inv.creditNote, note].filter(Boolean).join(', '),
        updatedAt: nowIso,
        ...(b.full ? { status: 'paid', paidAt: nowIso, paidVia: 'credit' } : {}),
      }, { merge: true });
      for (const u of b.uses) byLine.set(u.lineId, (byLine.get(u.lineId) || 0) + u.takeCents);
      applied += b.takeCents;
      lines.push(`${usd(b.takeCents)} on the bill due ${String(inv.dueDate || '').slice(0, 10)}${b.full ? ', now paid' : ''}`);
    }
    for (const [lineId, take] of byLine) {
      const l: any = ledger.find((x: any) => x.id === lineId) || {};
      tx.set(db.doc(`${T}/rentLedger/${lineId}`), { appliedCents: n(l.appliedCents) + take, lastAppliedAt: nowIso }, { merge: true });
    }
    return { applied, lines };
  });
  if (res.applied > 0) {
    try {
      const aRef = db.collection(`${T}/renterAlerts`).doc();
      await aRef.set({ id: aRef.id, renterId, kind: 'credit_applied', tab: 'rent', tone: 'green', at: nowIso,
        text: `${usd(res.applied)} of your credit was taken off what you owe: ${res.lines.join('; ')}.` });
    } catch { /* the alert is best-effort; the bills are already right */ }
  }
  return res.applied;
}

/** Every renter in a business who has unused credit and an open bill it can go on. */
export async function applyAllOpenCredits(db: any, tenantId: string, nowIso: string = new Date().toISOString()): Promise<{ renters: number; appliedCents: number }> {
  const T = `tenants/${tenantId}`;
  const snap = await db.collection(`${T}/rentLedger`).where('type', 'in', [...RENT_CREDIT_TYPES]).get();
  const renterIds = new Set<string>();
  for (const d of snap.docs) {
    const l: any = d.data() || {};
    if (l.renterId && Math.abs(n(l.amountCents)) - n(l.appliedCents) > 0) renterIds.add(String(l.renterId));
  }
  let renters = 0; let appliedCents = 0;
  for (const rid of renterIds) {
    try { const a = await applyCreditsToOpenBills(db, tenantId, rid, nowIso); if (a > 0) { renters++; appliedCents += a; } }
    catch (e) { console.error('[rent-credits] apply', tenantId, rid, e); }
  }
  return { renters, appliedCents };
}
