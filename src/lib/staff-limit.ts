// src/lib/staff-limit.ts — HOW MUCH STAFF CAN GIVE WITHOUT A MANAGER. One rule for discounts at checkout ("making
// things right") AND store credit, set once in Settings → Fees & credit: "Staff can give up to $X or Y%".
//   • Over $X (or over Y% of the bill, when a % is set) → a manager approves with their PIN.
//   • $0 means a manager approves every one — how anyone reads "staff can give up to $0".
//   • Not set at all → the standard $50 every new business starts with.
//   • Owners and managers are never limited.
export const DEFAULT_STAFF_LIMIT = 50;

export function staffLimit(tenant: any): { amount: number; percent: number } {
  const raw = tenant?.maxAutonomousRecoveryAmount;
  const amount = raw === undefined || raw === null || raw === '' || !Number.isFinite(Number(raw)) ? DEFAULT_STAFF_LIMIT : Math.max(0, Number(raw));
  const percent = Math.max(0, Number(tenant?.maxAutonomousRecoveryPercent) || 0);
  return { amount, percent };
}

/** Does this amount need a manager? `billTotal` only matters when a % cap is set. */
export function overStaffLimit(tenant: any, amount: number, billTotal?: number): boolean {
  const { amount: cap, percent } = staffLimit(tenant);
  if (amount > cap + 0.005) return true;
  return percent > 0 && !!billTotal && billTotal > 0 && (amount / billTotal) * 100 > percent + 0.005;
}
