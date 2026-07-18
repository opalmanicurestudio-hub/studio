// src/lib/bills-recurrence.ts
//
// Bill cadence engine — the fix for "everything assumes monthly."
//
// Two jobs:
//   1. NORMALIZATION — monthlyEquivalent() converts any cadence to a true
//      monthly cost, so Foundation totals, TMHR, and annual run-rates are
//      accurate for weekly/daily/quarterly/annual bills.
//   2. SCHEDULING — nextDueDate() + generateBillInstances() keep exactly one
//      upcoming unpaid instance per bill definition, created automatically
//      on the bill's own cadence by the nightly cron.
//
// `dueDay` semantics by cadence:
//   monthly / quarterly / annual → day of the MONTH (1–31, clamped to
//                                  short months)
//   weekly / bi-weekly           → day of the WEEK (0=Sun … 6=Sat)
//   daily                        → ignored
// bi-weekly / quarterly / annual also use an anchor date (definition's
// anchorDate, else updatedAt/createdAt) to know which week/month the cycle
// started on.

export type BillCadence = 'daily' | 'weekly' | 'bi-weekly' | 'monthly' | 'quarterly' | 'annual';

export const CADENCE_OPTIONS: { value: BillCadence; label: string; hint: string }[] = [
  { value: 'daily',     label: 'Daily',     hint: '×30.4/mo' },
  { value: 'weekly',    label: 'Weekly',    hint: '×4.33/mo' },
  { value: 'bi-weekly', label: 'Bi-Weekly', hint: '×2.17/mo' },
  { value: 'monthly',   label: 'Monthly',   hint: 'as-is' },
  { value: 'quarterly', label: 'Quarterly', hint: '÷3/mo' },
  { value: 'annual',    label: 'Annual',    hint: '÷12/mo' },
];

export const MONTHLY_MULTIPLIER: Record<BillCadence, number> = {
  daily:       365 / 12,
  weekly:      52 / 12,
  'bi-weekly': 26 / 12,
  monthly:     1,
  quarterly:   1 / 3,
  annual:      1 / 12,
};

export const normalizeCadence = (c?: string | null): BillCadence =>
  (CADENCE_OPTIONS.some(o => o.value === c) ? c : 'monthly') as BillCadence;

/** True monthly cost of a bill at any cadence — the number TMHR and the
 *  Foundation totals must use. */
export const monthlyEquivalent = (bill: { amount?: number; cadence?: string | null }): number =>
  (bill.amount || 0) * MONTHLY_MULTIPLIER[normalizeCadence(bill.cadence)];

/** Short display label, e.g. "wk" chip next to an amount. */
export const cadenceShort = (c?: string | null): string =>
  ({ daily: 'day', weekly: 'wk', 'bi-weekly': '2wk', monthly: 'mo', quarterly: 'qtr', annual: 'yr' } as Record<string, string>)[normalizeCadence(c)] || 'mo';

const clampDay = (y: number, m: number, d: number) =>
  Math.min(Math.max(1, d || 1), new Date(y, m + 1, 0).getDate());

/** First due date strictly AFTER `after`, on the bill's cadence. */
export function nextDueDate(
  cadence: BillCadence | string | undefined,
  opts: { dueDay?: number; anchor?: string | null },
  after: Date = new Date(),
): Date {
  const cad = normalizeCadence(cadence as string);
  const a = new Date(after); a.setHours(0, 0, 0, 0);
  const dueDay = opts.dueDay || 1;
  const anchorRaw = opts.anchor ? new Date(opts.anchor) : a;
  const anchor = isNaN(anchorRaw.getTime()) ? a : anchorRaw;

  if (cad === 'daily') {
    const d = new Date(a); d.setDate(d.getDate() + 1); return d;
  }
  if (cad === 'weekly') {
    const wd = ((dueDay % 7) + 7) % 7;
    const d = new Date(a);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== wd);
    return d;
  }
  if (cad === 'bi-weekly') {
    const d = new Date(anchor); d.setHours(0, 0, 0, 0);
    while (d <= a) d.setDate(d.getDate() + 14);
    return d;
  }
  if (cad === 'monthly') {
    let y = a.getFullYear(), m = a.getMonth();
    let d = new Date(y, m, clampDay(y, m, dueDay));
    if (d <= a) {
      m += 1; if (m > 11) { m = 0; y += 1; }
      d = new Date(y, m, clampDay(y, m, dueDay));
    }
    return d;
  }
  // quarterly / annual — step months from the anchor's month
  const step = cad === 'quarterly' ? 3 : 12;
  let y = anchor.getFullYear(), m = anchor.getMonth();
  let d = new Date(y, m, clampDay(y, m, dueDay));
  let guard = 0;
  while (d <= a && guard < 200) {
    m += step; y += Math.floor(m / 12); m = m % 12;
    d = new Date(y, m, clampDay(y, m, dueDay));
    guard++;
  }
  return d;
}

/** SERVER-ONLY (firebase-admin db). For every bill definition with an
 *  amount, ensure exactly one upcoming unpaid instance exists — creating
 *  the next one on the bill's cadence when the previous was paid (or none
 *  exists). Run nightly. Returns how many instances were created. */
export async function generateBillInstances(db: any, tenantId: string): Promise<number> {
  const defsSnap = await db.collection(`tenants/${tenantId}/billDefinitions`).get();
  if (defsSnap.empty) return 0;
  const instSnap = await db.collection(`tenants/${tenantId}/billInstances`).get();
  const instances = instSnap.docs.map((d: any) => d.data() as any);

  const now = new Date();
  const nowIso = now.toISOString();
  const batch = db.batch();
  let created = 0;

  for (const dDoc of defsSnap.docs) {
    const def = { id: dDoc.id, ...(dDoc.data() as any) };
    if ((def.amount || 0) <= 0) continue;

    const mine = instances.filter((i: any) => i.billDefinitionId === def.id);
    if (mine.some((i: any) => i.status !== 'paid')) continue; // one pending at a time

    // Schedule relative to the latest known due date so a bill paid early
    // doesn't get its next instance early too.
    const lastDue = mine.reduce((max: Date | null, i: any) => {
      const t = new Date(i.dueDate);
      return isNaN(t.getTime()) ? max : (!max || t > max ? t : max);
    }, null as Date | null);
    const after = lastDue && lastDue > now ? lastDue : now;

    const due = nextDueDate(def.cadence, { dueDay: def.dueDay, anchor: def.anchorDate || def.updatedAt || def.createdAt }, after);
    const ref = db.collection(`tenants/${tenantId}/billInstances`).doc();
    batch.set(ref, {
      id: ref.id,
      billDefinitionId: def.id,
      dueDate: due.toISOString(),
      status: 'unpaid',
      createdAt: nowIso,
      generatedBy: 'bill-scheduler',
    });
    created++;
  }
  if (created > 0) await batch.commit();
  return created;
}
