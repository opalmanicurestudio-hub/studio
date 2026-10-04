// src/lib/rent-cycle.ts — ONE RENT RECORD. Rent invoices (tenants/{t}/rentInvoices) are the only place rent owed lives:
// autopay, the desk, the renter's portal, late notices, reminders and statements all read them. The rent ledger keeps
// history (payments, credits) and nothing else owed.
//   runRentCycle   — catch-up: an invoice for every due date up to today that doesn't have one (the Rent page's "Run rent
//                    cycle" and the nightly job both use this), late + late fee by the lease's own policy when past grace
//   migrateLedger  — one pass: the old cycle's unpaid ledger charges / late fees become invoices (or join the invoice
//                    that already covers that due date), then are marked migrated so they're never counted again
import { buildRentInvoice, invoiceKey } from '@/lib/rent-invoices';
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const MAX_PER_LEASE = 120;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Every due date from the lease's first charge date up to today (the Rent page's rule, shared). */
export function enumerateDueDates(lease: any, todayIso: string): string[] {
  if (!lease?.firstChargeDate) return []; const today = new Date(`${todayIso}T12:00:00Z`); const last = lease.lastChargeDate ? new Date(`${lease.lastChargeDate}T12:00:00Z`) : null;
  const out: string[] = []; let cursor = new Date(`${String(lease.firstChargeDate).slice(0, 10)}T12:00:00Z`); let guard = 0;
  while (cursor <= today && guard < MAX_PER_LEASE) { if (!last || cursor <= last) out.push(isoDate(cursor));
    const next = new Date(cursor); if (lease.frequency === 'monthly') { next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCDate(Math.min(n(lease.dueDay) || next.getUTCDate(), 28)); } else next.setUTCDate(next.getUTCDate() + (lease.frequency === 'weekly' ? 7 : 14));
    cursor = next; guard++; }
  return out;
}
/** Late, and the fee, by the lease's own policy (the same rule the nightly late sweep applies). */
export function lateness(lease: any, inv: { dueDate: string; amountCents: number }, todayIso: string) {
  const policy = lease?.lateFeePolicy || {}; const graceDays = policy.enabled ? n(policy.graceDays) : 3;
  const graceEnd = new Date(`${inv.dueDate}T12:00:00Z`); graceEnd.setUTCDate(graceEnd.getUTCDate() + graceDays);
  const late = new Date(`${todayIso}T12:00:00Z`) > graceEnd;
  const feeCents = late && policy.enabled ? (policy.type === 'percent' ? Math.round(n(inv.amountCents) * n(policy.percent) / 100) : Math.round(n(policy.amountCents) || n(policy.amount) * 100)) : 0;
  return { late, feeCents: Math.max(0, feeCents) };
}

