// src/lib/text-budget.ts — NO CLIENT GETS BOMBARDED. The optional asks we send — waitlist offers, "could you come
// earlier?", "still hoping?", opportunity texts — share one daily allowance per client (2 a day by default; Settings →
// Booking policies). The time-sensitive ones (same-day tidy asks, waitlist offers) come first: the less urgent ones
// only go out while a slot is left over for them. Confirmations, reminders, pay links and cancellation messages are
// never counted or held back — those are owed.
export type BudgetKind = 'tidy_ask' | 'waitlist_offer' | 'waitlist_still' | 'opportunity' | 'loyalty';
const URGENT: BudgetKind[] = ['tidy_ask', 'waitlist_offer'];
const digits = (p: any) => String(p || '').replace(/\D/g, '').slice(-10);
async function dayKey(db: any, t: string, now: number) {
  const tenant = (await db.doc(`tenants/${t}`).get()).data() || {};
  const { tenantTimeZone, wallParts } = await import('@/lib/tenant-time'); const p = wallParts(new Date(now), tenantTimeZone(tenant));
  return { tenant, day: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` };
}
export const perDayOf = (tenant: any) => { const n = Number(tenant?.textBudget?.perDay); return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 2; };
/** How many of today's optional texts this kind may still use for this phone (0 = hold it). */
export async function budgetLeft(db: any, t: string, phone: string, kind: BudgetKind, now = Date.now()): Promise<number> {
  const d = digits(phone); if (!d) return 1;
  const { tenant, day } = await dayKey(db, t, now); const limit = perDayOf(tenant);
  const used = Number(((await db.doc(`tenants/${t}/textBudget/${d}_${day}`).get()).data() || {}).count) || 0;
  return Math.max(0, (URGENT.includes(kind) ? limit : limit - 1) - used);   // the less urgent leave a slot for the urgent
}
/** Count one (call right after it's actually sent). */
export async function spendBudget(db: any, t: string, phone: string, kind: BudgetKind, now = Date.now()) {
  const d = digits(phone); if (!d) return;
  const { day } = await dayKey(db, t, now); const ref = db.doc(`tenants/${t}/textBudget/${d}_${day}`);
  const cur: any = (await ref.get()).data() || {};
  await ref.set({ count: (Number(cur.count) || 0) + 1, kinds: [...(cur.kinds || []), kind], day, updatedAt: new Date(now).toISOString() }, { merge: true });
}
