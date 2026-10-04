// src/lib/restocking-fund.ts — THE RESTOCKING FUND: product cost quietly eats profit unless it's set aside. Every
// completed studio service sets aside its product cost × (1 + restocking markup) into this fund (an envelope in Money),
// using what was actually used when "Products used" was recorded, else the recipe. Spending on stock is then measured
// against it. Never for renters' services (their product is their own); student clinics count.
import { containerSize } from '@/lib/usage';
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function restockingPolicy(tenant: any) { const p = tenant?.restocking || {}; return { enabled: p.enabled === true, markupPct: Math.max(0, n(p.markupPct) || 40) }; }
/** Product cost of one visit, in cents: actual usage if recorded, else the service's recipe. */
export async function visitProductCostCents(db: any, tenantId: string, appointmentId: string, service: any): Promise<{ cents: number; basis: 'actual' | 'recipe' | 'none' }> {
  const T = `tenants/${tenantId}`; const u: any = (await db.doc(`${T}/usage/${appointmentId}`).get()).data();
  const lines: { productId: string; qty: number }[] = u?.lines?.length ? u.lines.map((l: any) => ({ productId: l.productId, qty: n(l.actual ?? l.expected) })) : (service?.products || []).map((p: any) => ({ productId: p.productId, qty: n(p.quantityUsed) || 1 }));
  if (!lines.length) return { cents: 0, basis: 'none' };
  let total = 0;
  for (const l of lines) { const it: any = (await db.doc(`${T}/inventory/${l.productId}`).get()).data(); if (!it) continue; total += (n(it.costPerUnit) / (containerSize(it) || 1)) * l.qty; }
  return { cents: Math.round(total * 100), basis: u?.lines?.length ? 'actual' : 'recipe' };
}
/** After a sale: set aside for each studio visit on it (once per visit — a retry finds the entry). */
export async function setAsideForSale(db: any, tenantId: string, tenant: any, receiptId: string, visits: { appointmentId: string; service: any; serviceName: string; renter: boolean }[]) {
  const pol = restockingPolicy(tenant); if (!pol.enabled) return { entries: 0, cents: 0 };
  const T = `tenants/${tenantId}`; const now = new Date().toISOString(); let cents = 0, entries = 0;
  for (const v of visits) { if (v.renter) continue;
    const ref = db.doc(`${T}/funds/restocking/entries/${v.appointmentId}`); if ((await ref.get()).exists) continue;
    const cost = await visitProductCostCents(db, tenantId, v.appointmentId, v.service); if (cost.cents <= 0) continue;
    const put = Math.round(cost.cents * (1 + pol.markupPct / 100));
    await ref.set({ appointmentId: v.appointmentId, receiptId, serviceName: v.serviceName, productCostCents: cost.cents, basis: cost.basis, markupPct: pol.markupPct, cents: put, at: now, month: now.slice(0, 7) });
    cents += put; entries++; }
  if (cents) { const f: any = (await db.doc(`${T}/funds/restocking`).get()).data() || {}; await db.doc(`${T}/funds/restocking`).set({ setAsideCents: n(f.setAsideCents) + cents, updatedAt: now }, { merge: true }); }
  return { entries, cents };
}
/** A void takes the sale's entries back out. */
export async function takeBackForSale(db: any, tenantId: string, receiptId: string) {
  const T = `tenants/${tenantId}`; const snap = await db.collection(`${T}/funds/restocking/entries`).where('receiptId', '==', receiptId).get(); let cents = 0;
  for (const d of snap.docs) { cents += n(d.data().cents); await d.ref.delete(); }
  if (cents) { const f: any = (await db.doc(`${T}/funds/restocking`).get()).data() || {}; await db.doc(`${T}/funds/restocking`).set({ setAsideCents: Math.max(0, n(f.setAsideCents) - cents), updatedAt: new Date().toISOString() }, { merge: true }); }
  return cents;
}
/** The fund's picture: set aside and spent on stock this month, and the running balance. Stock spend = expenses in the
 *  supplies / inventory categories (what Money already records when stock is bought). */
export async function restockingSummary(db: any, tenantId: string, tenant: any, monthIso?: string) {
  const T = `tenants/${tenantId}`; const month = monthIso || new Date().toISOString().slice(0, 7); const pol = restockingPolicy(tenant);
  const f: any = (await db.doc(`${T}/funds/restocking`).get()).data() || {};
  const monthEntries = (await db.collection(`${T}/funds/restocking/entries`).where('month', '==', month).get()).docs.map((d: any) => d.data());
  const setAsideMonth = monthEntries.reduce((s: number, e: any) => s + n(e.cents), 0);
  const isStock = (t: any) => t.type === 'expense' && /supplies|inventory|product|stock|cost of goods|cogs|materials/i.test(String(t.category || '')) && !/software|rent|utilit/i.test(String(t.category || ''));
  const tx = (await db.collection(`${T}/transactions`).where('type', '==', 'expense').get()).docs.map((d: any) => d.data()).filter(isStock);
  const spentMonth = Math.round(tx.filter((t: any) => String(t.date || '').slice(0, 7) === month).reduce((s: number, t: any) => s + n(t.amount), 0) * 100);
  const spentAll = Math.round(tx.reduce((s: number, t: any) => s + n(t.amount), 0) * 100);
  return { enabled: pol.enabled, markupPct: pol.markupPct, month, setAsideMonthCents: setAsideMonth, spentMonthCents: spentMonth, visitsMonth: monthEntries.length, setAsideAllCents: n(f.setAsideCents), spentAllCents: spentAll, balanceCents: n(f.setAsideCents) - spentAll };
}
