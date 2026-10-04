// src/lib/restocking-fund.ts — THE RESTOCKING FUND: product cost quietly eats profit unless it's set aside. Every
// completed studio service sets aside its product cost × (1 + restocking markup) into this fund (an envelope in Money),
// using what was actually used when "Products used" was recorded, else the recipe. Spending on stock is then measured
// against it. Never for renters' services (their product is their own); student clinics count.
import { containerSize, costGap } from '@/lib/product-cost';
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
/** Which items the fund covers: professional (back-bar) stock, plus anything that appears in a service recipe. Retail
 *  stock sold at the counter recovers its own cost through the retail margin, so it stays out unless a recipe uses it. */
export async function fundItems(db: any, tenantId: string) {
  const T = `tenants/${tenantId}`;
  const services = (await db.collection(`${T}/services`).get()).docs.map((d: any) => d.data() || {}).filter((x: any) => x.status !== 'archived');
  const inRecipes = new Set<string>(services.flatMap((x: any) => (x.products || []).map((p: any) => String(p.productId))));
  const items = (await db.collection(`${T}/inventory`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const covered = items.filter((it: any) => it.type === 'professional' || inRecipes.has(it.id));
  // Items a recipe uses that can't be counted yet: no cost, or a per-container cost with no size / uses to spread it over.
  const missingCost = items.filter((it: any) => inRecipes.has(it.id) && costGap(it)).map((it: any) => ({ id: it.id, name: it.name || 'Product', why: costGap(it) as string }));
  return { covered, coveredIds: new Set<string>(covered.map((x: any) => x.id)), missingCost };
}
/** The fund's picture: set aside this month, what was spent on stock (deliveries of covered items, from the stock
 *  ledger; expenses in supplies / inventory categories only when deliveries aren't recorded), and the running balance. */
export async function restockingSummary(db: any, tenantId: string, tenant: any, monthIso?: string) {
  const T = `tenants/${tenantId}`; const month = monthIso || new Date().toISOString().slice(0, 7); const pol = restockingPolicy(tenant);
  const f: any = (await db.doc(`${T}/funds/restocking`).get()).data() || {};
  const monthEntries = (await db.collection(`${T}/funds/restocking/entries`).where('month', '==', month).get()).docs.map((d: any) => d.data());
  const setAsideMonth = monthEntries.reduce((s: number, e: any) => s + n(e.cents), 0);
  const { covered, coveredIds, missingCost } = await fundItems(db, tenantId); const costOf = new Map<string, number>(covered.map((it: any) => [it.id, n(it.costPerUnit)]));
  const received = (await db.collection(`${T}/stockCorrections`).where('type', '==', 'received').get()).docs.map((d: any) => d.data()).filter((m: any) => coveredIds.has(String(m.productId)) && n(m.change) > 0);
  let spentMonth = 0, spentAll = 0, spendBasis: 'deliveries' | 'expenses' = 'deliveries';
  if (received.length) { for (const m of received) { const c = Math.round(n(m.change) * (costOf.get(String(m.productId)) || 0) * 100); spentAll += c; if (String(m.date || '').slice(0, 7) === month) spentMonth += c; } }
  else { spendBasis = 'expenses';
    const isStock = (t: any) => t.type === 'expense' && /supplies|inventory|product|stock|cost of goods|cogs|materials/i.test(String(t.category || '')) && !/software|rent|utilit/i.test(String(t.category || ''));
    const tx = (await db.collection(`${T}/transactions`).where('type', '==', 'expense').get()).docs.map((d: any) => d.data()).filter(isStock);
    spentMonth = Math.round(tx.filter((t: any) => String(t.date || '').slice(0, 7) === month).reduce((s: number, t: any) => s + n(t.amount), 0) * 100);
    spentAll = Math.round(tx.reduce((s: number, t: any) => s + n(t.amount), 0) * 100); }
  // Product used with no sale behind it (testers, redos, classes, a free touch-up): stock spent, nothing set aside.
  // Stock-ledger "used" movements this month whose visit has no fund entry — at the item's cost per use.
  let usedWithoutSaleMonth = 0;
  try { const used = (await db.collection(`${T}/stockCorrections`).where('type', '==', 'used').get()).docs.map((d: any) => d.data()).filter((m: any) => String(m.date || '').slice(0, 7) === month && coveredIds.has(String(m.productId)));
    const entryIds = new Set<string>((await db.collection(`${T}/funds/restocking/entries`).where('month', '==', month).get()).docs.map((d: any) => String(d.data().appointmentId)));
    const perUnit = new Map<string, number>(covered.map((it: any) => [it.id, n(it.costPerUnit) / (containerSize(it) || 1)]));
    for (const m of used) { const ap = m.ref?.kind === 'appointment' ? String(m.ref.id) : null; if (ap && entryIds.has(ap)) continue; usedWithoutSaleMonth += Math.round(Math.abs(n(m.change)) * (perUnit.get(String(m.productId)) || 0) * 100); }
  } catch { /* fine */ }
  return { enabled: pol.enabled, markupPct: pol.markupPct, month, setAsideMonthCents: setAsideMonth, spentMonthCents: spentMonth, visitsMonth: monthEntries.length, setAsideAllCents: n(f.setAsideCents), spentAllCents: spentAll, balanceCents: n(f.setAsideCents) - spentAll, spendBasis, coveredCount: covered.length, missingCost, usedWithoutSaleMonthCents: usedWithoutSaleMonth };
}
