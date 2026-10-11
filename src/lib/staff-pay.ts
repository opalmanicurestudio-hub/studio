// src/lib/staff-pay.ts — WHERE A PERSON'S PAY LIVES. The staff record is readable by the whole team (names, photos,
// hours, who does what), so pay can't sit on it. Rates live in tenants/{t}/staffPay/{staffId}, which only managers and
// the person themselves can read, and only managers can change. The staff record keeps how someone is paid
// (payStructure) — that drives screens — but not how much.
//
// Everything that needs pay merges it back: withPay() on the server, mergePay() with the managers-only listener in the
// app. Records written before the move still carry their rates; the merge reads those until the move runs
// (movePayOff), so nothing breaks in between.

export const PAY_FIELDS = [
  'commissionRate', 'retailCommissionRate', 'hourlyRate', 'serviceHourRate', 'servicePay', 'serviceCommission', 'nonServiceRate',
  'commissionTiers', 'salaryAmount', 'salaryPer', 'salaryWeekly', 'overtimeExempt', 'overtimeNonExempt',
] as const;
export type PayField = typeof PAY_FIELDS[number];

/** Split a staff record (or a form's values) into the part everyone can read and the pay part. */
export function splitPay<T extends Record<string, any>>(o: T): { rest: Omit<T, PayField>; pay: Partial<Record<PayField, any>> } {
  const rest: any = {}; const pay: any = {};
  for (const [k, v] of Object.entries(o || {})) { if ((PAY_FIELDS as readonly string[]).includes(k)) { if (v !== undefined) pay[k] = v; } else rest[k] = v; }
  return { rest, pay };
}

/** Put pay back on a staff record. The staffPay doc wins; a record that hasn't been moved yet keeps its own rates. */
export function mergePay<S extends Record<string, any>>(s: S, pay?: Record<string, any> | null): S {
  if (!s || !pay) return s; const out: any = { ...s };
  // A key present in staffPay is the answer — null means it was cleared on purpose (not "fall back to the old record").
  for (const k of PAY_FIELDS) if (k in pay) { if (pay[k] === null) delete out[k]; else out[k] = pay[k]; }
  return out;
}
export function mergePayAll<S = any>(list: S[], byId: Record<string, any>): S[] { return (list || []).map((s: any) => mergePay(s, s?.id ? byId[s.id] : null)); }

