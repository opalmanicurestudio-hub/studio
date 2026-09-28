// src/lib/grace.ts — CLIENT GRACE ALLOWANCES, by event type.
//
// Grace is a defined allowance — separate from the standard policy and from a
// staff override. Each event has its own rules, so one situation doesn't use
// up every kind of flexibility:
//   late_arrival · late_cancellation · late_reschedule · no_show · emergency
// For each: on/off, how many, reset period, what it permits, whose allowance it
// is (the client's, or per service / per provider), and who can approve it.
// Every use is recorded (tenants/{t}/graceUses) — who applied it, who approved
// it, why — and a manager can undo a misclassified one.
// Businesses opt in; everything is OFF until set. Pure: server + browser.

export type GraceEvent = 'late_arrival' | 'late_cancellation' | 'late_reschedule' | 'no_show' | 'emergency';
export type GracePermit = 'waive_fee' | 'reduce_fee' | 'transfer_deposit' | 'free_reschedule' | 'extend_window';
export interface GraceRule {
  enabled?: boolean;
  allowance?: number;                 // how many in the period
  periodMonths?: number;              // resets every N months (rolling)
  permits?: GracePermit;
  scope?: 'client' | 'client_service' | 'client_provider';
  approval?: 'staff' | 'manager';     // who can apply it
  reducePercent?: number;             // for reduce_fee
  extendMinutes?: number;             // for extend_window (late arrival)
  selfServe?: boolean;                // clients can use it themselves online (e.g. a free late reschedule)
}
export const GRACE_EVENTS: { id: GraceEvent; label: string; permits: GracePermit[] }[] = [
  { id: 'late_arrival', label: 'Late arrival', permits: ['extend_window', 'waive_fee'] },
  { id: 'late_cancellation', label: 'Late cancellation', permits: ['waive_fee', 'reduce_fee', 'transfer_deposit'] },
  { id: 'late_reschedule', label: 'Late reschedule', permits: ['free_reschedule', 'waive_fee'] },
  { id: 'no_show', label: 'No-show', permits: ['waive_fee', 'reduce_fee', 'transfer_deposit'] },
  { id: 'emergency', label: 'Emergency', permits: ['transfer_deposit', 'free_reschedule', 'waive_fee'] },
];
export const PERMIT_LABEL: Record<GracePermit, string> = {
  waive_fee: 'Waive the fee', reduce_fee: 'Reduce the fee', transfer_deposit: 'Move the deposit to a new booking',
  free_reschedule: 'A free reschedule', extend_window: 'Extra time to arrive',
};
const DEFAULT: Required<Omit<GraceRule, 'reducePercent' | 'extendMinutes' | 'selfServe'>> & { reducePercent: number; extendMinutes: number; selfServe: boolean } = {
  enabled: false, allowance: 1, periodMonths: 6, permits: 'waive_fee', scope: 'client', approval: 'staff', reducePercent: 50, extendMinutes: 10, selfServe: false,
};
export function graceRule(tenant: any, ev: GraceEvent): typeof DEFAULT {
  const r: GraceRule = tenant?.bookingPolicies?.grace?.[ev] || {};
  const allowed = GRACE_EVENTS.find((g) => g.id === ev)!.permits;
  return { ...DEFAULT, ...r, permits: r.permits && allowed.includes(r.permits) ? r.permits : allowed[0],
    allowance: Math.max(0, Math.min(12, Number(r.allowance ?? DEFAULT.allowance) || 0)), periodMonths: Math.max(1, Math.min(36, Number(r.periodMonths ?? DEFAULT.periodMonths) || 6)), enabled: r.enabled === true } as any;
}

export interface GraceUse { id?: string; clientId: string; event: GraceEvent; at: string; appointmentId?: string | null; serviceId?: string | null; staffId?: string | null; voidedAt?: string | null }

/** How many are left for this client (and service/provider, per the rule's scope) — and when the next one frees up. */
export function graceRemaining(tenant: any, ev: GraceEvent, uses: GraceUse[], ctx: { clientId: string; serviceId?: string | null; staffId?: string | null }, now = new Date()) {
  const r = graceRule(tenant, ev);
  if (!r.enabled || r.allowance <= 0) return { enabled: false, remaining: 0, used: 0, allowance: 0, periodMonths: r.periodMonths, nextFreesAt: null as string | null, rule: r };
  const since = new Date(now); since.setMonth(since.getMonth() - r.periodMonths);
  const mine = uses.filter((u) => !u.voidedAt && u.event === ev && u.clientId === ctx.clientId && Date.parse(u.at) >= since.getTime()
    && (r.scope !== 'client_service' || !ctx.serviceId || u.serviceId === ctx.serviceId)
    && (r.scope !== 'client_provider' || !ctx.staffId || u.staffId === ctx.staffId))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const remaining = Math.max(0, r.allowance - mine.length);
  let nextFreesAt: string | null = null;
  if (remaining === 0 && mine.length) { const d = new Date(mine[0].at); d.setMonth(d.getMonth() + r.periodMonths); nextFreesAt = d.toISOString(); }
  return { enabled: true, remaining, used: mine.length, allowance: r.allowance, periodMonths: r.periodMonths, nextFreesAt, rule: r };
}

/** Can this person apply it (the rule's approval setting)? */
export const graceCanApply = (role: string | null | undefined, rule: { approval: 'staff' | 'manager' }) => rule.approval === 'staff' || ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());

/** For clients (policy wording): "One grace late cancellation every 6 months." */
export function graceLines(tenant: any): string[] {
  const out: string[] = [];
  for (const g of GRACE_EVENTS) {
    const r = graceRule(tenant, g.id); if (!r.enabled || r.allowance <= 0) continue;
    const n = r.allowance === 1 ? 'One' : String(r.allowance);
    const what = r.permits === 'waive_fee' ? 'the fee is waived' : r.permits === 'reduce_fee' ? `the fee is reduced by ${r.reducePercent}%` : r.permits === 'transfer_deposit' ? 'your deposit can move to a new booking' : r.permits === 'free_reschedule' ? 'rescheduling is free' : `you get ${r.extendMinutes} extra minutes to arrive`;
    out.push(`${n} ${g.label.toLowerCase()}${r.allowance === 1 ? '' : 's'} every ${r.periodMonths} months can be covered by our grace allowance — ${what}.`);
  }
  return out;
}