export async function runRentCycle(db: any, tenantId: string, todayIso: string, by = 'system') {
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  const leases = (await db.collection(`${T}/leases`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((l: any) => l.status === 'active' && n(l.rentAmountCents) > 0);
  const existing = new Set<string>((await db.collection(`${T}/rentInvoices`).get()).docs.map((d: any) => { const v = d.data() || {}; return invoiceKey(String(v.leaseId), String(v.dueDate || '').slice(0, 10)); }));
  const batch = db.batch(); let created = 0, lateCount = 0; const made: any[] = [];
  for (const lease of leases) {
    const [renter, booth] = await Promise.all([db.doc(`${T}/renters/${lease.renterId}`).get(), db.doc(`${T}/booths/${lease.boothId}`).get()]);
    for (const dueDate of enumerateDueDates(lease, todayIso)) { if (existing.has(invoiceKey(lease.id, dueDate))) continue;
      const ref = db.collection(`${T}/rentInvoices`).doc(); const inv: any = buildRentInvoice({ id: ref.id, lease, renter: renter.data(), booth: booth.data(), dueDate, source: 'manual', nowIso });
      const lt = lateness(lease, inv, todayIso); if (lt.late) { inv.status = 'late'; inv.lateFeeCents = lt.feeCents; inv.markedLateAt = nowIso; lateCount++; }
      inv.createdBy = by; batch.set(ref, inv); existing.add(invoiceKey(lease.id, dueDate)); created++; made.push({ leaseId: lease.id, dueDate, late: lt.late }); }
  }
  if (created) await batch.commit();
  return { created, late: lateCount, made };
}

export async function migrateLedger(db: any, tenantId: string, todayIso: string) {
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  const entries = (await db.collection(`${T}/rentLedger`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const open = (e: any) => (e.type === 'rent_charge' || e.type === 'late_fee') && n(e.amountCents) > 0 && !['paid', 'waived', 'refunded', 'migrated'].includes(String(e.status || '')) && !e.migratedToInvoiceId;
  const charges = entries.filter((e: any) => e.type === 'rent_charge' && open(e)); const fees = entries.filter((e: any) => e.type === 'late_fee' && open(e));
  if (!charges.length && !fees.length) return { charges: 0, fees: 0 };
  const invoices = (await db.collection(`${T}/rentInvoices`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const byKey = new Map<string, any>(invoices.map((i: any) => [invoiceKey(String(i.leaseId), String(i.dueDate || '').slice(0, 10)), i]));
  const leases = new Map<string, any>((await db.collection(`${T}/leases`).get()).docs.map((d: any) => [d.id, { id: d.id, ...(d.data() || {}) }]));
  const batch = db.batch(); const invoiceForEntry = new Map<string, string>();
  for (const e of charges) {
    const key = invoiceKey(String(e.leaseId), String(e.dueDate || '').slice(0, 10)); let inv = byKey.get(key);
    if (!inv) { const lease = leases.get(String(e.leaseId)) || { id: e.leaseId, renterId: e.renterId, boothId: e.boothId, rentAmountCents: e.amountCents };
      const [renter, booth] = await Promise.all([db.doc(`${T}/renters/${e.renterId}`).get(), db.doc(`${T}/booths/${e.boothId}`).get()]);
      const ref = db.collection(`${T}/rentInvoices`).doc(); inv = buildRentInvoice({ id: ref.id, lease: { ...lease, rentAmountCents: n(e.amountCents) }, renter: renter.data(), booth: booth.data(), dueDate: String(e.dueDate || todayIso).slice(0, 10), source: 'manual', nowIso });
      const lt = lateness(lease, inv, todayIso); if (lt.late) { inv.status = 'late'; inv.lateFeeCents = 0; inv.markedLateAt = nowIso; }
      inv.migratedFromLedgerId = e.id; batch.set(ref, inv); byKey.set(key, inv); }
    invoiceForEntry.set(e.id, inv.id); batch.set(db.doc(`${T}/rentLedger/${e.id}`), { status: 'migrated', migratedToInvoiceId: inv.id, migratedAt: nowIso }, { merge: true });
  }
  for (const f of fees) {   // a ledger late fee joins the invoice of the charge it applied to
    const chargeId = Array.isArray(f.appliesToEntryIds) ? f.appliesToEntryIds[0] : null; const invId = chargeId ? invoiceForEntry.get(chargeId) || entries.find((x: any) => x.id === chargeId)?.migratedToInvoiceId : null;
    const inv = invId ? invoices.find((i: any) => i.id === invId) || [...byKey.values()].find((i: any) => i.id === invId) : null;
    if (inv) batch.set(db.doc(`${T}/rentInvoices/${inv.id}`), { lateFeeCents: n(inv.lateFeeCents) + n(f.amountCents), status: inv.status === 'paid' ? 'paid' : 'late', updatedAt: nowIso }, { merge: true });
    batch.set(db.doc(`${T}/rentLedger/${f.id}`), { status: 'migrated', migratedToInvoiceId: inv?.id || null, migratedAt: nowIso, ...(inv ? {} : { migrationNote: 'no matching invoice — fee not carried' }) }, { merge: true });
  }
  await batch.commit();
  return { charges: charges.length, fees: fees.length };
}
